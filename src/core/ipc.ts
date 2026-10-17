/**
 * Typed IPC contract between the main process and the renderer.
 *
 * This file is shared by main, preload and renderer, so it must not import
 * Electron (enforced by ESLint for everything under `src/core/`) and only
 * imports types from other core modules (they are erased from the bundle).
 *
 * To add an API method:
 *  1. add the channel name to `IPC_CHANNELS`,
 *  2. describe args/result in `InvokeContract` (or the payload in `EventContract`),
 *  3. expose it in `FileyApi`,
 *  4. wire it in `src/preload/api.ts` and handle it in `src/main/ipc/` (with a `validate`
 *     that checks every argument: the renderer is untrusted).
 *
 * Expected failures (validation errors, missing files, a failing connection test) are part of
 * the result types, so the renderer can show them. A rejected promise means a bug or a call
 * that main refused (untrusted sender, invalid arguments); its message is not meant for users.
 */
import type { ApiKeyStatus } from './api-key';
import type { ConnectionTestInput, ConnectionTestResult } from './connection-test';
import type { FolderSetup } from './folders/types';
import type { HistoryRow, InboxRow, InboxStatus } from './history/types';
import type { ImportState, RetryResult } from './import/types';
import type { FolderRule, Settings, SettingsErrorField } from './settings';

export type { ApiKeyStatus, ConnectionTestInput, ConnectionTestResult, FolderRule, FolderSetup, HistoryRow, InboxRow, InboxStatus, RetryResult, Settings, SettingsErrorField };
export type { ConnectionTestReason } from './connection-test';

/** Channel names, shared by both sides so they cannot drift apart. */
export const IPC_CHANNELS = {
  app: {
    getVersion: 'app:get-version',
    quit: 'app:quit',
    openSettings: 'app:open-settings',
    openLogs: 'app:open-logs',
    getLoginItem: 'app:get-login-item',
    setLoginItem: 'app:set-login-item',
    completeOnboarding: 'app:complete-onboarding',
    getFolderSetup: 'app:get-folder-setup',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    listRules: 'settings:list-rules',
    saveRules: 'settings:save-rules',
    changed: 'settings:changed',
  },
  apiKey: {
    status: 'api-key:status',
    save: 'api-key:save',
    clear: 'api-key:clear',
  },
  connection: {
    test: 'connection:test',
  },
  inbox: {
    list: 'inbox:list',
    retry: 'inbox:retry',
    moveToTrash: 'inbox:move-to-trash',
    revealInFinder: 'inbox:reveal-in-finder',
    openFolder: 'inbox:open-folder',
    changed: 'inbox:changed',
  },
  history: {
    list: 'history:list',
    revealInFinder: 'history:reveal-in-finder',
    changed: 'history:changed',
  },
  state: {
    get: 'state:get',
    changed: 'state:changed',
  },
  dialogs: {
    chooseFolder: 'dialogs:choose-folder',
  },
  popover: {
    hide: 'popover:hide',
    setHeight: 'popover:set-height',
  },
} as const;

/** Settings the renderer may change with `settings.update`. Autostart and onboarding have their own methods. */
export const EDITABLE_SETTINGS = ['model', 'inboxPath', 'targetPath', 'namingTemplate', 'debugLogging'] as const;
export type EditableSetting = (typeof EDITABLE_SETTINGS)[number];
export type SettingsPatch = Partial<Pick<Settings, EditableSetting>>;

/** A rejected settings change. `message` is user-facing; `field` says which input to show it at. */
export interface SettingsError {
  message: string;
  field?: SettingsErrorField;
  /** For `field: 'rules'`: index of the offending rule in the saved list. */
  ruleIndex?: number;
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; error: SettingsError };
export type RulesResult = { ok: true; rules: FolderRule[] } | { ok: false; error: SettingsError };

/** Outcome of an action without a value. `message` is user-facing. */
export type ActionResult<Reason extends string> = { ok: true } | { ok: false; reason: Reason; message: string };

export type SaveApiKeyResult = ActionResult<'empty' | 'storage-unavailable'>;
export type RevealResult = ActionResult<'not-found' | 'not-allowed' | 'file-missing' | 'failed'>;
/** `inbox.moveToTrash` moves the inbox file to the macOS Trash (`shell.trashItem`), so it can be put back. */
export type TrashResult = ActionResult<'not-found' | 'not-allowed' | 'file-missing' | 'failed'>;
export type OpenInboxResult = ActionResult<'missing' | 'failed'>;
/** `openLogs` opens the log file (`~/Library/Logs/Filey/filey.log`) with the default app (Console). */
export type OpenLogsResult = ActionResult<'failed'>;

/**
 * What the pipeline is doing, how many files wait for the connection, which inbox entry is being analyzed
 * right now (null if none) and how many inbox entries need the user (failed or duplicate; tray, popover).
 */
export type AppState = ImportState & { queuedCount: number; analyzingId: number | null; attentionCount: number };

/** A change to the Inbox view: a row was written, or the file left the inbox. */
export type InboxChange = { kind: 'upsert'; row: InboxRow } | { kind: 'remove'; id: number };
/** A change to the History view: a document was filed, or its entry was removed (its file no longer exists). */
export type HistoryChange = { kind: 'upsert'; row: HistoryRow } | { kind: 'remove'; id: number };

export type SettingsTab = 'general' | 'provider' | 'filing';
export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'provider', 'filing'];

export type FolderKind = 'inbox' | 'target';
export const FOLDER_KINDS: readonly FolderKind[] = ['inbox', 'target'];

export interface HistoryQuery {
  /** 1 to `MAX_HISTORY_LIMIT`. */
  limit: number;
  /** Filters by original name, final name, folder and category (case-insensitive). */
  query?: string;
}
export const MAX_HISTORY_LIMIT = 500;

/** Height range the popover window accepts from `popover.setHeight` (CSS px); main also clamps to the screen. */
export const POPOVER_HEIGHT = { min: 120, max: 560 } as const;

/** Request/response channels (`ipcRenderer.invoke` -> `ipcMain.handle`). */
export interface InvokeContract {
  [IPC_CHANNELS.app.getVersion]: { args: []; result: string };
  [IPC_CHANNELS.app.quit]: { args: []; result: void };
  [IPC_CHANNELS.app.openSettings]: { args: [tab?: SettingsTab]; result: void };
  [IPC_CHANNELS.app.openLogs]: { args: []; result: OpenLogsResult };
  [IPC_CHANNELS.app.getLoginItem]: { args: []; result: boolean };
  [IPC_CHANNELS.app.setLoginItem]: { args: [enabled: boolean]; result: boolean };
  [IPC_CHANNELS.app.completeOnboarding]: { args: []; result: Settings };
  [IPC_CHANNELS.app.getFolderSetup]: { args: []; result: FolderSetup };

  [IPC_CHANNELS.settings.get]: { args: []; result: Settings };
  [IPC_CHANNELS.settings.update]: { args: [patch: SettingsPatch]; result: SettingsResult };
  [IPC_CHANNELS.settings.listRules]: { args: []; result: FolderRule[] };
  [IPC_CHANNELS.settings.saveRules]: { args: [rules: FolderRule[]]; result: RulesResult };

  [IPC_CHANNELS.apiKey.status]: { args: []; result: ApiKeyStatus };
  [IPC_CHANNELS.apiKey.save]: { args: [key: string]; result: SaveApiKeyResult };
  [IPC_CHANNELS.apiKey.clear]: { args: []; result: void };

  [IPC_CHANNELS.connection.test]: { args: [input: ConnectionTestInput]; result: ConnectionTestResult };

  [IPC_CHANNELS.inbox.list]: { args: []; result: InboxRow[] };
  [IPC_CHANNELS.inbox.retry]: { args: [id: number]; result: RetryResult };
  [IPC_CHANNELS.inbox.moveToTrash]: { args: [id: number]; result: TrashResult };
  [IPC_CHANNELS.inbox.revealInFinder]: { args: [id: number]; result: RevealResult };
  [IPC_CHANNELS.inbox.openFolder]: { args: []; result: OpenInboxResult };

  [IPC_CHANNELS.history.list]: { args: [query: HistoryQuery]; result: HistoryRow[] };
  [IPC_CHANNELS.history.revealInFinder]: { args: [id: number]; result: RevealResult };

  [IPC_CHANNELS.state.get]: { args: []; result: AppState };

  [IPC_CHANNELS.dialogs.chooseFolder]: { args: [kind: FolderKind]; result: string | null };

  [IPC_CHANNELS.popover.hide]: { args: []; result: void };
  [IPC_CHANNELS.popover.setHeight]: { args: [height: number]; result: void };
}

export type InvokeChannel = keyof InvokeContract;

/** Main -> renderer event channels (`webContents.send`). */
export interface EventContract {
  /** After every inbox write or removal, so the Inbox view can update in place. */
  [IPC_CHANNELS.inbox.changed]: InboxChange;
  /** After every history write or removal, so the History view can update in place. */
  [IPC_CHANNELS.history.changed]: HistoryChange;
  /** Pipeline state or the number of queued files changed. */
  [IPC_CHANNELS.state.changed]: AppState;
  /** Settings were saved (from any window). */
  [IPC_CHANNELS.settings.changed]: Settings;
}

export type EventChannel = keyof EventContract;

/** Removes a previously registered event listener. */
export type Unsubscribe = () => void;

type Listener<C extends EventChannel> = (event: EventContract[C]) => void;

/**
 * The API exposed to the renderer as `window.filey`.
 * Secrets (e.g. the API key) must never be part of a result type: once saved,
 * they stay in the main process.
 */
export interface FileyApi {
  app: {
    getVersion(): Promise<string>;
    quit(): Promise<void>;
    /** Opens (or focuses) the Settings window, optionally on a tab. */
    openSettings(tab?: SettingsTab): Promise<void>;
    openLogs(): Promise<OpenLogsResult>;
    /** Whether Filey starts at login (`app.getLoginItemSettings`). */
    getLoginItem(): Promise<boolean>;
    /** Applies and stores "start at login"; resolves with the state macOS reports afterwards. */
    setLoginItem(enabled: boolean): Promise<boolean>;
    /** Marks the first-launch flow as done; resolves with the saved settings. Main then closes the first-launch window. */
    completeOnboarding(): Promise<Settings>;
    /** How the default inbox and target folders were set up at the first launch (shown in the last onboarding step). */
    getFolderSetup(): Promise<FolderSetup>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<SettingsResult>;
    listRules(): Promise<FolderRule[]>;
    saveRules(rules: FolderRule[]): Promise<RulesResult>;
    onChanged(listener: Listener<typeof IPC_CHANNELS.settings.changed>): Unsubscribe;
  };
  apiKey: {
    /** Never the key itself. */
    status(): Promise<ApiKeyStatus>;
    save(key: string): Promise<SaveApiKeyResult>;
    clear(): Promise<void>;
  };
  connection: {
    /** Runs the analysis on the bundled sample scan; `key`/`model` default to the saved ones. */
    test(input?: ConnectionTestInput): Promise<ConnectionTestResult>;
  };
  inbox: {
    /** Files still in the inbox (pending, failed, duplicate), newest first. */
    list(): Promise<InboxRow[]>;
    /** Re-runs a failed import; resolves when it has finished. */
    retry(id: number): Promise<RetryResult>;
    /** Moves the inbox file to the Trash; its row disappears via `inbox:changed`. */
    moveToTrash(id: number): Promise<TrashResult>;
    /** Reveals the file in the inbox. */
    revealInFinder(id: number): Promise<RevealResult>;
    /** Opens the inbox folder in Finder. */
    openFolder(): Promise<OpenInboxResult>;
    onChanged(listener: Listener<typeof IPC_CHANNELS.inbox.changed>): Unsubscribe;
  };
  history: {
    /** Filed documents, most recent first. */
    list(query: HistoryQuery): Promise<HistoryRow[]>;
    /** Reveals the filed document (also used for "Show original" of a duplicate). */
    revealInFinder(id: number): Promise<RevealResult>;
    onChanged(listener: Listener<typeof IPC_CHANNELS.history.changed>): Unsubscribe;
  };
  state: {
    get(): Promise<AppState>;
    onChanged(listener: Listener<typeof IPC_CHANNELS.state.changed>): Unsubscribe;
  };
  dialogs: {
    /** Native folder picker; resolves with the chosen path or null if cancelled. Does not save it. */
    chooseFolder(kind: FolderKind): Promise<string | null>;
  };
  popover: {
    /** Hides the menu-bar popover (Esc). Does nothing if it is not open. */
    hide(): Promise<void>;
    /** Tells main the height the popover content needs, so the window fits it (`POPOVER_HEIGHT`). */
    setHeight(height: number): Promise<void>;
  };
}

/** Name of the global property the preload script defines on `window`. */
export const FILEY_API_KEY = 'filey';
