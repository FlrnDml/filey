import { join } from 'node:path';
import type { FileSystem, Logger } from '../ports';
import type { Settings } from '../settings';
import type { FolderSetup } from './types';

/** Name of the folder Filey creates; the inbox is its subfolder `Inbox`, documents are filed next to it. */
export const FILEY_FOLDER = 'Filey';
export const INBOX_FOLDER = 'Inbox';

/** iCloud Drive's folder on disk; it only exists while iCloud Drive is switched on. */
export const iCloudDriveRoot = (home: string): string => join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');

/** `<base>/Filey` (target) and `<base>/Filey/Inbox` (inbox): the inbox is inside the target, so the rules work out of the box. */
export function foldersIn(base: string): Pick<Settings, 'inboxPath' | 'targetPath'> {
  const targetPath = join(base, FILEY_FOLDER);
  return { inboxPath: join(targetPath, INBOX_FOLDER), targetPath };
}

/** The settings the first-launch setup reads and writes. */
export interface FolderSettings {
  getSettings(): Settings;
  updateSettings(patch: Partial<Pick<Settings, 'inboxPath' | 'targetPath'>>): Settings;
  /** Whether the user (or an earlier setup) saved this folder, as opposed to the built-in default. */
  isStored(key: 'inboxPath' | 'targetPath'): boolean;
}

export interface FolderSetupDeps {
  settings: FolderSettings;
  fs: Pick<FileSystem, 'exists' | 'mkdir'>;
  home: string;
  logger: Logger;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * First launch (arc42 §6.4): creates `Documents/Filey/Inbox` in iCloud Drive and saves both folders, so Filey works
 * without a visit to Settings. If iCloud Drive is off or the folder cannot be created there, nothing is saved and the
 * result is `failed` (there is no other location: the user chooses the folders in Settings). Never throws. Does
 * nothing once onboarding is done or a folder was saved before (no surprises for existing setups).
 */
export async function setupDefaultFolders({ settings, fs, home, logger }: FolderSetupDeps): Promise<FolderSetup> {
  const current = settings.getSettings();
  if (current.onboardingCompleted || settings.isStored('inboxPath') || settings.isStored('targetPath')) {
    return { status: 'kept', inboxPath: current.inboxPath, targetPath: current.targetPath };
  }
  const failed: FolderSetup = { status: 'failed', inboxPath: current.inboxPath, targetPath: current.targetPath };

  // Without iCloud Drive the folder below does not exist, and creating it would only fake an iCloud folder.
  const root = iCloudDriveRoot(home);
  if (!(await fs.exists(root).catch(() => false))) {
    logger.log('warn', 'Folders: iCloud Drive is not available, the folders have to be chosen in Settings');
    return failed;
  }
  const folders = foldersIn(join(root, 'Documents'));
  try {
    await fs.mkdir(folders.inboxPath); // creates Documents (if missing), Filey and Filey/Inbox
    settings.updateSettings(folders);
  } catch (err) {
    logger.log('warn', `Folders: could not create ${FILEY_FOLDER}/${INBOX_FOLDER} in iCloud Drive: ${errorText(err)}`);
    return failed;
  }
  logger.log('info', `Folders: set up ${FILEY_FOLDER}/${INBOX_FOLDER} in iCloud Drive`);
  return { status: 'icloud', ...folders };
}
