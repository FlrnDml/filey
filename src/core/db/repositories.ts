import { asc, desc, eq } from 'drizzle-orm';
import type { Orm } from './database';
import { processedImports, settings, unprocessedImports, type UnprocessedStatus } from './schema';

/** Key/value settings. Semantics and defaults live in the settings repository. */
export interface SettingsTable {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  all(): Record<string, string>;
}

export function createSettingsTable(orm: Orm): SettingsTable {
  return {
    get: (key) => orm.select().from(settings).where(eq(settings.key, key)).get()?.value,
    set(key, value) {
      orm.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    },
    delete(key) {
      orm.delete(settings).where(eq(settings.key, key)).run();
    },
    all: () => Object.fromEntries(orm.select().from(settings).all().map((r) => [r.key, r.value])),
  };
}

/** A filed document (history entry). */
export type ProcessedImport = typeof processedImports.$inferSelect;
export type NewProcessedImport = Omit<typeof processedImports.$inferInsert, 'id'>;

/** A file that is still in the inbox. */
export type UnprocessedImport = typeof unprocessedImports.$inferSelect;
export type { UnprocessedStatus };

/** What the import service writes for an inbox file; `now` is passed in so tests control the clock. */
export interface UnprocessedWrite {
  inboxPath: string;
  fileName: string;
  contentHash: string;
  status: UnprocessedStatus;
  /** Cleared (null) when left out. */
  error?: string | null;
  /** Cleared (null) when left out. */
  duplicateOfId?: number | null;
  now: string;
}

export interface ProcessedImportsTable {
  getById(id: number): ProcessedImport | undefined;
  /** All filed documents with this content hash, oldest first (one indexed query). */
  findByContentHash(contentHash: string): ProcessedImport[];
  /** Most recently filed first. */
  listRecent(limit: number): ProcessedImport[];
  /** Removes a history entry, e.g. when its filed document no longer exists. */
  delete(id: number): void;
}

export interface UnprocessedImportsTable {
  getById(id: number): UnprocessedImport | undefined;
  getByPath(inboxPath: string): UnprocessedImport | undefined;
  /** Newest first. */
  list(): UnprocessedImport[];
  /** Inserts the row for this inbox path, or updates it (keeping `id` and `createdAt`). */
  upsert(write: UnprocessedWrite): UnprocessedImport;
  /** Removes the row for this inbox path and returns it, or undefined if there was none. */
  deleteByPath(inboxPath: string): UnprocessedImport | undefined;
}

export interface ImportTables {
  processed: ProcessedImportsTable;
  unprocessed: UnprocessedImportsTable;
  /**
   * Records a successful import in one transaction: inserts the processed import and removes the inbox row
   * for `inboxPath` (if any).
   */
  markFiled(inboxPath: string, record: NewProcessedImport): ProcessedImport;
}

export function createImportTables(orm: Orm): ImportTables {
  const processed: ProcessedImportsTable = {
    getById: (id) => orm.select().from(processedImports).where(eq(processedImports.id, id)).get(),
    findByContentHash: (contentHash) =>
      orm.select().from(processedImports).where(eq(processedImports.contentHash, contentHash)).orderBy(asc(processedImports.id)).all(),
    listRecent: (limit) => orm.select().from(processedImports).orderBy(desc(processedImports.id)).limit(limit).all(),
    delete(id) {
      orm.delete(processedImports).where(eq(processedImports.id, id)).run();
    },
  };

  const unprocessed: UnprocessedImportsTable = {
    getById: (id) => orm.select().from(unprocessedImports).where(eq(unprocessedImports.id, id)).get(),
    getByPath: (inboxPath) => orm.select().from(unprocessedImports).where(eq(unprocessedImports.inboxPath, inboxPath)).get(),
    list: () => orm.select().from(unprocessedImports).orderBy(desc(unprocessedImports.id)).all(),
    upsert({ now, ...write }) {
      const changes = {
        fileName: write.fileName,
        contentHash: write.contentHash,
        status: write.status,
        error: write.error ?? null,
        duplicateOfId: write.duplicateOfId ?? null,
        updatedAt: now,
      };
      return orm
        .insert(unprocessedImports)
        .values({ ...changes, inboxPath: write.inboxPath, createdAt: now })
        .onConflictDoUpdate({ target: unprocessedImports.inboxPath, set: changes })
        .returning()
        .get()!;
    },
    deleteByPath: (inboxPath) => orm.delete(unprocessedImports).where(eq(unprocessedImports.inboxPath, inboxPath)).returning().get(),
  };

  return {
    processed,
    unprocessed,
    markFiled: (inboxPath, record) =>
      orm.transaction((tx) => {
        const row = tx.insert(processedImports).values(record).returning().get()!;
        tx.delete(unprocessedImports).where(eq(unprocessedImports.inboxPath, inboxPath)).run();
        return row;
      }),
  };
}
