/**
 * "Map folders" (arc42 §5.4): proposes folder rules for scanned folders that have none, and merges reviewed rules into
 * the saved ones. Pure and free of Node imports, so the renderer can use it.
 */
import { FALLBACK_FOLDER, RULE_LIMITS, type FolderRule } from '../settings/types';
import { folderKey } from './tree';
import type { ScannedFolder } from './types';

export interface RuleProposal extends FolderRule {
  /** Files directly in the folder. */
  fileCount: number;
  /** Proposed for saving: folders that hold files are preselected, folders that only hold subfolders are not. */
  selected: boolean;
}

/** A description derived from the folder name only, e.g. `Health/Health insurance` -> "Documents about Health insurance (Health)". */
export function defaultDescription(folder: string): string {
  const parts = folder.split('/').filter((part) => part.trim() !== '');
  const name = parts.pop() ?? folder;
  return parts.length === 0 ? `Documents about ${name}` : `Documents about ${name} (${parts.join(' / ')})`;
}

/** Whether a scanned folder name can be saved as a rule (`validateRules` and the IPC limits). */
function isValidRuleFolder(folder: string): boolean {
  if (folder.length > RULE_LIMITS.folder || folder.includes('\\')) return false;
  return folder.split('/').every((part) => part.trim() !== '' && part !== '.' && part !== '..');
}

/** One proposal per scanned folder without a rule, in tree order. The fallback folder already has its rule. */
export function proposeRules(folders: readonly ScannedFolder[], rules: readonly FolderRule[]): RuleProposal[] {
  const mapped = new Set(rules.map((rule) => folderKey(rule.folder.trim())));
  mapped.add(folderKey(FALLBACK_FOLDER));
  return folders
    .filter((folder) => !mapped.has(folderKey(folder.path)) && isValidRuleFolder(folder.path))
    .map((folder) => ({ folder: folder.path, description: defaultDescription(folder.path), fileCount: folder.fileCount, selected: folder.fileCount > 0 }));
}

/**
 * Adds rules to `rules`, or replaces the description of a rule for the same folder. New rules go above the fallback
 * rule, so `Unsorted` stays last.
 */
export function upsertRules(rules: readonly FolderRule[], changes: readonly FolderRule[]): FolderRule[] {
  const next = rules.map((rule) => ({ ...rule }));
  const added: FolderRule[] = [];
  for (const change of changes) {
    const key = folderKey(change.folder);
    const existing = next.find((rule) => folderKey(rule.folder) === key) ?? added.find((rule) => folderKey(rule.folder) === key);
    if (existing) existing.description = change.description;
    else added.push({ folder: change.folder, description: change.description });
  }
  const fallback = next.findIndex((rule) => rule.folder === FALLBACK_FOLDER);
  const at = fallback === -1 ? next.length : fallback;
  return [...next.slice(0, at), ...added, ...next.slice(at)];
}
