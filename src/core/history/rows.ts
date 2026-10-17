import * as path from 'node:path';
import type { ProcessedImport, UnprocessedImport } from '../db';
import { matchesQuery } from './match';
import type { HistoryRow, InboxRow } from './types';

export interface InboxRowContext {
  /** Id of the inbox entry being analyzed right now (`ImportService.analyzingId`). */
  analyzingId: number | null;
  /** Finds a filed document by history id (`ImportService.getHistoryEntry`). */
  findProcessed(id: number): ProcessedImport | undefined;
}

export interface HistoryRowContext {
  /** Target folder from the settings, to show folders relative to it. */
  targetPath: string;
}

function folderOf(targetFile: string, targetRoot: string): string {
  const dir = path.dirname(path.resolve(targetFile));
  const rel = path.relative(path.resolve(targetRoot), dir);
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return dir;
  return rel.split(path.sep).join('/');
}

/** An inbox entry as the Inbox view shows it: no hash, no path. */
export function toInboxRow(record: UnprocessedImport, context: InboxRowContext): InboxRow {
  const original = record.status === 'duplicate' && record.duplicateOfId !== null ? context.findProcessed(record.duplicateOfId) : undefined;
  return {
    id: record.id,
    fileName: record.fileName,
    status: record.status,
    working: context.analyzingId === record.id,
    error: record.error,
    duplicateOf: original ? { id: original.id, finalName: path.basename(original.targetPath) } : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** A filed document as the History view shows it: names and folder only. */
export function toHistoryRow(record: ProcessedImport, context: HistoryRowContext): HistoryRow {
  return {
    id: record.id,
    originalName: record.originalName,
    finalName: path.basename(record.targetPath),
    folder: folderOf(record.targetPath, context.targetPath),
    category: record.category,
    filedAt: record.filedAt,
  };
}

/** How many recent imports a search looks through (the history has no full-text index). */
export const HISTORY_SEARCH_WINDOW = 1000;

export interface ListHistoryOptions {
  limit: number;
  query?: string;
}

/** Most recent first; with a query, filters the latest `HISTORY_SEARCH_WINDOW` imports and returns up to `limit` matches. */
export function listHistoryRows(
  listRecent: (limit: number) => ProcessedImport[],
  context: HistoryRowContext,
  { limit, query }: ListHistoryOptions,
): HistoryRow[] {
  const q = query?.trim() ?? '';
  if (q === '') return listRecent(limit).map((r) => toHistoryRow(r, context));
  return listRecent(Math.max(limit, HISTORY_SEARCH_WINDOW))
    .map((r) => toHistoryRow(r, context))
    .filter((row) => matchesQuery(row, q))
    .slice(0, limit);
}
