/** Sample inbox and history for the popover tests. Times are relative to `FIXTURE_NOW` (local time). */
import type { HistoryRow, InboxRow } from '../../core/ipc';

export const FIXTURE_NOW = new Date(2026, 2, 12, 10, 45);

const at = (date: Date) => date.toISOString();
const minutesAgo = (m: number) => at(new Date(FIXTURE_NOW.getTime() - m * 60_000));

function inboxRow(fields: Partial<InboxRow> & Pick<InboxRow, 'id' | 'fileName' | 'status'>): InboxRow {
  return {
    working: false,
    error: null,
    duplicateOf: null,
    createdAt: minutesAgo(1),
    updatedAt: fields.createdAt ?? minutesAgo(1),
    ...fields,
  };
}

function historyRow(fields: Partial<HistoryRow> & Pick<HistoryRow, 'id' | 'originalName' | 'finalName' | 'filedAt'>): HistoryRow {
  return { folder: '', category: null, ...fields };
}

/** Unprocessed imports, newest first: failed, new, duplicate. */
export const FIXTURE_INBOX: InboxRow[] = [
  inboxRow({ id: 12, fileName: 'Scan 2026-03-11 18.02.pdf', status: 'failed', error: 'OpenRouter unreachable', createdAt: minutesAgo(30) }),
  inboxRow({ id: 11, fileName: 'Scan 2026-03-11 17.55.pdf', status: 'pending', createdAt: minutesAgo(40) }),
  inboxRow({
    id: 10,
    fileName: 'Scan 2026-03-02 07.10.pdf',
    status: 'duplicate',
    duplicateOf: { id: 1, finalName: '2026-02-27_Revenue_Assessment.pdf' },
    createdAt: at(new Date(2026, 2, 2, 7, 12)),
  }),
];

/** Processed imports, most recent first. */
export const FIXTURE_HISTORY: HistoryRow[] = [
  historyRow({
    id: 6,
    originalName: 'Scan 2026-03-12 10.41.pdf',
    finalName: '2026-03-12_Northwind_Invoice.pdf',
    folder: 'Health/Health insurance',
    category: 'Health/Health insurance',
    filedAt: minutesAgo(2),
  }),
  historyRow({
    id: 3,
    originalName: 'Scan 2026-03-09 08.30.pdf',
    finalName: '2026-03-09_Contoso_Claim.pdf',
    folder: 'Insurance/Car',
    category: 'Insurance/Car',
    filedAt: at(new Date(2026, 2, 11, 16, 20)),
  }),
  historyRow({
    id: 2,
    originalName: 'Scan 2026-03-02 07.10.pdf',
    finalName: '2026-03-02_Stadtwerke_Jahresabrechnung.pdf',
    folder: 'Wohnen/Nebenkosten',
    category: 'Wohnen/Nebenkosten',
    filedAt: at(new Date(2026, 2, 2, 9, 0)),
  }),
  historyRow({
    id: 1,
    originalName: 'Scan 2026-02-27 19.03.pdf',
    finalName: '2026-02-27_Revenue_Assessment.pdf',
    folder: 'Taxes',
    category: 'Taxes',
    filedAt: at(new Date(2026, 1, 27, 19, 5)),
  }),
];
