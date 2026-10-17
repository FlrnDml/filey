import * as path from 'node:path';
import type { LogFileSystem, Logger } from '../ports';

export const LOG_FILE_NAME = 'filey.log';
/** The current file is rotated before it would grow beyond this (arc42 §8 "Logging": size-limited). */
export const MAX_LOG_BYTES = 1024 * 1024;
/** `filey.log` plus `filey.1.log` and `filey.2.log`; older lines are dropped. */
export const LOG_FILES_KEPT = 3;
/** Lines waiting for the disk; beyond this the oldest are dropped (and counted), so a stuck disk cannot eat memory. */
export const MAX_PENDING_LINES = 5000;

export interface LogFileOptions {
  fs: LogFileSystem;
  /** Folder of the log files (`app.getPath('logs')`, i.e. `~/Library/Logs/Filey`). */
  dir: string;
  maxBytes?: number;
  /** Number of files including the current one (at least 1). */
  keep?: number;
  /** Called when writing fails; the lines of that batch are lost. Must not log to this file. */
  onError?(error: unknown): void;
}

/** A size-limited, rotated log file. Lines are queued and written in the background, in order. */
export interface LogFile extends Logger {
  /** Absolute path of the current file (`…/filey.log`). */
  readonly path: string;
  /** Resolves once every line logged so far is on disk (or failed). */
  flush(): Promise<void>;
}

/** `[filey.log, filey.1.log, filey.2.log, …]` in `dir`. */
export function logFilePaths(dir: string, keep = LOG_FILES_KEPT): string[] {
  const base = path.parse(LOG_FILE_NAME);
  return Array.from({ length: Math.max(1, keep) }, (_, i) => path.join(dir, i === 0 ? LOG_FILE_NAME : `${base.name}.${i}${base.ext}`));
}

const isMissing = (err: unknown) => (err as { code?: string } | null)?.code === 'ENOENT';

/**
 * Creates the log file writer. `log` only queues the line and returns at once; one background task appends
 * the queued lines in batches. Before a batch would push the file beyond `maxBytes`, the files are shifted
 * (`filey.1.log` -> `filey.2.log`, `filey.log` -> `filey.1.log`), so at most `keep` files remain.
 * The `level` argument is ignored: callers pass finished lines (see `createAppLogger`).
 */
export function createLogFile({ fs, dir, maxBytes = MAX_LOG_BYTES, keep = LOG_FILES_KEPT, onError }: LogFileOptions): LogFile {
  const files = logFilePaths(dir, keep);
  const current = files[0]!;
  let pending: string[] = [];
  let dropped = 0;
  /** Size of the current file as far as this writer knows; undefined until read from disk. */
  let size: number | undefined;
  let writing: Promise<void> | undefined;

  const rotate = async () => {
    for (let i = files.length - 1; i >= 1; i--) {
      try {
        await fs.rename(files[i - 1]!, files[i]!);
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    }
    size = 0;
  };

  const writeBatch = async (lines: string[]) => {
    const text = lines.join('');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (size === undefined) {
      await fs.mkdir(dir);
      size = await fs.size(current);
    }
    if (size > 0 && size + bytes > maxBytes) await rotate();
    await fs.append(current, text);
    size += bytes;
  };

  const drain = async () => {
    while (pending.length > 0) {
      const batch = pending;
      pending = [];
      if (dropped > 0) {
        batch.unshift(`${new Date().toISOString()} WARN  Log: ${dropped} lines dropped, the log file could not keep up\n`);
        dropped = 0;
      }
      try {
        await writeBatch(batch);
      } catch (err) {
        // Read the size again next time: the failed write may have left the file in any state.
        size = undefined;
        onError?.(err);
      }
    }
    writing = undefined;
  };

  return {
    path: current,
    log(_level, line) {
      pending.push(`${line}\n`);
      if (pending.length > MAX_PENDING_LINES) {
        const excess = pending.length - MAX_PENDING_LINES;
        pending.splice(0, excess);
        dropped += excess;
      }
      writing ??= drain();
    },
    async flush() {
      while (writing) await writing;
    },
  };
}
