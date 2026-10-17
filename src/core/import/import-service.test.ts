import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AnalyzeFailureKind, AnalyzeOptions, AnalyzeResult } from '../analyzer';
import { createApiKeyStore, InMemorySecretStore } from '../api-key';
import { openMigratedDatabase } from '../db';
import type { FileSystem, Logger, NotificationTarget } from '../ports';
import { createSettingsRepository } from '../settings';
import { createImportService, OFFLINE_CHECK_INTERVAL_MS, type HistoryChange, type ImportService, type InboxChange } from './index';

const API_KEY = 'sk-or-SECRET-KEY-123';
const CONTENT = 'PDF-CONTENT-OF-THE-LETTER';
const INFO = {
  date: '2026-10-15',
  sender: 'Northwind',
  title: 'Invoice',
  category: 'Health/Health insurance',
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

class FakeFs implements FileSystem {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  add(path: string, content = CONTENT) {
    this.files.set(path, new TextEncoder().encode(content));
  }
  async readFile(p: string) {
    const f = this.files.get(p);
    if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return f;
  }
  async writeFile(p: string, data: Uint8Array | string) {
    this.files.set(p, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
  failRename: Error | undefined;
  async rename(from: string, to: string) {
    if (this.failRename) throw this.failRename;
    const f = await this.readFile(from);
    this.files.delete(from);
    this.files.set(to, f);
  }
  async exists(p: string) {
    return this.files.has(p) || this.dirs.has(p);
  }
  async readDir() {
    return [];
  }
  async mkdir(p: string) {
    this.dirs.add(p);
  }
  async remove(p: string) {
    await this.readFile(p);
    this.files.delete(p);
  }
}

function setup() {
  const store = openMigratedDatabase(':memory:');
  const settings = createSettingsRepository(store, { home: '/home/u' });
  settings.updateSettings({ inboxPath: '/inbox', targetPath: '/target' });
  const secrets = new InMemorySecretStore();
  const apiKeys = createApiKeyStore(secrets);
  const fs = new FakeFs();
  const logs: string[] = [];
  const logger: Logger = { log: (l, m) => logs.push(`${l}: ${m}`) };
  const notes: string[] = [];
  const clicks: (NotificationTarget | undefined)[] = [];
  const calls: { pdf: string; options: AnalyzeOptions }[] = [];
  let online = true;
  let changeListener: (() => void) | undefined;
  let tick: (() => void) | undefined;
  let timers = 0;
  const env = {
    next: { ok: true, info: INFO } as AnalyzeResult | Error,
    /** Runs while the model "works", e.g. to drop the connection before the result arrives. */
    during: undefined as (() => void) | undefined,
  };
  const service: ImportService = createImportService({
    imports: store.imports,
    settings,
    apiKeys,
    analyze: async (pdf, options) => {
      calls.push({ pdf: pdf.toString(), options });
      env.during?.();
      if (env.next instanceof Error) throw env.next;
      return env.next;
    },
    fs,
    notifier: {
      notify: ({ title, body, onClick }) => {
        notes.push(`${title}|${body}`);
        clicks.push(onClick);
      },
    },
    logger,
    clock: { now: () => new Date(2026, 9, 15, 12, 0, 0) },
    connectivity: {
      isOnline: () => online,
      onChange: (l) => {
        changeListener = l;
        return () => (changeListener = undefined);
      },
    },
    scheduler: {
      every: (ms, fn) => {
        expect(ms).toBe(OFFLINE_CHECK_INTERVAL_MS);
        timers++;
        tick = fn;
        return () => {
          timers--;
          tick = undefined;
        };
      },
    },
  });
  service.start();
  const inboxChanges: InboxChange[] = [];
  const historyChanges: HistoryChange[] = [];
  const analyzingIds: (number | null)[] = [];
  service.onInboxChanged((c) => inboxChanges.push(c));
  service.onHistoryChanged((c) => historyChanges.push(c));
  service.onAnalyzingChange((id) => analyzingIds.push(id));
  return {
    store,
    secrets,
    apiKeys,
    fs,
    logs,
    notes,
    clicks,
    calls,
    env,
    service,
    setOnline: (v: boolean) => (online = v),
    wake: () => changeListener?.(),
    tick: () => tick?.(),
    timers: () => timers,
    inboxChanges,
    historyChanges,
    analyzingIds,
    /** Inbox rows, oldest first. */
    inbox: () => store.imports.unprocessed.list().reverse(),
    /** Filed documents, oldest first. */
    history: () => store.imports.processed.listRecent(100).reverse(),
  };
}

const failure = (kind: AnalyzeFailureKind, message = `msg ${kind}`): AnalyzeResult => ({
  ok: false,
  failure: { kind, message } as Extract<AnalyzeResult, { ok: false }>['failure'],
});

describe('import service', () => {
  it('files a new PDF: shows it as pending first, then writes a processed row and removes the inbox row', async () => {
    const t = setup();
    await t.apiKeys.set(API_KEY);
    t.fs.add('/inbox/scan.pdf');
    await t.service.handleFile('/inbox/scan.pdf');

    expect(t.inbox()).toEqual([]);
    const [row] = t.history();
    expect(row).toMatchObject({
      contentHash: sha(CONTENT),
      originalName: 'scan.pdf',
      targetPath: '/target/Health/Health insurance/2026-10-15_Northwind_Invoice.pdf',
      documentDate: '2026-10-15',
      sender: 'Northwind',
      category: 'Health/Health insurance',
      title: 'Invoice',
      model: 'google/gemini-2.5-flash',
      filedAt: new Date(2026, 9, 15, 12, 0, 0).toISOString(),
    });
    expect(t.fs.files.has('/inbox/scan.pdf')).toBe(false);
    expect(t.fs.files.has(row!.targetPath)).toBe(true);
    expect(t.notes).toEqual(['Filey|Filed: 2026-10-15_Northwind_Invoice.pdf → Health/Health insurance']);
    // Clicking the notification reveals the filed file (arc42 §6.1 step 8).
    expect(t.clicks).toEqual([
      {
        kind: 'reveal',
        path: '/target/Health/Health insurance/2026-10-15_Northwind_Invoice.pdf',
      },
    ]);
    expect(t.calls[0]!.options.apiKey).toBe(API_KEY);

    expect(t.inboxChanges).toHaveLength(2);
    const [first, second] = t.inboxChanges;
    expect(first).toMatchObject({
      kind: 'upsert',
      record: { status: 'pending', inboxPath: '/inbox/scan.pdf' },
    });
    expect(second).toEqual({
      kind: 'remove',
      id: (first as { record: { id: number } }).record.id,
    });
    expect(t.historyChanges).toEqual([{ kind: 'upsert', record: row }]);
    expect(t.service.getHistoryEntry(row!.id)).toEqual(row);
    expect(t.service.getHistoryEntry(row!.id + 100)).toBeUndefined();
    expect(t.service.listHistory(10)).toEqual([row]);
    expect(t.service.listInbox()).toEqual([]);
  });

  describe('duplicates', () => {
    it('marks a known hash as duplicate, does not call the model, keeps the file, links the original and notifies once', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      const [original] = t.history();
      t.fs.add('/inbox/b.pdf');
      await t.service.handleFile('/inbox/b.pdf');

      expect(t.calls).toHaveLength(1);
      expect(t.inbox()).toMatchObject([
        {
          inboxPath: '/inbox/b.pdf',
          fileName: 'b.pdf',
          status: 'duplicate',
          duplicateOfId: original!.id,
          contentHash: sha(CONTENT),
        },
      ]);
      expect(t.service.getInboxEntry(t.inbox()[0]!.id)).toEqual(t.inbox()[0]);
      expect(t.fs.files.has('/inbox/b.pdf')).toBe(true);
      expect(t.notes).toEqual([
        'Filey|Filed: 2026-10-15_Northwind_Invoice.pdf → Health/Health insurance',
        'Filey|Duplicate: b.pdf is already filed as 2026-10-15_Northwind_Invoice.pdf',
      ]);
      expect(t.clicks[1]).toEqual({
        kind: 'reveal',
        path: original!.targetPath,
      });

      // Seeing the same duplicate file again (e.g. after a restart) adds no row, no change and no notification.
      const changes = t.inboxChanges.length;
      await t.service.handleFile('/inbox/b.pdf');
      expect(t.inbox()).toHaveLength(1);
      expect(t.inboxChanges).toHaveLength(changes);
      expect(t.notes).toHaveLength(2);
    });

    it('prunes a history entry whose filed document is gone and imports the new file normally', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      const [gone] = t.history();
      t.fs.files.delete(gone!.targetPath);

      t.fs.add('/inbox/b.pdf');
      await t.service.handleFile('/inbox/b.pdf');

      expect(t.calls).toHaveLength(2);
      expect(t.history()).toHaveLength(1);
      expect(t.historyChanges).toContainEqual({ kind: 'remove', id: gone!.id });
      expect(t.inbox()).toEqual([]);
    });

    it('prunes the missing entries and still finds a live original with the same hash', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      const base = {
        contentHash: sha(CONTENT),
        originalName: 'x.pdf',
        documentDate: null,
        sender: null,
        category: null,
        title: null,
        model: null,
        filedAt: 'x',
      };
      const gone = t.store.imports.markFiled('/inbox/none.pdf', {
        ...base,
        targetPath: '/target/gone.pdf',
      });
      const live = t.store.imports.markFiled('/inbox/none.pdf', {
        ...base,
        targetPath: '/target/live.pdf',
      });
      t.fs.add('/target/live.pdf');
      t.fs.add('/inbox/c.pdf');
      await t.service.handleFile('/inbox/c.pdf');
      expect(t.calls).toHaveLength(0);
      expect(t.history().map((r) => r.id)).toEqual([live.id]);
      expect(t.historyChanges).toEqual([{ kind: 'remove', id: gone.id }]);
      expect(t.inbox()).toMatchObject([{ status: 'duplicate', duplicateOfId: live.id }]);
    });

    it('turns a failed file into a duplicate when its content was filed meanwhile', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('provider_error');
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      const id = t.inbox()[0]!.id;
      const filed = t.store.imports.markFiled('/inbox/other.pdf', {
        contentHash: sha(CONTENT),
        originalName: 'o.pdf',
        targetPath: '/target/o.pdf',
        documentDate: null,
        sender: null,
        category: null,
        title: null,
        model: null,
        filedAt: 'x',
      });
      t.fs.add('/target/o.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      expect(t.calls).toHaveLength(1);
      expect(t.inbox()).toMatchObject([{ id, status: 'duplicate', duplicateOfId: filed.id, error: null }]);
      expect(t.notes.at(-1)).toBe('Filey|Duplicate: a.pdf is already filed as o.pdf');
    });
  });

  describe('API key', () => {
    it('pauses on a missing key, keeps files, and imports them once the key is saved', async () => {
      const t = setup();
      t.fs.add('/inbox/a.pdf');
      t.fs.add('/inbox/b.pdf', 'other');
      await t.service.handleFile('/inbox/a.pdf');
      await t.service.handleFile('/inbox/b.pdf');
      expect(t.service.getState()).toEqual({
        mode: 'paused',
        reason: 'missing',
      });
      expect(t.calls).toHaveLength(0);
      expect(t.inbox()).toHaveLength(0);
      expect(t.fs.files.has('/inbox/a.pdf')).toBe(true);

      const states: string[] = [];
      t.service.onStateChange((s) => states.push(s.mode));
      await t.apiKeys.set(API_KEY);
      await t.service.handleFile('/inbox/none.pdf'); // waits for the resume work in the serial queue
      expect(states).toEqual(['running']);
      expect(t.history()).toHaveLength(2);
      expect(t.calls.map((c) => c.pdf)).toEqual([CONTENT, 'other']);
    });

    it('pauses on an unreadable key', async () => {
      const t = setup();
      t.secrets.get = async () => {
        throw new Error('cannot decrypt');
      };
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      expect(t.service.getState()).toEqual({
        mode: 'paused',
        reason: 'unreadable',
      });
      expect(t.calls).toHaveLength(0);
      expect(t.fs.files.has('/inbox/a.pdf')).toBe(true);
    });

    it('pauses when the key is cleared while running', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      await t.apiKeys.clear();
      expect(t.service.getState()).toEqual({
        mode: 'paused',
        reason: 'missing',
      });
    });

    it('checkKey() pauses on start when the stored key is unreadable, without a file (arc42 §6.6)', async () => {
      const t = setup();
      t.secrets.get = async () => {
        throw new Error('cannot decrypt');
      };
      await t.service.checkKey();
      expect(t.service.getState()).toEqual({
        mode: 'paused',
        reason: 'unreadable',
      });
      expect(t.calls).toHaveLength(0);
    });

    it('checkKey() stays running with a usable key and pauses with a missing one', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      await t.service.checkKey();
      expect(t.service.getState()).toEqual({ mode: 'running' });
      await t.secrets.delete('openrouter-api-key');
      await t.service.checkKey();
      expect(t.service.getState()).toEqual({
        mode: 'paused',
        reason: 'missing',
      });
    });
  });

  describe('failures', () => {
    it.each(['invalid_result', 'invalid_key', 'provider_error', 'password_protected', 'timeout'] as const)(
      '%s leaves the file, records failed with the error, notifies once',
      async (kind) => {
        const t = setup();
        await t.apiKeys.set(API_KEY);
        t.env.next = failure(kind);
        t.fs.add('/inbox/scan.pdf');
        await t.service.handleFile('/inbox/scan.pdf');

        expect(t.fs.files.has('/inbox/scan.pdf')).toBe(true);
        expect(t.inbox()).toMatchObject([
          {
            status: 'failed',
            error: `msg ${kind}`,
            contentHash: sha(CONTENT),
            inboxPath: '/inbox/scan.pdf',
          },
        ]);
        expect(t.history()).toHaveLength(0);
        expect(t.notes).toEqual([`Filey|Could not file scan.pdf: msg ${kind}`]);
        // Clicking the error notification opens the Inbox view (arc42 §6.5).
        expect(t.clicks).toEqual([{ kind: 'inbox' }]);
        expect(t.service.getState().mode).toBe('running');
      },
    );

    it('queues a timeout instead of failing it when the connection dropped meanwhile', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('timeout');
      t.env.during = () => t.setOnline(false);
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');

      expect(t.inbox()).toMatchObject([{ status: 'pending' }]);
      expect(t.notes).toEqual([]);
      expect(t.service.getState().mode).toBe('offline');
      expect(t.service.queuedCount()).toBe(1);
    });

    it('records a move error as failed', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.fs.add('/inbox/scan.pdf');
      t.fs.failRename = new Error('EACCES: permission denied');
      await t.service.handleFile('/inbox/scan.pdf');
      expect(t.fs.files.has('/inbox/scan.pdf')).toBe(true);
      expect(t.inbox()).toMatchObject([{ status: 'failed', error: 'EACCES: permission denied' }]);
      expect(t.notes).toHaveLength(1);
    });

    it('records an unexpected analyzer exception as failed', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = new Error('boom');
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      expect(t.inbox()).toMatchObject([{ status: 'failed', error: 'boom' }]);
    });

    it('does not retry a failed file by itself (e.g. after a restart) but retry() reuses the same row', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('provider_error');
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf'); // watcher emits it again at the next start
      expect(t.calls).toHaveLength(1);
      expect(t.notes).toHaveLength(1);

      t.env.next = { ok: true, info: INFO };
      const id = t.inbox()[0]!.id;
      expect(await t.service.retry(id)).toBe('started');
      expect(t.inbox()).toHaveLength(0);
      expect(t.history()).toHaveLength(1);
      expect(t.inboxChanges.at(-1)).toEqual({ kind: 'remove', id });
      expect(t.notes).toHaveLength(2);
      expect(await t.service.retry(id)).toBe('not-found');
      expect(await t.service.retry(999)).toBe('not-found');
    });

    it('retry keeps the same row id while it fails again, and refuses rows that are not failed', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('provider_error');
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      const id = t.inbox()[0]!.id;
      t.env.next = failure('invalid_result');
      expect(await t.service.retry(id)).toBe('started');
      expect(t.inbox()).toMatchObject([{ id, status: 'failed', error: 'msg invalid_result' }]);

      t.env.next = { ok: true, info: INFO };
      t.fs.add('/inbox/dup.pdf', 'other');
      t.fs.add('/inbox/dup2.pdf', 'other');
      await t.service.handleFile('/inbox/dup.pdf');
      await t.service.handleFile('/inbox/dup2.pdf');
      const dup = t.inbox().find((r) => r.status === 'duplicate')!;
      expect(await t.service.retry(dup.id)).toBe('not-failed');
    });

    it('retries a failed file again on a changed content without waiting for a retry', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('provider_error');
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      t.env.next = { ok: true, info: INFO };
      t.fs.add('/inbox/scan.pdf', 'a different scan under the same name');
      await t.service.handleFile('/inbox/scan.pdf');
      expect(t.history()).toHaveLength(1);
      expect(t.inbox()).toHaveLength(0);
    });

    it('retry reports a file that is no longer in the inbox', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('invalid_key');
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      t.fs.files.delete('/inbox/scan.pdf');
      expect(await t.service.retry(t.inbox()[0]!.id)).toBe('file-missing');
    });
  });

  describe('vanished', () => {
    it('is neither a row nor a notification when the file is gone before reading', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      await t.service.handleFile('/inbox/gone.pdf');
      expect(t.inbox()).toHaveLength(0);
      expect(t.history()).toHaveLength(0);
      expect(t.notes).toHaveLength(0);
      expect(t.logs.some((l) => l.startsWith('info: ') && l.includes('handled elsewhere'))).toBe(true);
      expect(t.logs.some((l) => l.startsWith('error'))).toBe(false);
    });

    it('deletes the inbox row of a file that vanished, e.g. a failed one removed in the meantime', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('provider_error');
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      const id = t.inbox()[0]!.id;
      t.fs.files.delete('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      expect(t.inbox()).toHaveLength(0);
      expect(t.inboxChanges.at(-1)).toEqual({ kind: 'remove', id });
    });

    it('is handled elsewhere when the Filer reports the source gone during filing', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.fs.add('/inbox/scan.pdf');
      const origExists = t.fs.exists.bind(t.fs);
      t.fs.exists = async (p) => (p === '/inbox/scan.pdf' ? false : origExists(p));
      await t.service.handleFile('/inbox/scan.pdf');
      expect(t.inbox()).toHaveLength(0);
      expect(t.history()).toHaveLength(0);
      expect(t.notes).toHaveLength(0);
      expect(t.inboxChanges.at(-1)).toMatchObject({ kind: 'remove' });
      expect(t.logs.filter((l) => l.startsWith('error'))).toHaveLength(0);
    });
  });

  describe('inbox changes from the watcher', () => {
    it('handleRemoved drops the inbox row and the file from the waiting queues', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('offline');
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      expect(t.service.queuedCount()).toBe(1);
      const id = t.inbox()[0]!.id;

      t.service.handleRemoved('/inbox/a.pdf');
      expect(t.inbox()).toHaveLength(0);
      expect(t.inboxChanges.at(-1)).toEqual({ kind: 'remove', id });
      expect(t.service.queuedCount()).toBe(0);

      const changes = t.inboxChanges.length;
      t.service.handleRemoved('/inbox/a.pdf'); // unknown path: nothing happens
      expect(t.inboxChanges).toHaveLength(changes);
    });

    it('handleRemoved forgets a file that waits for a key', async () => {
      const t = setup();
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      t.service.handleRemoved('/inbox/a.pdf');
      await t.apiKeys.set(API_KEY);
      await t.service.handleFile('/inbox/none.pdf');
      expect(t.calls).toHaveLength(0);
    });

    it('reconcileInbox removes rows whose file is no longer in the inbox and keeps the others', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('provider_error');
      t.fs.add('/inbox/a.pdf', 'A');
      t.fs.add('/inbox/b.pdf', 'B');
      await t.service.handleFile('/inbox/a.pdf');
      await t.service.handleFile('/inbox/b.pdf');
      const [a, b] = t.inbox();

      t.service.reconcileInbox(['/inbox/b.pdf']);
      expect(t.inbox().map((r) => r.id)).toEqual([b!.id]);
      expect(t.inboxChanges.at(-1)).toEqual({ kind: 'remove', id: a!.id });
      expect(t.service.listInbox().map((r) => r.id)).toEqual([b!.id]);
    });
  });

  describe('offline', () => {
    it('queues on an offline result, notifies nothing, and drains in order once online', async () => {
      const t = setup();
      const counts: number[] = [];
      t.service.onQueuedCountChange((n) => counts.push(n));
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('offline');
      t.fs.add('/inbox/a.pdf', 'A');
      t.fs.add('/inbox/b.pdf', 'B');
      t.fs.add('/inbox/c.pdf', 'C');
      await t.service.handleFile('/inbox/a.pdf');
      expect(t.service.getState().mode).toBe('offline');
      await t.service.handleFile('/inbox/b.pdf');
      await t.service.handleFile('/inbox/c.pdf');

      // Only the first file reached the model; the others were queued without a call.
      expect(t.calls.map((c) => c.pdf)).toEqual(['A']);
      expect(t.inbox().map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
      expect(t.notes).toHaveLength(0);
      expect(t.service.queuedCount()).toBe(3);
      expect(t.fs.files.has('/inbox/a.pdf')).toBe(true);
      expect(t.timers()).toBe(1);

      // Still offline: the periodic check does nothing.
      t.setOnline(false);
      t.tick();
      expect(t.service.getState().mode).toBe('offline');

      t.setOnline(true);
      t.env.next = { ok: true, info: INFO };
      t.tick();
      await t.service.handleFile('/inbox/none.pdf'); // waits for the drain
      expect(t.service.getState().mode).toBe('running');
      expect(t.timers()).toBe(0);
      expect(t.inbox()).toHaveLength(0);
      expect(t.history()).toHaveLength(3);
      expect(t.calls.map((c) => c.pdf).slice(1)).toEqual(['A', 'B', 'C']);
      expect(t.notes).toHaveLength(3);
      expect(t.service.queuedCount()).toBe(0);
      expect(counts).toEqual([1, 2, 3, 2, 1, 0]);
    });

    it('queues without a model call when the system reports offline and resumes on a wake event', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.setOnline(false);
      t.fs.add('/inbox/a.pdf');
      await t.service.handleFile('/inbox/a.pdf');
      expect(t.calls).toHaveLength(0);
      expect(t.inbox()).toMatchObject([{ status: 'pending' }]);
      expect(t.service.getState().mode).toBe('offline');

      t.setOnline(true);
      t.wake();
      await t.service.handleFile('/inbox/none.pdf');
      expect(t.inbox()).toHaveLength(0);
      expect(t.history()).toHaveLength(1);
      expect(t.notes).toHaveLength(1);
    });

    it('goes offline again when the connection drops during the drain and keeps the remaining files queued', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('offline');
      t.fs.add('/inbox/a.pdf', 'A');
      t.fs.add('/inbox/b.pdf', 'B');
      await t.service.handleFile('/inbox/a.pdf');
      await t.service.handleFile('/inbox/b.pdf');

      t.wake(); // system says online, but OpenRouter is still unreachable
      await t.service.handleFile('/inbox/none.pdf');
      expect(t.service.getState().mode).toBe('offline');
      expect(t.service.queuedCount()).toBe(2);
      expect(t.inbox().map((r) => r.status)).toEqual(['pending', 'pending']);
      expect(t.notes).toHaveLength(0);
      expect(t.timers()).toBe(1);

      t.env.next = { ok: true, info: INFO };
      t.tick();
      await t.service.handleFile('/inbox/none.pdf');
      expect(t.history()).toHaveLength(2);
      expect(t.inbox()).toHaveLength(0);
    });

    it('reuses a pending row from a previous session', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      const old = t.store.imports.unprocessed.upsert({
        inboxPath: '/inbox/scan.pdf',
        fileName: 'scan.pdf',
        contentHash: sha(CONTENT),
        status: 'pending',
        now: 'x',
      });
      t.fs.add('/inbox/scan.pdf');
      await t.service.handleFile('/inbox/scan.pdf');
      expect(t.history()).toHaveLength(1);
      expect(t.inbox()).toHaveLength(0);
      expect(t.inboxChanges).toEqual([{ kind: 'remove', id: old.id }]);
    });

    it('drops a file removed while it waits so the drain does not skip the next one', async () => {
      const t = setup();
      await t.apiKeys.set(API_KEY);
      t.env.next = failure('offline');
      t.fs.add('/inbox/a.pdf', 'A');
      t.fs.add('/inbox/b.pdf', 'B');
      await t.service.handleFile('/inbox/a.pdf');
      await t.service.handleFile('/inbox/b.pdf');
      t.service.handleRemoved('/inbox/a.pdf');
      t.fs.files.delete('/inbox/a.pdf');
      t.env.next = { ok: true, info: INFO };
      t.setOnline(true);
      t.tick();
      await t.service.handleFile('/inbox/none.pdf');
      expect(t.history().map((r) => r.originalName)).toEqual(['b.pdf']);
      expect(t.service.queuedCount()).toBe(0);
    });
  });

  it('serializes imports: one at a time', async () => {
    const t = setup();
    await t.apiKeys.set(API_KEY);
    t.fs.add('/inbox/a.pdf', 'A');
    t.fs.add('/inbox/b.pdf', 'B');
    let running = 0;
    let max = 0;
    const original = t.fs.readFile.bind(t.fs);
    t.fs.readFile = async (p) => {
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return original(p);
    };
    await Promise.all([t.service.handleFile('/inbox/a.pdf'), t.service.handleFile('/inbox/b.pdf')]);
    expect(max).toBe(1);
    expect(t.history()).toHaveLength(2);
  });

  it('never logs the API key or document contents', async () => {
    const t = setup();
    await t.apiKeys.set(API_KEY);
    t.fs.add('/inbox/ok.pdf');
    t.fs.add('/inbox/dup.pdf');
    t.fs.add('/inbox/bad.pdf', 'bad');
    await t.service.handleFile('/inbox/ok.pdf');
    await t.service.handleFile('/inbox/dup.pdf');
    t.env.next = failure('invalid_key');
    await t.service.handleFile('/inbox/bad.pdf');
    t.env.next = failure('offline');
    t.fs.add('/inbox/off.pdf', 'off');
    await t.service.handleFile('/inbox/off.pdf');
    const all = [...t.logs, ...t.notes].join('\n');
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain(CONTENT);
    expect(all).toContain(sha(CONTENT).slice(0, 12));
  });

  it('reports the id of the inbox entry being analyzed and filed, also when it fails', async () => {
    const t = setup();
    await t.apiKeys.set(API_KEY);
    let during: number | null | undefined;
    let duringRowId: number | undefined;
    const original = t.fs.rename.bind(t.fs);
    t.fs.rename = async (from, to) => {
      during = t.service.analyzingId();
      duringRowId = t.inbox()[0]?.id;
      return original(from, to);
    };
    t.fs.add('/inbox/a.pdf');
    await t.service.handleFile('/inbox/a.pdf');
    expect(during).toBe(duringRowId);
    expect(during).toEqual(expect.any(Number));
    expect(t.service.analyzingId()).toBeNull();
    t.env.next = failure('invalid_result');
    t.fs.add('/inbox/b.pdf', 'other');
    await t.service.handleFile('/inbox/b.pdf');
    expect(t.analyzingIds).toEqual([during, null, t.inbox()[0]!.id, null]);
    // A duplicate is not analyzed at all.
    t.fs.add('/inbox/c.pdf');
    await t.service.handleFile('/inbox/c.pdf');
    expect(t.analyzingIds).toHaveLength(4);
  });

  it('stop() removes listeners and timers', async () => {
    const t = setup();
    await t.apiKeys.set(API_KEY);
    t.env.next = failure('offline');
    t.fs.add('/inbox/a.pdf');
    await t.service.handleFile('/inbox/a.pdf');
    t.service.stop();
    expect(t.timers()).toBe(0);
    t.wake();
    expect(t.service.getState().mode).toBe('offline');
  });
});
