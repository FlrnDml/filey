import * as path from 'node:path';

/**
 * Maps an iCloud placeholder path (`<dir>/.<name>.pdf.icloud`, left behind by "Optimize Mac Storage") to the
 * path of the real file (`<dir>/<name>.pdf`). Returns undefined for anything that is not a PDF placeholder.
 */
export function placeholderToRealPath(filePath: string): string | undefined {
  const match = /^\.(.+\.pdf)\.icloud$/i.exec(path.basename(filePath));
  return match?.[1] === undefined ? undefined : path.join(path.dirname(filePath), match[1]);
}

/** The placeholder path macOS uses for a real file path. */
export function realToPlaceholderPath(realPath: string): string {
  return path.join(path.dirname(realPath), `.${path.basename(realPath)}.icloud`);
}
