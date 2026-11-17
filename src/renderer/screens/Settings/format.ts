/** Pure helpers for the Settings screens (no React, no bridge), unit-tested in format.test.ts. */
import { DEFAULT_MODEL, FALLBACK_FOLDER, type FolderRule } from '../../../core/settings/types';

/** iCloud Drive's folder on disk, below the home folder (`~/Library/Mobile Documents/com~apple~CloudDocs`). */
const ICLOUD = /^\/Users\/[^/]+\/Library\/Mobile Documents\/com~apple~CloudDocs(?=\/|$)/;
const HOME = /^\/Users\/[^/]+(?=\/|$)/;

/**
 * A folder path as people know it from Finder: iCloud Drive paths start with "iCloud Drive",
 * other paths in the home folder with "~". Everything else is shown unchanged.
 */
export function displayPath(path: string): string {
  if (ICLOUD.test(path)) return path.replace(ICLOUD, 'iCloud Drive');
  if (HOME.test(path)) return path.replace(HOME, '~');
  return path;
}

/** The model to save for what is typed in the model field: empty means the default model. */
export function effectiveModel(typed: string): string {
  return typed.trim() || DEFAULT_MODEL;
}

/** What the model field shows for a saved model: empty for the default, so the placeholder names it. */
export function modelFieldValue(saved: string): string {
  return saved === DEFAULT_MODEL ? '' : saved;
}

/** A folder rule while it is edited; `id` keeps React keys and focus stable while rows move. */
export interface RuleDraft extends FolderRule {
  id: number;
  /** The `Unsorted` fallback: its folder is fixed and the row cannot be removed. */
  fallback: boolean;
}

let nextRuleId = 1;

export function toDrafts(rules: readonly FolderRule[]): RuleDraft[] {
  return rules.map(({ folder, description }) => ({ id: nextRuleId++, folder, description, fallback: folder === FALLBACK_FOLDER }));
}

export function newDraft(): RuleDraft {
  return { id: nextRuleId++, folder: '', description: '', fallback: false };
}

export function fromDrafts(drafts: readonly RuleDraft[]): FolderRule[] {
  return drafts.map(({ folder, description }) => ({ folder: folder.trim(), description: description.trim() }));
}

/**
 * Applies rules that were just saved from the folder tree to the rules being edited: a draft for the same folder gets
 * the new description, other folders are added above the fallback. Other unsaved edits stay as they are.
 */
export function upsertDrafts(drafts: readonly RuleDraft[], changes: readonly FolderRule[]): RuleDraft[] {
  const key = (folder: string) => folder.trim().normalize('NFC').toLowerCase();
  const next = drafts.map((draft) => ({ ...draft }));
  const added: RuleDraft[] = [];
  for (const change of changes) {
    const existing = [...next, ...added].find((draft) => key(draft.folder) === key(change.folder));
    if (existing) existing.description = change.description;
    else added.push({ ...newDraft(), folder: change.folder, description: change.description });
  }
  const fallback = next.findIndex((draft) => draft.fallback);
  const at = fallback === -1 ? next.length : fallback;
  return [...next.slice(0, at), ...added, ...next.slice(at)];
}

/** Whether the edited rules differ from the saved ones (ignoring surrounding spaces). */
export function rulesChanged(drafts: readonly RuleDraft[], saved: readonly FolderRule[]): boolean {
  const edited = fromDrafts(drafts);
  return edited.length !== saved.length || edited.some((rule, i) => rule.folder !== saved[i]?.folder || rule.description !== saved[i]?.description);
}
