/** Pure helpers that turn IPC data into what the popover shows. */
import type { AppState, HistoryRow, InboxRow } from '../../../core/ipc';
import type { HistoryRowProps, InboxRowProps } from '../../components';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Just now", "2 min ago", "3 h ago", "Yesterday", "Mar 2", "Mar 2, 2025" (local time). */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  const sameDay = startOfDay(then) === startOfDay(now);
  if (minutes < 1) return 'Just now';
  if (sameDay && minutes < 60) return `${minutes} min ago`;
  if (sameDay) return `${Math.floor(minutes / 60)} h ago`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (startOfDay(then) === yesterday) return 'Yesterday';
  const date = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? date : `${date}, ${then.getFullYear()}`;
}

/** The last segment of a folder path ("/Users/me/iCloud/Documents" -> "Documents"). */
export function folderName(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folderPath;
}

/** Props for one popover `HistoryRow`: the filed name, and where it went. */
export function historyRowProps(row: HistoryRow, now: Date): Pick<HistoryRowProps, 'name' | 'folder' | 'time'> {
  return {
    name: row.finalName,
    // The category stands in when the file was filed directly into the target folder.
    folder: row.folder || row.category || undefined,
    time: relativeTime(row.filedAt, now),
  };
}

/**
 * Props for one popover `InboxRow`. A file being analyzed (`working`, or retried right now) is "Working";
 * otherwise a pending file waits for the connection while the app is offline and is new when it is not.
 */
export function inboxRowProps(row: InboxRow, mode: AppState['mode'] | undefined, retrying = false): Pick<InboxRowProps, 'name' | 'status' | 'detail'> {
  const name = row.fileName;
  if (row.working || retrying) return { name, status: 'working' };
  switch (row.status) {
    case 'failed':
      return { name, status: 'failed', detail: row.error ?? undefined };
    case 'duplicate':
      return { name, status: 'duplicate', detail: row.duplicateOf ? `Duplicate of ${row.duplicateOf.finalName}` : 'Duplicate of a filed document' };
    case 'pending':
      return { name, status: mode === 'offline' ? 'waiting' : 'new' };
  }
}

export interface StatusLine {
  text: string;
  tone: 'success' | 'warning';
}

/** The header status: "Watching <inbox>", "Paused · API key missing", "Offline · 2 waiting". */
export function statusLine(state: AppState | null, inboxName: string | null): StatusLine | null {
  if (!state) return null;
  switch (state.mode) {
    case 'running':
      return inboxName ? { text: `Watching ${inboxName}`, tone: 'success' } : null;
    case 'paused':
      return { text: state.reason === 'missing' ? 'Paused · API key missing' : 'Paused · API key unreadable', tone: 'warning' };
    case 'offline':
      return { text: state.queuedCount > 0 ? `Offline · ${state.queuedCount} waiting` : 'Offline', tone: 'warning' };
  }
}

/** Inserts or replaces a filed document (by id) in a most-recent-first list and keeps at most `limit` rows. */
export function upsertHistory(rows: readonly HistoryRow[], row: HistoryRow, limit: number): HistoryRow[] {
  const next = rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows];
  return next.sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.id - a.id).slice(0, limit);
}

/**
 * Inserts or replaces an inbox file (by id) in a newest-first list. An older version of a row (earlier
 * `updatedAt`) never replaces a newer one.
 */
export function upsertInbox(rows: readonly InboxRow[], row: InboxRow): InboxRow[] {
  const existing = rows.find((r) => r.id === row.id);
  if (existing && existing.updatedAt > row.updatedAt) return [...rows];
  const next = existing ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows];
  return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

export const removeRow = <T extends { id: number }>(rows: readonly T[], id: number): T[] => rows.filter((r) => r.id !== id);
