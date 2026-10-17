import { migrateSync } from 'drizzle-orm/sqlite-core/async/session';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Database, Orm } from './database';
import { BUNDLED_MIGRATIONS } from './migrations.generated';

/** Table in which Drizzle records the applied migrations. */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

const tableExists = (db: Database, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

/** Names of the migrations already applied to this database. */
export function appliedMigrations(db: Database): string[] {
  if (!tableExists(db, MIGRATIONS_TABLE)) return [];
  return (db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`).all() as { name: string | null }[]).map((r) => r.name ?? '');
}

/**
 * Brings the database to the latest schema (arc42 §8 "Data storage and migrations"):
 * 1. refuses a database that has migrations this app does not know (written by a newer version),
 * 2. applies the pending Drizzle migrations in one transaction.
 */
export function migrate(db: Database, orm: Orm, migrations: readonly MigrationMeta[] = BUNDLED_MIGRATIONS): void {
  const known = new Set(migrations.map((m) => m.name));
  const unknown = appliedMigrations(db).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`Database schema is newer than this app supports (unknown migrations: ${unknown.join(', ')})`);
  }

  try {
    migrateSync([...migrations], orm._.session);
  } catch (error) {
    throw new Error(`Database migration failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
