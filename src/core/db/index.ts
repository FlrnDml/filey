import { createOrm, openDatabase, type Database } from './database';
import { migrate } from './migrations';
import { createImportTables, createSettingsTable } from './repositories';

export { createOrm, openDatabase, type Database, type Orm } from './database';
export { appliedMigrations, migrate, MIGRATIONS_TABLE } from './migrations';
export * from './repositories';
export { UNPROCESSED_STATUSES } from './schema';

/**
 * Opens the database at `path`, applies the migrations and returns it with the typed tables.
 */
export function openMigratedDatabase(path: string) {
  const db: Database = openDatabase(path);
  const orm = createOrm(db);
  try {
    migrate(db, orm);
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    db,
    orm,
    settings: createSettingsTable(orm),
    imports: createImportTables(orm),
  };
}

export type AppDatabase = ReturnType<typeof openMigratedDatabase>;
