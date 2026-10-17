import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../core/ipc';
import { createFileyApi, type IpcRendererLike } from './api';

type Listener = (event: unknown, payload: unknown) => void;

class FakeIpcRenderer implements IpcRendererLike {
  readonly listeners = new Map<string, Set<Listener>>();
  invoke = vi.fn<IpcRendererLike['invoke']>(async () => undefined);
  on(channel: string, listener: Listener): void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
  }
  removeListener(channel: string, listener: Listener): void {
    this.listeners.get(channel)?.delete(listener);
  }
  emit(channel: string, payload: unknown): void {
    this.listeners.get(channel)?.forEach((listener) => listener({ sender: 'internal' }, payload));
  }
}

describe('createFileyApi', () => {
  it('forwards app.getVersion over the shared channel name', async () => {
    const ipc = new FakeIpcRenderer();
    ipc.invoke.mockResolvedValue('1.2.3');

    await expect(createFileyApi(ipc).app.getVersion()).resolves.toBe('1.2.3');
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.app.getVersion);
  });

  it('forwards every method to its channel with exactly its arguments', async () => {
    const ipc = new FakeIpcRenderer();
    const api = createFileyApi(ipc);
    const C = IPC_CHANNELS;
    const rules = [{ folder: 'Unsorted', description: 'Rest' }];
    const cases: [() => Promise<unknown>, unknown[]][] = [
      [() => api.app.quit(), [C.app.quit]],
      [() => api.app.openSettings(), [C.app.openSettings]],
      [() => api.app.openSettings('provider'), [C.app.openSettings, 'provider']],
      [() => api.app.openLogs(), [C.app.openLogs]],
      [() => api.app.getLoginItem(), [C.app.getLoginItem]],
      [() => api.app.setLoginItem(true), [C.app.setLoginItem, true]],
      [() => api.app.completeOnboarding(), [C.app.completeOnboarding]],
      [() => api.app.getFolderSetup(), [C.app.getFolderSetup]],
      [() => api.settings.get(), [C.settings.get]],
      [() => api.settings.update({ model: 'a/b' }), [C.settings.update, { model: 'a/b' }]],
      [() => api.settings.listRules(), [C.settings.listRules]],
      [() => api.settings.saveRules(rules), [C.settings.saveRules, rules]],
      [() => api.apiKey.status(), [C.apiKey.status]],
      [() => api.apiKey.save('sk-or-x'), [C.apiKey.save, 'sk-or-x']],
      [() => api.apiKey.clear(), [C.apiKey.clear]],
      [() => api.connection.test(), [C.connection.test, {}]],
      [() => api.connection.test({ model: 'a/b' }), [C.connection.test, { model: 'a/b' }]],
      [() => api.history.list({ limit: 20, query: 'tax' }), [C.history.list, { limit: 20, query: 'tax' }]],
      [() => api.inbox.list(), [C.inbox.list]],
      [() => api.inbox.retry(4), [C.inbox.retry, 4]],
      [() => api.inbox.moveToTrash(4), [C.inbox.moveToTrash, 4]],
      [() => api.inbox.revealInFinder(4), [C.inbox.revealInFinder, 4]],
      [() => api.inbox.openFolder(), [C.inbox.openFolder]],
      [() => api.history.revealInFinder(4), [C.history.revealInFinder, 4]],
      [() => api.state.get(), [C.state.get]],
      [() => api.dialogs.chooseFolder('target'), [C.dialogs.chooseFolder, 'target']],
      [() => api.popover.hide(), [C.popover.hide]],
      [() => api.popover.setHeight(320), [C.popover.setHeight, 320]],
    ];
    for (const [call, expected] of cases) {
      ipc.invoke.mockClear();
      await call();
      expect(ipc.invoke.mock.calls).toEqual([expected]);
    }
  });

  it('delivers only the payload (not the IPC event) to event listeners', () => {
    const ipc = new FakeIpcRenderer();
    const api = createFileyApi(ipc);
    const history = vi.fn();
    const inbox = vi.fn();
    const state = vi.fn();
    const settings = vi.fn();
    api.history.onChanged(history);
    api.inbox.onChanged(inbox);
    api.state.onChanged(state);
    api.settings.onChanged(settings);

    ipc.emit(IPC_CHANNELS.history.changed, { kind: 'remove', id: 3 });
    ipc.emit(IPC_CHANNELS.inbox.changed, { kind: 'remove', id: 7 });
    ipc.emit(IPC_CHANNELS.state.changed, { mode: 'offline', queuedCount: 1 });
    ipc.emit(IPC_CHANNELS.settings.changed, { model: 'a/b' });

    expect(history).toHaveBeenCalledExactlyOnceWith({ kind: 'remove', id: 3 });
    expect(inbox).toHaveBeenCalledExactlyOnceWith({ kind: 'remove', id: 7 });
    expect(state).toHaveBeenCalledExactlyOnceWith({ mode: 'offline', queuedCount: 1 });
    expect(settings).toHaveBeenCalledExactlyOnceWith({ model: 'a/b' });
  });

  it('stops delivering events after unsubscribing', () => {
    const ipc = new FakeIpcRenderer();
    const listener = vi.fn();
    const unsubscribe = createFileyApi(ipc).history.onChanged(listener);

    unsubscribe();
    ipc.emit(IPC_CHANNELS.history.changed, { kind: 'remove', id: 3 });

    expect(listener).not.toHaveBeenCalled();
    expect(ipc.listeners.get(IPC_CHANNELS.history.changed)?.size).toBe(0);
  });

  it('exposes only the narrow namespaces, no raw ipcRenderer members', () => {
    const api = createFileyApi(new FakeIpcRenderer());
    expect(Object.keys(api).sort()).toEqual(['apiKey', 'app', 'connection', 'dialogs', 'history', 'inbox', 'popover', 'settings', 'state']);
    for (const group of Object.values(api)) {
      for (const member of Object.values(group as Record<string, unknown>)) expect(typeof member).toBe('function');
    }
    const members = Object.values(api).flatMap((g) => Object.keys(g));
    for (const raw of ['invoke', 'send', 'on', 'removeListener', 'sendSync']) expect(members).not.toContain(raw);
  });
});
