import { describe, expect, it, vi } from 'vitest';
import type { ProcessedImport, UnprocessedImport } from '../../core/db';
import type { InboxChange, ImportState, HistoryChange } from '../../core/import';
import { IPC_CHANNELS } from '../../core/ipc';
import { connectPipelineEvents } from './events';

const failed: UnprocessedImport = {
  id: 7,
  inboxPath: '/inbox/Scan.pdf',
  fileName: 'Scan.pdf',
  contentHash: 'h',
  status: 'failed',
  error: 'Invalid result',
  duplicateOfId: null,
  createdAt: 'c',
  updatedAt: 'u',
};

const filed: ProcessedImport = {
  id: 3,
  contentHash: 'h',
  originalName: 'Scan.pdf',
  targetPath: '/target/Work/2026-10-15_ACME_Payslip.pdf',
  documentDate: '2026-10-15',
  sender: 'ACME',
  category: 'Work',
  title: 'Payslip',
  model: 'm',
  filedAt: '2026-10-15T10:00:00.000Z',
};

function fakeService() {
  const inbox = new Set<(c: InboxChange) => void>();
  const history = new Set<(c: HistoryChange) => void>();
  const states = new Set<(s: ImportState) => void>();
  const queue = new Set<(n: number) => void>();
  const analyzing = new Set<(id: number | null) => void>();
  let state: ImportState = { mode: 'running' };
  let queued = 0;
  const analyzingId: number | null = null;
  let rows: UnprocessedImport[] = [];
  const on =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => set.delete(listener);
    };
  return {
    service: {
      onInboxChanged: on(inbox),
      onHistoryChanged: on(history),
      onStateChange: on(states),
      onQueuedCountChange: on(queue),
      onAnalyzingChange: on(analyzing),
      getState: () => state,
      queuedCount: () => queued,
      analyzingId: () => analyzingId,
      listInbox: () => rows,
      getHistoryEntry: () => undefined,
    },
    writeInbox: (record: UnprocessedImport) => {
      rows = [record];
      inbox.forEach((l) => l({ kind: 'upsert', record }));
    },
    removeInbox: (id: number) => {
      rows = [];
      inbox.forEach((l) => l({ kind: 'remove', id }));
    },
    writeHistory: (record: ProcessedImport) => history.forEach((l) => l({ kind: 'upsert', record })),
    setState: (s: ImportState) => {
      state = s;
      states.forEach((l) => l(s));
    },
    setQueued: (n: number) => {
      queued = n;
      queue.forEach((l) => l(n));
    },
    listenerCount: () => inbox.size + history.size + states.size + queue.size + analyzing.size,
  };
}

const settings = { getSettings: () => ({ targetPath: '/target' }) as never };

describe('connectPipelineEvents', () => {
  it('forwards inbox and history changes as rows and state changes as AppState', () => {
    const f = fakeService();
    const send = vi.fn();
    connectPipelineEvents({ imports: f.service, settings, send });

    f.writeInbox(failed);
    f.writeHistory(filed);
    f.setState({ mode: 'offline' });
    f.setQueued(2);
    f.removeInbox(7);

    const base = { analyzingId: null };
    expect(send.mock.calls).toEqual([
      [IPC_CHANNELS.inbox.changed, { kind: 'upsert', row: expect.objectContaining({ id: 7, fileName: 'Scan.pdf', status: 'failed', working: false }) }],
      [IPC_CHANNELS.state.changed, { mode: 'running', queuedCount: 0, ...base, attentionCount: 1 }],
      [IPC_CHANNELS.history.changed, { kind: 'upsert', row: expect.objectContaining({ id: 3, finalName: '2026-10-15_ACME_Payslip.pdf', folder: 'Work' }) }],
      [IPC_CHANNELS.state.changed, { mode: 'offline', queuedCount: 0, ...base, attentionCount: 1 }],
      [IPC_CHANNELS.state.changed, { mode: 'offline', queuedCount: 2, ...base, attentionCount: 1 }],
      [IPC_CHANNELS.inbox.changed, { kind: 'remove', id: 7 }],
      [IPC_CHANNELS.state.changed, { mode: 'offline', queuedCount: 2, ...base, attentionCount: 0 }],
    ]);
  });

  it('unsubscribes everything when stopped', () => {
    const f = fakeService();
    const stop = connectPipelineEvents({ imports: f.service, settings, send: vi.fn() });
    expect(f.listenerCount()).toBe(5);
    stop();
    expect(f.listenerCount()).toBe(0);
  });
});
