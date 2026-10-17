import * as path from 'node:path';

/** True if `child` is strictly below `parent` (after resolving `.`/`..`). */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

export type RevealTarget = { ok: true; path: string } | { ok: false; reason: 'not-allowed' };

/**
 * Checks the file "Reveal in Finder" shows (a filed PDF or a file in the inbox). Only absolute paths inside the
 * configured inbox or target folder are allowed, so a stale or tampered entry cannot make the app open arbitrary
 * locations.
 */
export function resolveRevealPath(filePath: string, folders: { inboxPath: string; targetPath: string }): RevealTarget {
  if (!path.isAbsolute(filePath) || filePath.includes('\0')) return { ok: false, reason: 'not-allowed' };
  const resolved = path.resolve(filePath);
  if (isInside(resolved, folders.inboxPath) || isInside(resolved, folders.targetPath)) return { ok: true, path: resolved };
  return { ok: false, reason: 'not-allowed' };
}
