import * as path from 'node:path';
import type { Clock } from '../ports';
import { MAX_SAMPLE_FILE_NAMES, SCAN_MAX_DEPTH, SCAN_MAX_ENTRIES, type ScannedFile, type ScannedFolder, type ScanResult } from './types';

/** One directory entry. Symbolic links and anything else count as `other` and are skipped (no loops, no escape). */
export interface DirEntry {
  name: string;
  kind: 'file' | 'directory' | 'other';
}

/** Read-only directory listing for the Scanner. Real implementation wraps `fs.readdir(..., { withFileTypes: true })`. */
export interface ScanFileSystem {
  /** Rejects if the folder cannot be read (missing, no permission). */
  list(dir: string): Promise<DirEntry[]>;
}

export interface ScanOptions {
  /** Skipped (with everything below it) when it lies inside the target folder. */
  inboxPath?: string;
  /** Folder levels below the target folder that are read. Default `SCAN_MAX_DEPTH`. */
  maxDepth?: number;
  /** Files and folders together. Default `SCAN_MAX_ENTRIES`. */
  maxEntries?: number;
}

export interface ScanDeps {
  fs: ScanFileSystem;
  clock: Clock;
}

/** `.name.pdf.icloud` -> `name.pdf` (any extension); undefined for other names. */
function placeholderRealName(name: string): string | undefined {
  const match = /^\.(.+)\.icloud$/.exec(name);
  return match?.[1];
}

const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Reads the target folder recursively and read-only (arc42 §5.4). Skips the inbox folder, hidden files and folders and
 * symbolic links; lists iCloud placeholders under their real name without downloading them. Stops at the depth and
 * entry limits and says so in `truncated`. A subfolder that cannot be read is left out; an unreadable target folder
 * rejects.
 */
export async function scanFolder(root: string, deps: ScanDeps, options: ScanOptions = {}): Promise<ScanResult> {
  const { maxDepth = SCAN_MAX_DEPTH, maxEntries = SCAN_MAX_ENTRIES } = options;
  const rootPath = path.resolve(root);
  // APFS is case-insensitive by default, so "inbox" and "Inbox" are the same folder.
  const inbox = options.inboxPath === undefined ? undefined : path.resolve(options.inboxPath).toLowerCase();
  const folders: ScannedFolder[] = [];
  const files: ScannedFile[] = [];
  let entries = 0;
  /** A folder below the depth limit was not entered. */
  let tooDeep = false;
  /** The entry limit was reached; the scan stops. */
  let full = false;
  const unread = (dir: { rel: string }) => folders.push({ path: dir.rel, fileCount: 0, sampleFileNames: [] });

  // Breadth first, so a cut-off scan keeps the upper levels, which matter most for the tree.
  let level: { abs: string; rel: string }[] = [{ abs: rootPath, rel: '' }];
  for (let depth = 0; level.length > 0 && !full; depth++) {
    const next: { abs: string; rel: string }[] = [];
    for (const [index, dir] of level.entries()) {
      if (full) {
        // Folders found but not read any more still belong in the tree; their files are unknown.
        level.slice(index).forEach(unread);
        break;
      }
      let listing: DirEntry[];
      try {
        listing = await deps.fs.list(dir.abs);
      } catch (err) {
        if (dir.rel === '') throw err;
        continue; // an unreadable subfolder is left out, the rest of the scan goes on
      }
      const names: string[] = [];
      const listed = new Map<string, ScannedFile>();
      const sorted = [...listing].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of sorted) {
        const placeholderName = entry.kind === 'file' ? placeholderRealName(entry.name) : undefined;
        if (entry.name.startsWith('.') && placeholderName === undefined) continue;
        if (entry.kind === 'other') continue;
        const name = (placeholderName ?? entry.name).normalize('NFC');
        const rel = dir.rel === '' ? name : `${dir.rel}/${name}`;
        const abs = path.join(dir.abs, entry.name);
        if (entry.kind === 'directory') {
          if (inbox !== undefined && abs.toLowerCase() === inbox) continue;
          if (depth + 1 > maxDepth) {
            tooDeep = true;
            continue;
          }
          if (++entries > maxEntries) {
            full = true;
            break;
          }
          next.push({ abs, rel });
          continue;
        }
        // The real file and its placeholder can both show up for a moment while iCloud downloads it; the real one wins.
        const known = listed.get(name);
        if (known) {
          if (placeholderName === undefined) known.placeholder = false;
          continue;
        }
        if (++entries > maxEntries) {
          full = true;
          break;
        }
        const file: ScannedFile = { path: rel, placeholder: placeholderName !== undefined };
        names.push(name);
        listed.set(name, file);
        files.push(file);
      }
      if (dir.rel !== '') folders.push({ path: dir.rel, fileCount: names.length, sampleFileNames: names.slice(0, MAX_SAMPLE_FILE_NAMES) });
    }
    if (full) next.forEach(unread);
    level = next;
  }
  const truncated = tooDeep || full;

  return { root: rootPath, folders: folders.sort(byPath), files: files.sort(byPath), truncated, scannedAt: deps.clock.now().toISOString() };
}
