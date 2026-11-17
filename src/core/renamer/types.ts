/** Types of the rename queue (arc42 §5.4). Shared with the renderer through `src/core/ipc.ts`, so this file imports nothing. */

/** A PDF whose name does not follow the naming template. */
export interface NameIssue {
  /** Relative to the target folder, `/` between folders. Identifies the file in later calls. */
  path: string;
  /** File name. */
  name: string;
  /** Folder relative to the target folder; '' for the target folder itself. */
  folder: string;
  /** Only the iCloud placeholder is on this Mac; it is downloaded before it is read. */
  placeholder: boolean;
}

export type NameCheckOutcome =
  | { ok: true; issues: NameIssue[]; checked: number; truncated: boolean }
  | { ok: false; reason: 'missing' | 'failed'; message: string };

/** The proposed name for one file. Nothing is renamed until the user accepts it. */
export type NameSuggestion =
  | { path: string; name: string; status: 'proposed'; newName: string }
  /** The model's answer gives the same name. */
  | { path: string; name: string; status: 'unchanged' }
  | { path: string; name: string; status: 'failed'; message: string };

export type SuggestNamesOutcome = { ok: true; suggestions: NameSuggestion[] } | { ok: false; reason: 'no-scan' | 'missing-key' | 'unreadable-key'; message: string };

export type RenameResult = { path: string; ok: true; newPath: string; newName: string } | { path: string; ok: false; message: string };

/** Files per "Suggest names" batch (arc42 §5.4). */
export const MAX_SUGGEST_NAMES = 20;
/** Files per "Accept" call. */
export const MAX_APPLY_RENAMES = 500;
