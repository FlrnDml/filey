import type { Clock, ICloudDownloader, Logger } from '../ports';
import { realToPlaceholderPath } from './placeholder';

export type EnsureResult = 'ready' | 'timeout' | 'gone';

export interface FileStat {
  size: number;
  mtimeMs: number;
}

/** Read-only file access for the helper; it never writes, moves or deletes. Real implementation wraps `node:fs/promises`. */
export interface ICloudFiles {
  /** Undefined if the path does not exist. */
  stat(path: string): Promise<FileStat | undefined>;
  /** Reads the first bytes; on a dataless file this makes macOS download it. */
  readHead(path: string): Promise<void>;
}

export interface EnsureDownloadedDeps {
  files: ICloudFiles;
  downloader: ICloudDownloader;
  clock: Clock;
  /** Resolves after `ms`; injectable so tests need no real waiting. */
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
}

export interface EnsureDownloadedOptions {
  /** Give up after this long, in ms. Default 5 minutes. */
  timeoutMs?: number;
  /** Time between checks, in ms. Default 1000. */
  pollMs?: number;
  /** How long size and mtime must stay unchanged, in ms. Default 2000. */
  stableMs?: number;
}

/** Thrown by the `prepare` hook when a file could not be made available; `result` says why. */
export class ICloudDownloadError extends Error {
  constructor(
    readonly path: string,
    readonly result: Exclude<EnsureResult, 'ready'>,
  ) {
    super(`iCloud download of ${path} ended with "${result}"`);
    this.name = 'ICloudDownloadError';
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Resolves `ready` once the real file at `realPath` exists, its iCloud placeholder is gone and its size and
 * mtime have been stable; `timeout` if that does not happen in time; `gone` if neither the file nor its
 * placeholder exists. Requests the download when a placeholder is present. Never writes, moves or deletes.
 */
export async function ensureDownloaded(
  realPath: string,
  deps: EnsureDownloadedDeps,
  options: EnsureDownloadedOptions = {},
): Promise<EnsureResult> {
  const { files, clock, sleep, logger } = deps;
  const { timeoutMs = 5 * 60_000, pollMs = 1000, stableMs = 2000 } = options;
  const placeholder = realToPlaceholderPath(realPath);
  const deadline = clock.now().getTime() + timeoutMs;
  let requested = false;
  let last: FileStat | undefined;
  let stableSince = 0;

  for (;;) {
    const now = clock.now().getTime();
    const [real, placeholderStat] = await Promise.all([files.stat(realPath), files.stat(placeholder)]);
    if (!real && !placeholderStat) return 'gone';

    if (placeholderStat) {
      if (!requested) {
        requested = true;
        await requestDownload(realPath, deps);
      }
      last = undefined;
    } else if (real) {
      if (!last || last.size !== real.size || last.mtimeMs !== real.mtimeMs) {
        last = real;
        stableSince = now;
      } else if (now - stableSince >= stableMs) {
        return 'ready';
      }
    }

    if (now >= deadline) {
      logger.log('warn', `iCloud: ${realPath} was not downloaded within ${Math.round(timeoutMs / 1000)}s; file left untouched`);
      return 'timeout';
    }
    await sleep(pollMs);
  }
}

/** `brctl download`, falling back to a read when `brctl` fails (e.g. is missing). Failures are logged, not thrown. */
async function requestDownload(realPath: string, { files, downloader, logger }: EnsureDownloadedDeps): Promise<void> {
  logger.log('info', `iCloud: requesting download of ${realPath}`);
  try {
    await downloader.requestDownload(realPath);
  } catch (err) {
    logger.log('warn', `iCloud: brctl download failed for ${realPath} (${errorText(err)}); falling back to a read`);
    try {
      await files.readHead(realPath);
    } catch (readErr) {
      logger.log('warn', `iCloud: read fallback failed for ${realPath}: ${errorText(readErr)}`);
    }
  }
}

/**
 * Builds the Watcher's `prepare` hook: for a file reached via an iCloud placeholder it waits until the real
 * file is downloaded and stable, and rejects (so the Watcher logs and skips it) on `timeout` or `gone`.
 * Other files pass through untouched.
 */
export function createICloudPrepare(
  deps: EnsureDownloadedDeps,
  options?: EnsureDownloadedOptions,
): (filePath: string, info?: { viaPlaceholder: boolean }) => Promise<void> {
  return async (filePath, info) => {
    if (!info?.viaPlaceholder) return;
    const result = await ensureDownloaded(filePath, deps, options);
    if (result !== 'ready') throw new ICloudDownloadError(filePath, result);
  };
}
