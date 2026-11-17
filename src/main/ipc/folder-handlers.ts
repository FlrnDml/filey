import { resolveModelConfig, type DescribeFoldersResult, type FolderSample, type ModelConfig } from '../../core/analyzer';
import type { ApiKeyStore } from '../../core/api-key';
import { IPC_CHANNELS, MAX_DESCRIBE_FOLDERS, type ScanView, type SuggestDescriptionsResult } from '../../core/ipc';
import { MAX_APPLY_RENAMES, MAX_SUGGEST_NAMES, type Renamer } from '../../core/renamer';
import type { ScanResult, ScanService } from '../../core/scanner';
import type { Logger } from '../../core/ports';
import type { SettingsRepository } from '../../core/settings';
import type { IpcHandlers } from './register';
import { expectArity, expectArray, expectNoArgs, expectString, IpcValidationError, MAX_PATH_LENGTH } from './validate';

export interface FolderHandlerDeps {
  scans: ScanService;
  renamer: Renamer;
  settings: Pick<SettingsRepository, 'getSettings'>;
  apiKeys: Pick<ApiKeyStore, 'get'>;
  /** `describeFolders` from the analyzer (one request to the selected provider). */
  describeFolders(folders: readonly FolderSample[], config: ModelConfig): Promise<DescribeFoldersResult>;
  logger: Logger;
}

export const FOLDER_MESSAGES = {
  noScan: 'Scan the target folder first.',
} as const;

/**
 * A list of paths relative to the target folder. Main looks every path up in its last scan before it uses it, so this
 * only checks the shape: no absolute paths, no `.`/`..` parts, no backslashes.
 */
export function expectRelativePaths(value: unknown, name: string, max: number): string[] {
  return expectArray(value, name, { max }).map((entry) => {
    const rel = expectString(entry, `${name} entry`, { max: MAX_PATH_LENGTH });
    if (rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new IpcValidationError(`${name} entry must be a relative path`);
    }
    return rel;
  });
}

export const toScanView = (scan: ScanResult): ScanView => ({
  folders: scan.folders,
  fileCount: scan.files.length,
  truncated: scan.truncated,
  scannedAt: scan.scannedAt,
});

/** IPC for the folder tree, "Map folders" and the rename queue (arc42 §5.4). */
export function createFolderHandlers(deps: FolderHandlerDeps): IpcHandlers {
  const { folders, names } = IPC_CHANNELS;
  const paths = (max: number) => (args: unknown[]): [string[]] => {
    expectArity(args, 1);
    return [expectRelativePaths(args[0], 'paths', max)];
  };

  return {
    [folders.scan]: {
      validate: expectNoArgs,
      handle: async () => {
        const outcome = await deps.scans.run();
        return outcome.ok ? { ok: true, scan: toScanView(outcome.scan) } : outcome;
      },
    },
    [folders.lastScan]: {
      validate: expectNoArgs,
      handle: () => {
        const scan = deps.scans.last();
        return scan ? toScanView(scan) : null;
      },
    },
    [folders.suggestDescriptions]: {
      validate: paths(MAX_DESCRIBE_FOLDERS),
      handle: async (requested): Promise<SuggestDescriptionsResult> => {
        const scan = deps.scans.last();
        if (!scan) return { ok: false, reason: 'no-scan', message: FOLDER_MESSAGES.noScan };
        // Only folders the scan found; their sample names come from the scan, never from the renderer.
        const byPath = new Map(scan.folders.map((folder) => [folder.path, folder]));
        const samples: FolderSample[] = [...new Set(requested)].flatMap((folder) => {
          const found = byPath.get(folder);
          return found ? [{ folder: found.path, sampleFileNames: found.sampleFileNames }] : [];
        });
        if (samples.length === 0) return { ok: true, rules: [] };
        const resolved = await resolveModelConfig(deps.settings.getSettings(), deps.apiKeys);
        if (!resolved.ok) return resolved;
        deps.logger.log('info', `Folders: asking ${resolved.config.provider} to describe ${samples.length} ${samples.length === 1 ? 'folder' : 'folders'}`);
        const result = await deps.describeFolders(samples, resolved.config);
        if (!result.ok) {
          deps.logger.log('warn', `Folders: describing failed (${result.failure.kind}): ${result.failure.message}`);
          return { ok: false, reason: 'failed', message: result.failure.message };
        }
        return { ok: true, rules: result.rules };
      },
    },
    [names.check]: { validate: expectNoArgs, handle: () => deps.renamer.check() },
    [names.suggest]: { validate: paths(MAX_SUGGEST_NAMES), handle: (list) => deps.renamer.suggest(list) },
    [names.apply]: { validate: paths(MAX_APPLY_RENAMES), handle: (list) => deps.renamer.apply(list) },
  };
}
