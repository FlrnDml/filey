import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { ProcessedImport, UnprocessedImport, UnprocessedStatus } from '../db';
import { fileDocument, renderPath } from '../filer';
import type { ImportOutcome, ImportService, ImportServiceDeps, ImportState, InboxChange, HistoryChange } from './types';

/** How often offline mode re-checks the connection besides network and wake events. */
export const OFFLINE_CHECK_INTERVAL_MS = 30_000;

interface Base {
  contentHash: string;
  fileName: string;
  filePath: string;
}

interface RunOptions {
  /** Files taken from the offline queue are imported without the offline check. */
  draining: boolean;
  /** A retry requested by the user: a `failed` file is imported again instead of skipped. */
  manual: boolean;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isCode = (err: unknown, code: string) => (err as { code?: string } | null)?.code === code;

export function createImportService(deps: ImportServiceDeps): ImportService {
  const { imports, settings, apiKeys, fs, notifier, logger, clock, connectivity, scheduler } = deps;

  let state: ImportState = { mode: 'running' };
  const stateListeners = new Set<(s: ImportState) => void>();
  const inboxListeners = new Set<(change: InboxChange) => void>();
  const historyListeners = new Set<(change: HistoryChange) => void>();
  const queueListeners = new Set<(count: number) => void>();
  const analyzingListeners = new Set<(inboxId: number | null) => void>();
  let analyzing: number | null = null;
  /** Files that arrived while the key was unusable; processed when a key is saved. */
  const paused: string[] = [];
  /** Files waiting for the connection, in arrival order. */
  const offlineQueue: string[] = [];
  /** Serializes everything that imports a file: one import at a time. */
  let chain: Promise<unknown> = Promise.resolve();
  let stopTimer: (() => void) | undefined;
  const disposers: (() => void)[] = [];

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };

  const setState = (next: ImportState) => {
    const same = next.mode === state.mode && (next.mode !== 'paused' || (state.mode === 'paused' && state.reason === next.reason));
    if (same) return;
    state = next;
    logger.log('info', `Import: state is now ${next.mode}${next.mode === 'paused' ? ` (key ${next.reason})` : ''}`);
    stateListeners.forEach((l) => l(state));
  };
  const resumeFromPause = () => {
    if (state.mode === 'paused') setState({ mode: 'running' });
  };
  const inboxChanged = (change: InboxChange) => inboxListeners.forEach((l) => l(change));
  const historyChanged = (change: HistoryChange) => historyListeners.forEach((l) => l(change));
  const now = () => clock.now().toISOString();
  const addUnique = (list: string[], p: string) => {
    if (!list.includes(p)) list.push(p);
  };
  const queueChanged = () => queueListeners.forEach((l) => l(offlineQueue.length));
  const setAnalyzing = (next: number | null) => {
    if (analyzing === next) return;
    analyzing = next;
    analyzingListeners.forEach((l) => l(analyzing));
  };

  /** Writes the inbox row of this file (one row per path) and announces it. */
  function writeInbox(base: Base, status: UnprocessedStatus, extra: { error?: string; duplicateOfId?: number } = {}): UnprocessedImport {
    const row = imports.unprocessed.upsert({
      inboxPath: base.filePath,
      fileName: base.fileName,
      contentHash: base.contentHash,
      status,
      ...extra,
      now: now(),
    });
    inboxChanged({ kind: 'upsert', record: row });
    return row;
  }

  /** Makes sure the inbox shows this file as `pending`; an unchanged pending row is left alone. */
  function ensurePending(existing: UnprocessedImport | undefined, base: Base): UnprocessedImport {
    if (existing?.status === 'pending' && existing.contentHash === base.contentHash) return existing;
    return writeInbox(base, 'pending');
  }

  function removeInboxRow(filePath: string) {
    const row = imports.unprocessed.deleteByPath(filePath);
    if (row) inboxChanged({ kind: 'remove', id: row.id });
  }

  function dropFromQueues(filePath: string) {
    const i = paused.indexOf(filePath);
    if (i >= 0) paused.splice(i, 1);
    const j = offlineQueue.indexOf(filePath);
    if (j >= 0) {
      offlineQueue.splice(j, 1);
      queueChanged();
    }
  }

  function enterOffline() {
    if (state.mode === 'offline') return;
    setState({ mode: 'offline' });
    stopTimer ??= scheduler.every(OFFLINE_CHECK_INTERVAL_MS, checkConnection);
  }

  function checkConnection() {
    if (state.mode !== 'offline' || !connectivity.isOnline()) return;
    stopTimer?.();
    stopTimer = undefined;
    setState({ mode: 'running' });
    void serial(drainOfflineQueue);
  }

  async function drainOfflineQueue() {
    while (offlineQueue.length > 0 && state.mode !== 'offline') {
      const file = offlineQueue[0]!;
      const outcome = await safeImport(file, { draining: true, manual: false });
      if (outcome === 'queued') break; // offline again; keep it at the front
      dropFromQueues(file); // by value: the file may have been removed while it was imported
    }
  }

  async function drainPaused() {
    for (const file of paused.splice(0)) await safeImport(file, { draining: false, manual: false });
  }

  async function safeImport(filePath: string, run: RunOptions): Promise<ImportOutcome | undefined> {
    try {
      return await importFile(filePath, run);
    } catch (err) {
      logger.log('error', `Import: unexpected error for ${path.basename(filePath)}: ${errorText(err)}`);
      return undefined;
    }
  }

  /** Returns the key, or pauses and returns undefined. */
  async function usableKey(): Promise<string | undefined> {
    const key = await apiKeys.get();
    if (key.status === 'ok') {
      resumeFromPause();
      return key.value;
    }
    setState({ mode: 'paused', reason: key.status });
    return undefined;
  }

  async function importFile(filePath: string, { draining, manual }: RunOptions): Promise<ImportOutcome> {
    const name = path.basename(filePath);
    const apiKey = await usableKey();
    if (apiKey === undefined) {
      addUnique(paused, filePath);
      logger.log('warn', `Import: ${name} kept in the inbox, the API key is not usable`);
      return 'paused';
    }

    let data: Buffer;
    try {
      data = Buffer.from(await fs.readFile(filePath));
    } catch (err) {
      if (isCode(err, 'ENOENT')) {
        logger.log('info', `Import: ${name} vanished before it was read; handled elsewhere`);
        removeInboxRow(filePath);
        return 'vanished';
      }
      logger.log('error', `Import: could not read ${name}: ${errorText(err)}`);
      return 'failed';
    }
    const contentHash = createHash('sha256').update(data).digest('hex');
    const shortHash = contentHash.slice(0, 12);
    const base: Base = { contentHash, fileName: name, filePath };
    const existing = imports.unprocessed.getByPath(filePath);

    // Duplicate: the same content was filed before and that file is still there. Not sent to the model again; the file stays where it is.
    const original = await findLiveOriginal(contentHash);
    if (original) {
      const known = existing?.status === 'duplicate' && existing.contentHash === contentHash && existing.duplicateOfId === original.id;
      if (!known) {
        // Seeing the same duplicate again (e.g. after a restart) neither writes nor notifies again.
        const wasDuplicate = existing?.status === 'duplicate';
        writeInbox(base, 'duplicate', { duplicateOfId: original.id });
        if (!wasDuplicate) {
          notifier.notify({
            title: 'Filey',
            body: `Duplicate: ${name} is already filed as ${path.basename(original.targetPath)}`,
            onClick: { kind: 'reveal', path: original.targetPath },
          });
        }
      }
      logger.log('info', `Import: ${name} (${shortHash}) is a duplicate of import ${original.id}`);
      return 'duplicate';
    }

    // A failed file is still in the inbox after a restart; it is only retried on request (arc42 §6.5).
    if (existing?.status === 'failed' && existing.contentHash === contentHash && !manual) {
      logger.log('debug', `Import: ${name} (${shortHash}) failed before; waiting for a manual retry`);
      return 'skipped';
    }

    // Visible in the Inbox view before the analysis starts.
    const row = ensurePending(existing, base);

    if (!draining && (state.mode === 'offline' || !connectivity.isOnline())) {
      return queue(base, shortHash);
    }

    const config = settings.getSettings();
    setAnalyzing(row.id);
    try {
      const result = await deps.analyze(data, {
        apiKey,
        model: config.model,
        rules: settings.listRules(),
      });
      if (!result.ok) {
        const { kind, message } = result.failure;
        // A timeout counts as offline only when the Mac has no connection; otherwise retrying would hang again.
        if (kind === 'offline' || (kind === 'timeout' && !connectivity.isOnline())) return queue(base, shortHash);
        return fail(base, shortHash, message, kind);
      }

      const rel = renderPath(config.namingTemplate, result.info, clock.now());
      const filed = await fileDocument(filePath, config.targetPath, rel, fs, {
        inboxPath: config.inboxPath,
      });
      if (filed.status === 'vanished') {
        logger.log('info', `Import: ${name} (${shortHash}) vanished while filing; handled elsewhere`);
        removeInboxRow(filePath);
        return 'vanished';
      }
      const processed = imports.markFiled(filePath, {
        contentHash,
        originalName: name,
        targetPath: filed.path,
        documentDate: result.info.date,
        sender: result.info.sender,
        category: result.info.category,
        title: result.info.title,
        model: config.model,
        filedAt: now(),
      });
      inboxChanged({ kind: 'remove', id: row.id });
      historyChanged({ kind: 'upsert', record: processed });
      const folder = path.relative(path.resolve(config.targetPath), path.dirname(filed.path)).split(path.sep).join('/');
      // Clicking it reveals the filed document in Finder (arc42 §6.1 step 8).
      notifier.notify({
        title: 'Filey',
        body: `Filed: ${path.basename(filed.path)} → ${folder}`,
        onClick: { kind: 'reveal', path: filed.path },
      });
      logger.log('info', `Import: filed ${name} (${shortHash}) as ${path.basename(filed.path)}`);
      return 'filed';
    } catch (err) {
      return fail(base, shortHash, errorText(err), 'move');
    } finally {
      setAnalyzing(null);
    }
  }

  /**
   * The filed import of this content whose document still exists. Entries whose document was moved or deleted
   * since are removed from the history on the way (lazy pruning, arc42 §6.8): there is no scan at start.
   */
  async function findLiveOriginal(contentHash: string): Promise<ProcessedImport | undefined> {
    let live: ProcessedImport | undefined;
    for (const row of imports.processed.findByContentHash(contentHash)) {
      if (await fs.exists(row.targetPath)) {
        live ??= row;
      } else {
        imports.processed.delete(row.id);
        historyChanged({ kind: 'remove', id: row.id });
        logger.log('info', `Import: history entry ${row.id} removed, its document no longer exists`);
      }
    }
    return live;
  }

  function queue(base: Base, shortHash: string): ImportOutcome {
    const before = offlineQueue.length;
    addUnique(offlineQueue, base.filePath);
    if (offlineQueue.length !== before) queueChanged();
    enterOffline();
    logger.log('info', `Import: ${base.fileName} (${shortHash}) is waiting for the connection`);
    return 'queued';
  }

  function fail(base: Base, shortHash: string, message: string, kind: string): ImportOutcome {
    writeInbox(base, 'failed', { error: message });
    // Clicking it opens the Inbox view, which shows the failed entry with its error (arc42 §6.5).
    notifier.notify({
      title: 'Filey',
      body: `Could not file ${base.fileName}: ${message}`,
      onClick: { kind: 'inbox' },
    });
    logger.log('error', `Import: ${base.fileName} (${shortHash}) failed (${kind}): ${message}`);
    return 'failed';
  }

  return {
    handleFile: async (filePath) => {
      await serial(() => safeImport(filePath, { draining: false, manual: false }));
    },
    handleRemoved(filePath) {
      removeInboxRow(filePath);
      dropFromQueues(filePath);
    },
    reconcileInbox(presentPaths) {
      const present = new Set(presentPaths);
      for (const row of imports.unprocessed.list()) {
        if (present.has(row.inboxPath)) continue;
        removeInboxRow(row.inboxPath);
        dropFromQueues(row.inboxPath);
        logger.log('info', `Import: ${row.fileName} is no longer in the inbox; entry removed`);
      }
    },
    async retry(inboxId) {
      const row = imports.unprocessed.getById(inboxId);
      if (!row) return 'not-found';
      if (row.status !== 'failed') return 'not-failed';
      if (!(await fs.exists(row.inboxPath))) {
        logger.log('info', `Import: retry of ${row.fileName} skipped, the file is no longer in the inbox`);
        return 'file-missing';
      }
      await serial(() => safeImport(row.inboxPath, { draining: false, manual: true }));
      return 'started';
    },
    start() {
      disposers.push(
        apiKeys.onStatusChange((status) => {
          if (status === 'set') {
            resumeFromPause();
            void serial(drainPaused);
          } else {
            setState({ mode: 'paused', reason: status });
          }
        }),
        connectivity.onChange(checkConnection),
      );
    },
    stop() {
      disposers.splice(0).forEach((d) => d());
      stopTimer?.();
      stopTimer = undefined;
    },
    getState: () => state,
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    listInbox: () => imports.unprocessed.list(),
    getInboxEntry: (inboxId) => imports.unprocessed.getById(inboxId),
    onInboxChanged(listener) {
      inboxListeners.add(listener);
      return () => inboxListeners.delete(listener);
    },
    listHistory: (limit) => imports.processed.listRecent(limit),
    getHistoryEntry: (historyId) => imports.processed.getById(historyId),
    onHistoryChanged(listener) {
      historyListeners.add(listener);
      return () => historyListeners.delete(listener);
    },
    queuedCount: () => offlineQueue.length,
    onQueuedCountChange(listener) {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    analyzingId: () => analyzing,
    onAnalyzingChange(listener) {
      analyzingListeners.add(listener);
      return () => analyzingListeners.delete(listener);
    },
    async checkKey() {
      await serial(async () => {
        try {
          await usableKey();
        } catch (err) {
          logger.log('error', `Import: could not check the API key: ${errorText(err)}`);
        }
      });
    },
  };
}
