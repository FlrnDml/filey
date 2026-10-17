import * as path from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import type { Logger } from '../ports';
import { placeholderToRealPath } from '../icloud/placeholder';
import { isCandidatePdf } from './filter';

/** The subset of a chokidar `FSWatcher` the Watcher uses; tests pass a fake. */
export interface WatcherSource {
  on(event: 'add' | 'unlink', listener: (filePath: string) => void): unknown;
  on(event: 'ready', listener: () => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  close(): Promise<void>;
}

export interface SourceOptions {
  /** Poll the folder (FSEvents are unreliable for iCloud, arc42 §4). */
  usePolling: boolean;
  interval: number;
  /** Only the inbox itself is watched, never its subfolders. */
  depth: 0;
  /** Emit files that are already present at start-up. */
  ignoreInitial: false;
  /** Wait until size and mtime are stable. */
  awaitWriteFinish: { stabilityThreshold: number; pollInterval: number };
  ignored: (filePath: string) => boolean;
}

export type SourceFactory = (inboxPath: string, options: SourceOptions) => WatcherSource;

export interface WatcherOptions {
  inboxPath: string;
  /** Called with the path of each new, stable PDF, one at a time (the next call waits for the previous to settle). */
  onFile: (filePath: string) => void | Promise<void>;
  logger: Logger;
  /**
   * Runs before `onFile`; if it rejects, the error is logged and the file is skipped. Setting it also turns on
   * iCloud placeholder handling: a `.<name>.pdf.icloud` placeholder is queued as the real `<name>.pdf`
   * with `viaPlaceholder: true`, so `prepare` (see `createICloudPrepare`) can download it first. Without
   * `prepare`, placeholders are ignored.
   */
  prepare?: (filePath: string, info: { viaPlaceholder: boolean }) => Promise<void>;
  /**
   * Called when a candidate PDF leaves the inbox (deleted, moved, trashed). Not called for an iCloud placeholder
   * that vanishes because its download completed.
   */
  onRemove?: (filePath: string) => void;
  /**
   * Called once per start after chokidar's initial scan with the candidate PDFs found in the inbox (real paths,
   * placeholders mapped to the file they stand for). Fires again after `restart` for the new inbox.
   */
  onReady?: (presentPaths: string[]) => void;
  /** Polling interval in ms. Default 2000. */
  pollInterval?: number;
  /** How long size and mtime must stay unchanged, in ms. Default 2000. */
  stabilityThreshold?: number;
  /** Creates the chokidar instance; injectable for tests. */
  createSource?: SourceFactory;
}

export interface Watcher {
  /** Starts watching; no-op if already running. Never throws. */
  start(): void;
  /** Stops watching and drops queued files; an import already running is not interrupted. */
  stop(): void;
  /** Stops, switches to a new inbox (e.g. after a settings change) and starts again. */
  restart(newInboxPath: string): void;
}

const defaultSource: SourceFactory = (inboxPath, options) => chokidarWatch(inboxPath, options);

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function createSafeCall(logger: Logger) {
  return (fn: () => void, what: string) => {
    try {
      fn();
    } catch (err) {
      logger.log('error', `Watcher: ${what} failed: ${errorText(err)}`);
    }
  };
}

export function createWatcher(options: WatcherOptions): Watcher {
  const { onFile, onRemove, onReady, logger, prepare, createSource = defaultSource } = options;
  const safeCall = createSafeCall(logger);
  const pollInterval = options.pollInterval ?? 2000;
  const stabilityThreshold = options.stabilityThreshold ?? 2000;
  let inboxPath = options.inboxPath;
  let source: WatcherSource | undefined;
  /** Bumped on every start/stop so late events and queued work of an old run are discarded. */
  let generation = 0;
  /** Paths that are queued or running, so the same path is not queued twice. */
  const pending = new Set<string>();
  const queue: string[] = [];
  /** Queued or running real paths that were reached through a placeholder. */
  const viaPlaceholder = new Set<string>();
  /** Real paths already emitted via their placeholder: the real file's own `add` must not emit them again. */
  const delivered = new Set<string>();
  let draining = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let filePath = queue.shift(); filePath !== undefined; filePath = queue.shift()) {
        try {
          const via = viaPlaceholder.has(filePath);
          if (prepare) await prepare(filePath, { viaPlaceholder: via });
          await onFile(filePath);
          if (via) delivered.add(filePath);
        } catch (err) {
          logger.log('error', `Watcher: handling ${filePath} failed: ${errorText(err)}`);
        } finally {
          pending.delete(filePath);
          viaPlaceholder.delete(filePath);
        }
      }
    } finally {
      draining = false;
    }
  }

  function enqueue(filePath: string, gen: number): void {
    if (gen !== generation) return;
    const realPath = prepare ? placeholderToRealPath(filePath) : undefined;
    const target = realPath ?? filePath;
    if (!isCandidatePdf(target) || pending.has(target)) return;
    if (realPath === undefined && delivered.delete(target)) return;
    logger.log('debug', `Watcher: detected ${filePath}`);
    if (realPath !== undefined) viaPlaceholder.add(target);
    pending.add(target);
    queue.push(target);
    void drain();
  }

  function start(): void {
    if (source) return;
    const gen = ++generation;
    /** Candidate PDFs seen so far; reported by `onReady`. */
    const present = new Set<string>();
    const inbox = path.resolve(inboxPath);
    try {
      const src = createSource(inbox, {
        usePolling: true,
        interval: pollInterval,
        depth: 0,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold,
          pollInterval: Math.min(pollInterval, 100),
        },
        // Hidden entries (.DS_Store, temp files) except iCloud placeholders when `prepare` can handle them;
        // never ignore the inbox itself.
        ignored: (p) => p !== inbox && path.basename(p).startsWith('.') && !(prepare && placeholderToRealPath(p)),
      });
      src.on('add', (p) => {
        if (gen !== generation) return;
        const target = (prepare ? placeholderToRealPath(p) : undefined) ?? p;
        if (isCandidatePdf(target)) present.add(target);
        enqueue(p, gen);
      });
      // A file that disappears before it is processed is dropped; if it comes back it is a new appearance.
      src.on('unlink', (p) => {
        if (gen !== generation || (prepare && placeholderToRealPath(p))) return; // a placeholder vanishes when its download completes
        delivered.delete(p);
        if (isCandidatePdf(p)) {
          present.delete(p);
          safeCall(() => onRemove?.(p), 'onRemove');
        }
        const i = queue.indexOf(p);
        if (i < 0) return;
        queue.splice(i, 1);
        pending.delete(p);
      });
      src.on('ready', () => {
        if (gen !== generation) return;
        safeCall(() => onReady?.([...present]), 'onReady');
      });
      src.on('error', (err) => logger.log('error', `Watcher error: ${errorText(err)}`));
      source = src;
      logger.log('info', `Watcher: watching ${inbox}`);
    } catch (err) {
      logger.log('error', `Watcher: could not start on ${inbox}: ${errorText(err)}`);
    }
  }

  function stop(): void {
    generation++;
    for (const p of queue.splice(0)) {
      pending.delete(p);
      viaPlaceholder.delete(p);
    }
    delivered.clear();
    const closing = source;
    source = undefined;
    if (!closing) return;
    closing.close().catch((err: unknown) => logger.log('error', `Watcher: close failed: ${errorText(err)}`));
    logger.log('info', 'Watcher: stopped');
  }

  return {
    start,
    stop,
    restart(newInboxPath) {
      stop();
      inboxPath = newInboxPath;
      start();
    },
  };
}
