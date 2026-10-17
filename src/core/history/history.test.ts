import { describe, expect, it, vi } from 'vitest';
import type { ProcessedImport, UnprocessedImport } from '../db';
import { HISTORY_SEARCH_WINDOW, isInside, listHistoryRows, matchesQuery, resolveRevealPath, toHistoryRow, toInboxRow } from '.';

let nextId = 1;
const processed = (fields: Partial<ProcessedImport> = {}): ProcessedImport => ({
  id: nextId++,
  contentHash: 'hash',
  originalName: 'Scan.pdf',
  targetPath: '/target/Health/Health insurance/2026-10-15_Northwind_Invoice.pdf',
  documentDate: '2026-10-15',
  sender: 'Northwind',
  category: 'Health/Health insurance',
  title: 'Invoice',
  model: 'm',
  filedAt: '2026-10-15T10:00:01.000Z',
  ...fields,
});
const unprocessed = (fields: Partial<UnprocessedImport> = {}): UnprocessedImport => ({
  id: nextId++,
  inboxPath: '/inbox/Scan.pdf',
  fileName: 'Scan.pdf',
  contentHash: 'hash',
  status: 'pending',
  error: null,
  duplicateOfId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:01.000Z',
  ...fields,
});

const filed = processed();
const context = { targetPath: '/target' };

describe('toHistoryRow', () => {
  it('maps a filed document to names, folder relative to the target and category', () => {
    expect(toHistoryRow(filed, context)).toEqual({
      id: filed.id,
      originalName: 'Scan.pdf',
      finalName: '2026-10-15_Northwind_Invoice.pdf',
      folder: 'Health/Health insurance',
      category: 'Health/Health insurance',
      filedAt: filed.filedAt,
    });
  });

  it('never exposes the hash, sender, title or paths of the file', () => {
    const row = toHistoryRow(filed, context);
    for (const key of ['contentHash', 'sender', 'title', 'documentDate', 'targetPath', 'model']) {
      expect(row).not.toHaveProperty(key);
    }
  });

  it('shows the absolute folder outside the current target folder and an empty one for the target itself', () => {
    expect(toHistoryRow(filed, { targetPath: '/elsewhere' }).folder).toBe('/target/Health/Health insurance');
    expect(toHistoryRow(processed({ targetPath: '/target/x.pdf' }), context).folder).toBe('');
  });
});

describe('toInboxRow', () => {
  const ctx = {
    analyzingId: null as number | null,
    findProcessed: (id: number) => (id === filed.id ? filed : undefined),
  };

  it('maps a pending file and marks the one being analyzed as working', () => {
    const row = unprocessed();
    expect(toInboxRow(row, ctx)).toEqual({
      id: row.id,
      fileName: 'Scan.pdf',
      status: 'pending',
      working: false,
      error: null,
      duplicateOf: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    expect(toInboxRow(row, { ...ctx, analyzingId: row.id }).working).toBe(true);
  });

  it('keeps the error of a failed file and never exposes hash or path', () => {
    const row = toInboxRow(
      unprocessed({
        status: 'failed',
        error: 'The model did not return a valid result',
      }),
      ctx,
    );
    expect(row).toMatchObject({
      status: 'failed',
      error: 'The model did not return a valid result',
    });
    for (const key of ['contentHash', 'inboxPath']) expect(row).not.toHaveProperty(key);
  });

  it('points a duplicate to the filed original, or to nothing once it left the history', () => {
    expect(toInboxRow(unprocessed({ status: 'duplicate', duplicateOfId: filed.id }), ctx).duplicateOf).toEqual({
      id: filed.id,
      finalName: '2026-10-15_Northwind_Invoice.pdf',
    });
    expect(toInboxRow(unprocessed({ status: 'duplicate', duplicateOfId: 9999 }), ctx).duplicateOf).toBeNull();
    expect(toInboxRow(unprocessed({ status: 'duplicate', duplicateOfId: null }), ctx).duplicateOf).toBeNull();
  });
});

describe('listHistoryRows', () => {
  const rows = [
    filed,
    processed({
      originalName: 'Letter.pdf',
      targetPath: '/target/Letter.pdf',
      category: null,
    }),
  ];

  it('returns the most recent documents without a query', () => {
    const listRecent = vi.fn(() => rows);
    expect(listHistoryRows(listRecent, context, { limit: 20 })).toHaveLength(2);
    expect(listRecent).toHaveBeenCalledWith(20);
  });

  it('filters by names, folder and category, case-insensitively, within the search window', () => {
    const listRecent = vi.fn(() => rows);
    expect(
      listHistoryRows(listRecent, context, {
        limit: 20,
        query: ' health ',
      }).map((r) => r.id),
    ).toEqual([filed.id]);
    expect(listHistoryRows(listRecent, context, { limit: 20, query: 'LETTER' }).map((r) => r.originalName)).toEqual(['Letter.pdf']);
    expect(listHistoryRows(listRecent, context, { limit: 1, query: '.pdf' })).toHaveLength(1);
    expect(listRecent).toHaveBeenCalledWith(HISTORY_SEARCH_WINDOW);
  });

  it('matches decomposed (NFD) umlauts', () => {
    const row = toHistoryRow(processed({ originalName: 'Kündigung.pdf'.normalize('NFD') }), context);
    expect(matchesQuery(row, 'kündigung')).toBe(true);
  });
});

describe('resolveRevealPath', () => {
  const folders = { inboxPath: '/inbox', targetPath: '/target' };

  it('allows files inside the inbox or target folder', () => {
    expect(resolveRevealPath(filed.targetPath, folders)).toEqual({
      ok: true,
      path: filed.targetPath,
    });
    expect(resolveRevealPath('/inbox/Scan.pdf', folders)).toEqual({
      ok: true,
      path: '/inbox/Scan.pdf',
    });
  });

  it('refuses paths outside the inbox and target folder', () => {
    expect(resolveRevealPath('/etc/passwd', folders)).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
    expect(resolveRevealPath('/inbox/../etc/passwd', folders)).toMatchObject({
      ok: false,
    });
    expect(resolveRevealPath('relative.pdf', folders)).toMatchObject({
      ok: false,
    });
    expect(resolveRevealPath('/inbox', folders)).toMatchObject({ ok: false });
  });

  it('isInside handles prefixes and parents', () => {
    expect(isInside('/target/a.pdf', '/target')).toBe(true);
    expect(isInside('/targetx/a.pdf', '/target')).toBe(false);
    expect(isInside('/target/..x/a.pdf', '/target')).toBe(true);
  });
});
