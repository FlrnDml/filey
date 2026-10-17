import { DatabaseSync } from 'node:sqlite';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

/** The raw `node:sqlite` connection (migrations, tests). */
export type Database = DatabaseSync;
/** The Drizzle ORM on top of it; used by the tables in `repositories.ts`. */
export type Orm = NodeSQLiteDatabase;

/**
 * Opens (and creates, if missing) the SQLite database at `path`. Pass `:memory:` in tests.
 * Fails early with a clear message when this Node/Electron build has no usable `node:sqlite`.
 */
export function openDatabase(path: string): Database {
  if (typeof DatabaseSync !== 'function') {
    throw new Error('node:sqlite is not available in this Node.js / Electron version');
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function createOrm(db: Database): Orm {
  return drizzle({ client: db });
}
