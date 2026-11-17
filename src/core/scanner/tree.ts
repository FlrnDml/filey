/**
 * The folder tree of the Filing tab (arc42 §5.4): the last scan merged with the saved folder rules. Pure and free of
 * Node imports, so the renderer can use it.
 */
import type { FolderRule } from '../settings/types';
import type { ScannedFolder } from './types';

export interface FolderTreeNode {
  /** Relative to the target folder, `/` between folders. For a rule, its folder as written in the rule. */
  path: string;
  /** Last part of `path`. */
  name: string;
  /** Whether the folder was found by the scan. */
  exists: boolean;
  /** The rule for this folder, if there is one. */
  rule?: FolderRule;
  /** Files directly in the folder; 0 if it does not exist. */
  fileCount: number;
  children: FolderTreeNode[];
}

/** Folder names are compared like APFS does by default: case-insensitive, after NFC normalization. */
export const folderKey = (folder: string) => folder.normalize('NFC').toLowerCase();

/**
 * Builds the tree from the scanned folders and the rules. A rule whose folder was not found becomes a node with
 * `exists: false` ("rule without folder": the Filer creates the folder on the next filing); parents that exist only
 * because of such a rule are added the same way. Children are sorted by name.
 */
export function buildFolderTree(folders: readonly ScannedFolder[], rules: readonly FolderRule[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  const ensure = (folderPath: string): FolderTreeNode => {
    const key = folderKey(folderPath);
    const known = nodes.get(key);
    if (known) return known;
    const parts = folderPath.split('/');
    const node: FolderTreeNode = { path: folderPath, name: parts[parts.length - 1] ?? folderPath, exists: false, fileCount: 0, children: [] };
    nodes.set(key, node);
    if (parts.length === 1) roots.push(node);
    else ensure(parts.slice(0, -1).join('/')).children.push(node);
    return node;
  };

  for (const folder of folders) {
    const node = ensure(folder.path);
    node.exists = true;
    node.fileCount = folder.fileCount;
  }
  for (const rule of rules) {
    const folder = rule.folder.trim();
    if (folder === '') continue;
    const node = ensure(folder);
    node.rule ??= rule;
  }

  const sort = (list: FolderTreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

/** How many folders of the tree have no rule yet (only folders that exist). */
export function countUnmapped(nodes: readonly FolderTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.exists && !node.rule ? 1 : 0) + countUnmapped(node.children), 0);
}
