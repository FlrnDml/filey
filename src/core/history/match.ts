/**
 * History search, shared by main (`history.list` with a query) and the renderer (the popover filters the
 * loaded rows as you type). Pure: no Node or Electron imports, so the renderer bundle can include it.
 */
import type { HistoryRow } from './types';

/** Case-insensitive match against the names and folders the user sees. An empty query matches everything. */
export function matchesQuery(row: Pick<HistoryRow, 'originalName' | 'finalName' | 'folder' | 'category'>, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q === '') return true;
  return [row.originalName, row.finalName, row.folder, row.category].some((v) =>
    v?.normalize('NFC').toLocaleLowerCase().includes(q.normalize('NFC')),
  );
}
