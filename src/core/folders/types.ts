/**
 * How the default folders were set up at the first launch. Kept free of Node imports so the renderer
 * and the IPC contract can use it.
 *
 * - `icloud`: `Filey/Inbox` was created in iCloud Drive (below `Documents`).
 * - `failed`: iCloud Drive is not available or the folder could not be created there; the user has to choose the folders in Settings → Filing.
 * - `kept`: nothing to do: the folders were set up or chosen earlier.
 */
export interface FolderSetup {
  status: 'icloud' | 'failed' | 'kept';
  /** Watched folder; on `failed`, the (not created) default. */
  inboxPath: string;
  /** Root folder of the filed documents; on `failed`, the (not created) default. */
  targetPath: string;
}
