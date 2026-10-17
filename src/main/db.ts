import * as path from 'node:path';
import { openMigratedDatabase, type AppDatabase } from '../core/db';
import type { AppPaths, FileSystem } from '../core/ports';
import { nodeFileSystem } from './adapters';

/** Opens (creating and migrating if needed) `filey.db` in the user data directory. Main process only. */
export async function openAppDatabase(paths: AppPaths, files: FileSystem = nodeFileSystem): Promise<AppDatabase> {
  await files.mkdir(paths.userData());
  return openMigratedDatabase(path.join(paths.userData(), 'filey.db'));
}
