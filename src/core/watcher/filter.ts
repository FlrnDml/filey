import * as path from 'node:path';

/**
 * True for a file the watcher should hand on: a `.pdf` (case-insensitive) that is not hidden, not a temp
 * file and not an iCloud placeholder (`.name.pdf.icloud` is hidden and ends in `.icloud`, so it is rejected).
 */
export function isCandidatePdf(filePath: string): boolean {
  const name = path.basename(filePath);
  if (name.startsWith('.') || name.startsWith('~$') || name.endsWith('~')) return false;
  return path.extname(name).toLowerCase() === '.pdf';
}
