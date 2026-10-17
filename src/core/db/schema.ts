/**
 * The database schema (arc42 §5.2, §8 "Data storage and migrations"). Source of truth for the tables:
 * after changing it, run `npm run db:generate` to create the migration and bundle it.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Key/value settings; values are JSON. The folder rules are stored here too, under `folderRules`. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Documents that were filed. Kept for the history view and the duplicate check. */
export const processedImports = sqliteTable(
  'processed_imports',
  {
    id: integer('id').primaryKey(),
    contentHash: text('content_hash').notNull(),
    /** File name in the inbox before filing. */
    originalName: text('original_name').notNull(),
    /** Absolute path of the filed document. */
    targetPath: text('target_path').notNull(),
    /** Document date as extracted by the model (ISO date string). */
    documentDate: text('document_date'),
    sender: text('sender'),
    category: text('category'),
    title: text('title'),
    model: text('model'),
    filedAt: text('filed_at').notNull(),
  },
  (t) => [index('idx_processed_imports_content_hash').on(t.contentHash)],
);

export const UNPROCESSED_STATUSES = ['pending', 'failed', 'duplicate'] as const;
export type UnprocessedStatus = (typeof UNPROCESSED_STATUSES)[number];

/** Files that are still in the inbox: new or waiting (`pending`), `failed` or `duplicate`. One row per inbox file. */
export const unprocessedImports = sqliteTable(
  'unprocessed_imports',
  {
    id: integer('id').primaryKey(),
    inboxPath: text('inbox_path').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status', { enum: UNPROCESSED_STATUSES }).notNull(),
    /** User-facing reason for a `failed` import. */
    error: text('error'),
    /** For a `duplicate`: the filed document it duplicates. */
    duplicateOfId: integer('duplicate_of_id').references(() => processedImports.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('idx_unprocessed_imports_content_hash').on(t.contentHash),
    check('unprocessed_imports_status', sql`${t.status} IN ('pending', 'failed', 'duplicate')`),
  ],
);
