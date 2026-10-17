import * as path from 'node:path';
import type { FileSystem } from '../ports';

export type FileResult =
  | { status: 'filed'; path: string }
  /** The source file disappeared before or during the move: another Mac handled it (arc42 §11 risk 5). Not an error. */
  | { status: 'vanished' };

export interface FileOptions {
  /** If given, filing directly into this folder is refused (loop protection, arc42 §8). */
  inboxPath?: string;
}

const isCode = (err: unknown, code: string) => (err as { code?: string } | null)?.code === code;

/** Returns `dir/name.ext`, or `dir/name_2.ext`, `_3`, ... for the first name that does not exist yet. */
async function freePath(target: string, fs: FileSystem): Promise<string> {
  if (!(await fs.exists(target))) return target;
  const { dir, name, ext } = path.parse(target);
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${name}_${n}${ext}`);
    if (!(await fs.exists(candidate))) return candidate;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Copy, verify, then delete the source (used when `rename` fails across volumes). */
async function copyVerifyDelete(src: string, dest: string, fs: FileSystem): Promise<void> {
  const data = await fs.readFile(src);
  await fs.writeFile(dest, data);
  if (!sameBytes(data, await fs.readFile(dest))) {
    await fs.remove(dest).catch(() => undefined);
    throw new Error(`Copy of ${src} to ${dest} could not be verified`);
  }
  await fs.remove(src).catch((err: unknown) => {
    if (!isCode(err, 'ENOENT')) throw err;
  });
}

/**
 * Moves `src` to `targetRoot/relPath`, creating missing folders. Never overwrites: an existing name gets
 * `_2`, `_3`, ... before the extension. Resolves with the final path, or `vanished` if the source is gone.
 * Rejects on any other failure and leaves the source untouched. `relPath` should come from `renderPath`.
 */
export async function fileDocument(
  src: string,
  targetRoot: string,
  relPath: string,
  fs: FileSystem,
  options: FileOptions = {},
): Promise<FileResult> {
  const root = path.resolve(targetRoot);
  const target = path.resolve(root, relPath);
  if (!target.startsWith(root + path.sep)) throw new Error(`Target path escapes the target folder: ${relPath}`);
  if (options.inboxPath !== undefined && path.dirname(target) === path.resolve(options.inboxPath)) {
    throw new Error('The target folder must not be the inbox itself');
  }

  if (!(await fs.exists(src))) return { status: 'vanished' };
  await fs.mkdir(path.dirname(target));
  const dest = await freePath(target, fs);

  try {
    try {
      await fs.rename(src, dest);
    } catch (err) {
      if (!isCode(err, 'EXDEV')) throw err;
      await copyVerifyDelete(src, dest, fs);
    }
  } catch (err) {
    if (isCode(err, 'ENOENT') && !(await fs.exists(src))) return { status: 'vanished' };
    throw err;
  }
  return { status: 'filed', path: dest };
}
