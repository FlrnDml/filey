import { IPC_CHANNELS, type EventChannel, type EventContract, type FileyApi, type InvokeChannel, type InvokeContract, type Unsubscribe } from '../core/ipc';

/** The slice of Electron's `ipcRenderer` we use; lets tests pass a fake. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

/**
 * Builds the `window.filey` API on top of `ipcRenderer`. `ipcRenderer` itself and the
 * IPC event object are never handed to the renderer; only these narrow functions are.
 * Every method only forwards its arguments; main validates them.
 */
export function createFileyApi(ipcRenderer: IpcRendererLike): FileyApi {
  const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeContract[C]['args']) =>
    ipcRenderer.invoke(channel, ...args) as Promise<InvokeContract[C]['result']>;

  const subscribe = <C extends EventChannel>(channel: C, listener: (payload: EventContract[C]) => void): Unsubscribe => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload as EventContract[C]);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };

  const { app, settings, apiKey, connection, inbox, history, state, dialogs, popover } = IPC_CHANNELS;

  return {
    app: {
      getVersion: () => invoke(app.getVersion),
      quit: () => invoke(app.quit),
      // Omit an absent tab instead of sending `undefined`, so main sees the documented arity.
      openSettings: (tab) => (tab === undefined ? invoke(app.openSettings) : invoke(app.openSettings, tab)),
      openLogs: () => invoke(app.openLogs),
      getLoginItem: () => invoke(app.getLoginItem),
      setLoginItem: (enabled) => invoke(app.setLoginItem, enabled),
      completeOnboarding: () => invoke(app.completeOnboarding),
      getFolderSetup: () => invoke(app.getFolderSetup),
    },
    settings: {
      get: () => invoke(settings.get),
      update: (patch) => invoke(settings.update, patch),
      listRules: () => invoke(settings.listRules),
      saveRules: (rules) => invoke(settings.saveRules, rules),
      onChanged: (listener) => subscribe(settings.changed, listener),
    },
    apiKey: {
      status: () => invoke(apiKey.status),
      save: (key) => invoke(apiKey.save, key),
      clear: () => invoke(apiKey.clear),
    },
    connection: {
      test: (input = {}) => invoke(connection.test, input),
    },
    inbox: {
      list: () => invoke(inbox.list),
      retry: (id) => invoke(inbox.retry, id),
      moveToTrash: (id) => invoke(inbox.moveToTrash, id),
      revealInFinder: (id) => invoke(inbox.revealInFinder, id),
      openFolder: () => invoke(inbox.openFolder),
      onChanged: (listener) => subscribe(inbox.changed, listener),
    },
    history: {
      list: (query) => invoke(history.list, query),
      revealInFinder: (id) => invoke(history.revealInFinder, id),
      onChanged: (listener) => subscribe(history.changed, listener),
    },
    state: {
      get: () => invoke(state.get),
      onChanged: (listener) => subscribe(state.changed, listener),
    },
    dialogs: {
      chooseFolder: (kind) => invoke(dialogs.chooseFolder, kind),
    },
    popover: {
      hide: () => invoke(popover.hide),
      setHeight: (height) => invoke(popover.setHeight, height),
    },
  };
}
