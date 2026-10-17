import { describe, expect, it } from 'vitest';
import { FIXTURE_HISTORY, FIXTURE_INBOX } from '../../test/fixtures';
import type { AppState } from '../../../core/ipc';
import { folderName, historyRowProps, inboxRowProps, relativeTime, removeRow, statusLine, upsertHistory, upsertInbox } from './format';

const now = new Date(2026, 2, 12, 10, 45);
const iso = (...args: [number, number, number, number, number]) => new Date(...args).toISOString();

describe('relativeTime', () => {
  it.each([
    [new Date(2026, 2, 12, 10, 44, 30).toISOString(), 'Just now'],
    [iso(2026, 2, 12, 10, 44), '1 min ago'],
    [iso(2026, 2, 12, 10, 43), '2 min ago'],
    [iso(2026, 2, 12, 7, 40), '3 h ago'],
    [iso(2026, 2, 12, 0, 5), '10 h ago'],
    [iso(2026, 2, 11, 23, 59), 'Yesterday'],
    [iso(2026, 2, 2, 9, 0), 'Mar 2'],
    [iso(2025, 11, 31, 9, 0), 'Dec 31, 2025'],
  ])('%s -> %s', (value, expected) => {
    expect(relativeTime(value, now)).toBe(expected);
  });

  it('is empty for an invalid date', () => {
    expect(relativeTime('nope', now)).toBe('');
  });
});

describe('folderName', () => {
  it('returns the last path segment', () => {
    expect(folderName('/Users/me/iCloud/Documents')).toBe('Documents');
    expect(folderName('/Users/me/iCloud/Documents/')).toBe('Documents');
    expect(folderName('Inbox')).toBe('Inbox');
  });
});

describe('historyRowProps', () => {
  const [filed] = FIXTURE_HISTORY;

  it('shows the filed name, folder and time', () => {
    expect(historyRowProps(filed!, now)).toEqual({ name: '2026-03-12_Northwind_Invoice.pdf', folder: 'Health/Health insurance', time: '2 min ago' });
  });

  it('falls back to the category when the file went straight into the target folder', () => {
    expect(historyRowProps({ ...filed!, folder: '', category: 'Unsorted' }, now).folder).toBe('Unsorted');
    expect(historyRowProps({ ...filed!, folder: '', category: null }, now).folder).toBeUndefined();
  });
});

describe('inboxRowProps', () => {
  const [failed, pending, duplicate] = FIXTURE_INBOX;

  it('maps failed and duplicate rows with their second line', () => {
    expect(inboxRowProps(failed!, 'running')).toEqual({ name: 'Scan 2026-03-11 18.02.pdf', status: 'failed', detail: 'OpenRouter unreachable' });
    expect(inboxRowProps(duplicate!, 'running')).toEqual({
      name: 'Scan 2026-03-02 07.10.pdf',
      status: 'duplicate',
      detail: 'Duplicate of 2026-02-27_Revenue_Assessment.pdf',
    });
    expect(inboxRowProps({ ...duplicate!, duplicateOf: null }, 'running').detail).toBe('Duplicate of a filed document');
  });

  it('shows a pending file as new, or as waiting while offline', () => {
    expect(inboxRowProps(pending!, 'running').status).toBe('new');
    expect(inboxRowProps(pending!, undefined).status).toBe('new');
    expect(inboxRowProps(pending!, 'offline').status).toBe('waiting');
  });

  it('shows a working or retrying file as working', () => {
    expect(inboxRowProps({ ...pending!, working: true }, 'offline').status).toBe('working');
    expect(inboxRowProps(failed!, 'running', true)).toEqual({ name: 'Scan 2026-03-11 18.02.pdf', status: 'working' });
  });
});

describe('statusLine', () => {
  it.each([
    [{ mode: 'running', queuedCount: 0, analyzingId: null, attentionCount: 0 } as const, { text: 'Watching Documents', tone: 'success' }],
    [{ mode: 'paused', reason: 'missing', queuedCount: 0, analyzingId: null, attentionCount: 0 } as const, { text: 'Paused · API key missing', tone: 'warning' }],
    [{ mode: 'paused', reason: 'unreadable', queuedCount: 0, analyzingId: null, attentionCount: 0 } as const, { text: 'Paused · API key unreadable', tone: 'warning' }],
    [{ mode: 'offline', queuedCount: 2, analyzingId: null, attentionCount: 0 } as const, { text: 'Offline · 2 waiting', tone: 'warning' }],
    [{ mode: 'offline', queuedCount: 0, analyzingId: null, attentionCount: 0 } as const, { text: 'Offline', tone: 'warning' }],
  ] satisfies [AppState, unknown][])('%o', (state, expected) => {
    expect(statusLine(state, 'Documents')).toEqual(expected);
  });

  it('shows nothing while loading', () => {
    expect(statusLine(null, 'Documents')).toBeNull();
    expect(statusLine({ mode: 'running', queuedCount: 0, analyzingId: null, attentionCount: 0 }, null)).toBeNull();
  });
});

describe('upsertHistory', () => {
  it('replaces a row in place, adds new rows by filing time and keeps at most `limit`', () => {
    const rows = FIXTURE_HISTORY.slice(1, 3);
    const renamed = { ...rows[0]!, finalName: 'renamed.pdf' };
    expect(upsertHistory(rows, renamed, 10).map((r) => r.finalName)[0]).toBe('renamed.pdf');
    expect(upsertHistory(rows, FIXTURE_HISTORY[0]!, 10).map((r) => r.id)).toEqual([6, 3, 2]);
    expect(upsertHistory(rows, FIXTURE_HISTORY[0]!, 2).map((r) => r.id)).toEqual([6, 3]);
  });
});

describe('upsertInbox', () => {
  const rows = FIXTURE_INBOX.slice(1);

  it('replaces a row in place and adds new rows by creation time', () => {
    const updated = { ...rows[0]!, working: true, updatedAt: '2099-01-01T00:00:00.000Z' };
    expect(upsertInbox(rows, updated).map((r) => [r.id, r.working])).toEqual([
      [11, true],
      [10, false],
    ]);
    expect(upsertInbox(rows, FIXTURE_INBOX[0]!).map((r) => r.id)).toEqual([12, 11, 10]);
  });

  it('ignores an older version of a row', () => {
    const stale = { ...rows[0]!, working: true, updatedAt: '2000-01-01T00:00:00.000Z' };
    expect(upsertInbox(rows, stale)[0]?.working).toBe(false);
  });
});

describe('removeRow', () => {
  it('drops the row with that id', () => {
    expect(removeRow(FIXTURE_INBOX, 11).map((r) => r.id)).toEqual([12, 10]);
    expect(removeRow(FIXTURE_INBOX, 99)).toHaveLength(3);
  });
});
