import * as path from 'node:path';
import type { Clock, Logger } from '../ports';
import type { Settings } from '../settings';
import { scanFolder, type ScanFileSystem } from './scan';
import type { ScanResult } from './types';

export type ScanOutcome = { ok: true; scan: ScanResult } | { ok: false; reason: 'missing' | 'failed'; message: string };

export interface ScanService {
  /** Scans the current target folder and keeps the result in memory (arc42 §5.4). */
  run(): Promise<ScanOutcome>;
  /** The last scan of the current target folder; undefined if there is none or the target folder changed since. */
  last(): ScanResult | undefined;
}

export interface ScanServiceDeps {
  fs: ScanFileSystem;
  settings: { getSettings(): Pick<Settings, 'targetPath' | 'inboxPath'> };
  clock: Clock;
  logger: Logger;
}

export const SCAN_MESSAGES = {
  missing: 'The target folder does not exist. Choose another one above.',
  failed: 'Filey could not read the target folder.',
} as const;

const isCode = (err: unknown, code: string) => (err as { code?: string } | null)?.code === code;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs scans one at a time and keeps the last result; nothing is written to the database. */
export function createScanService({ fs, settings, clock, logger }: ScanServiceDeps): ScanService {
  let last: ScanResult | undefined;
  let running: Promise<ScanOutcome> | undefined;

  const scan = async (): Promise<ScanOutcome> => {
    const { targetPath, inboxPath } = settings.getSettings();
    try {
      const result = await scanFolder(targetPath, { fs, clock }, { inboxPath });
      last = result;
      logger.log(
        'info',
        `Scan: ${result.folders.length} folders, ${result.files.length} files in the target folder${result.truncated ? ' (cut short at the limit)' : ''}`,
      );
      return { ok: true, scan: result };
    } catch (err) {
      if (isCode(err, 'ENOENT') || isCode(err, 'ENOTDIR')) return { ok: false, reason: 'missing', message: SCAN_MESSAGES.missing };
      logger.log('error', `Scan: could not read the target folder: ${errorText(err)}`);
      return { ok: false, reason: 'failed', message: SCAN_MESSAGES.failed };
    }
  };

  return {
    run() {
      // A second Scan click while one runs gets the same result instead of a second walk.
      running ??= scan().finally(() => {
        running = undefined;
      });
      return running;
    },
    last() {
      if (!last) return undefined;
      return path.resolve(settings.getSettings().targetPath) === last.root ? last : undefined;
    },
  };
}
