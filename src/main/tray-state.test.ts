import { describe, expect, it, vi } from 'vitest';
import type { UnprocessedImport } from '../core/db';
import type { ImportState } from '../core/import';
import type { AppState } from '../core/ipc';
import { connectTrayState, trayAppearance, type TrayAppearance } from './tray-state';

const app = (state: Partial<AppState> & Pick<AppState, 'mode'>): AppState =>
  ({ queuedCount: 0, analyzingId: null, attentionCount: 0, ...state }) as AppState;

describe('trayAppearance', () => {
  it.each<[string, Parameters<typeof trayAppearance>[0], TrayAppearance]>([
    ['idle while running', { state: app({ mode: 'running' }) }, { icon: 'idle', tooltip: 'Filey' }],
    ['attention when the key is missing', { state: app({ mode: 'paused', reason: 'missing' }) }, { icon: 'attention', tooltip: 'Filey · Paused, API key missing' }],
    ['attention when the key is unreadable', { state: app({ mode: 'paused', reason: 'unreadable' }) }, { icon: 'attention', tooltip: 'Filey · Paused, API key unreadable' }],
    ['attention when entries failed or are duplicates', { state: app({ mode: 'running', attentionCount: 2 }) }, { icon: 'attention', tooltip: 'Filey · 2 need attention' }],
    ['singular attention tooltip', { state: app({ mode: 'running', attentionCount: 1 }) }, { icon: 'attention', tooltip: 'Filey · 1 needs attention' }],
    ['offline only in the tooltip', { state: app({ mode: 'offline', queuedCount: 3 }) }, { icon: 'idle', tooltip: 'Filey · Offline, 3 waiting' }],
    ['offline without a queue', { state: app({ mode: 'offline' }) }, { icon: 'idle', tooltip: 'Filey · Offline' }],
    ['working while a PDF is analyzed', { state: app({ mode: 'running', analyzingId: 4 }) }, { icon: 'working', tooltip: 'Filey · Filing a scan…' }],
    [
      'working wins over attention entries',
      { state: app({ mode: 'running', analyzingId: 4, attentionCount: 1 }) },
      { icon: 'working', tooltip: 'Filey · Filing a scan… · 1 needs attention' },
    ],
    ['attention when the pipeline did not start', { state: null }, { icon: 'attention', tooltip: 'Filey · Could not start' }],
  ])('%s', (_name, status, expected) => {
    expect(trayAppearance(status)).toEqual(expected);
  });
});

const entry = (id: number, status: UnprocessedImport['status']): UnprocessedImport => ({
  id,
  inboxPath: `/inbox/Scan ${id}.pdf`,
  fileName: `Scan ${id}.pdf`,
  contentHash: `h${id}`,
  status,
  error: status === 'failed' ? 'Invalid result' : null,
  duplicateOfId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
});

function fakeImports(initial: UnprocessedImport[] = []) {
  let inbox = initial;
  let state: ImportState = { mode: 'running' };
  let queued = 0;
  let analyzingId: number | null = null;
  const listeners = {
    inbox: new Set<() => void>(),
    state: new Set<(s: ImportState) => void>(),
    queue: new Set<(n: number) => void>(),
    analyzing: new Set<(id: number | null) => void>(),
  };
  const on =
    <T>(set: Set<T>) =>
    (l: T) => {
      set.add(l);
      return () => {
        set.delete(l);
      };
    };
  return {
    listeners,
    imports: {
      listInbox: () => inbox,
      getState: () => state,
      queuedCount: () => queued,
      analyzingId: () => analyzingId,
      onInboxChanged: on(listeners.inbox),
      onStateChange: on(listeners.state),
      onQueuedCountChange: on(listeners.queue),
      onAnalyzingChange: on(listeners.analyzing),
    },
    setAnalyzing(next: number | null) {
      analyzingId = next;
      listeners.analyzing.forEach((l) => l(next));
    },
    setState(next: ImportState) {
      state = next;
      listeners.state.forEach((l) => l(next));
    },
    setQueued(n: number) {
      queued = n;
      listeners.queue.forEach((l) => l(n));
    },
    setInbox(next: UnprocessedImport[]) {
      inbox = next;
      listeners.inbox.forEach((l) => l());
    },
  };
}

describe('connectTrayState', () => {
  it('starts from the inbox and follows inbox, state, queue and analyzing changes', () => {
    const fake = fakeImports([entry(5, 'failed'), entry(4, 'pending')]);
    const apply = vi.fn();
    const stop = connectTrayState({ imports: fake.imports, apply });
    expect(apply).toHaveBeenLastCalledWith({ icon: 'attention', tooltip: 'Filey · 1 needs attention' });

    fake.setInbox([entry(4, 'pending')]); // the failed file left the inbox
    expect(apply).toHaveBeenLastCalledWith({ icon: 'idle', tooltip: 'Filey' });

    fake.setState({ mode: 'offline' });
    fake.setQueued(2);
    expect(apply).toHaveBeenLastCalledWith({ icon: 'idle', tooltip: 'Filey · Offline, 2 waiting' });

    fake.setState({ mode: 'running' });
    fake.setAnalyzing(4);
    expect(apply).toHaveBeenLastCalledWith({ icon: 'working', tooltip: 'Filey · Filing a scan…' });
    fake.setAnalyzing(null);
    expect(apply).toHaveBeenLastCalledWith({ icon: 'idle', tooltip: 'Filey' });

    fake.setState({ mode: 'paused', reason: 'missing' });
    expect(apply).toHaveBeenLastCalledWith({ icon: 'attention', tooltip: 'Filey · Paused, API key missing' });

    stop();
    expect(Object.values(fake.listeners).reduce((n, set) => n + set.size, 0)).toBe(0);
  });

  it('does not re-apply an unchanged appearance', () => {
    const fake = fakeImports();
    const apply = vi.fn();
    connectTrayState({ imports: fake.imports, apply });
    fake.setInbox([entry(1, 'pending')]);
    fake.setInbox([entry(1, 'pending'), entry(2, 'pending')]);
    expect(apply).toHaveBeenCalledOnce();
  });
});
