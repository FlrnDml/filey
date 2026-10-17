import * as path from 'node:path';
import { ApiKeyError, type ApiKeyStore } from '../../core/api-key';
import type { ConnectionTestInput, ConnectionTestResult } from '../../core/connection-test';
import type { FolderSetup } from '../../core/folders';
import { isInside, listHistoryRows, resolveRevealPath, toInboxRow } from '../../core/history';
import type { ImportService } from '../../core/import';
import {
  EDITABLE_SETTINGS,
  FOLDER_KINDS,
  IPC_CHANNELS,
  MAX_HISTORY_LIMIT,
  POPOVER_HEIGHT,
  SETTINGS_TABS,
  type FolderRule,
  type HistoryQuery,
  type OpenInboxResult,
  type OpenLogsResult,
  type RevealResult,
  type TrashResult,
  type Settings,
  type SettingsError,
  type SettingsPatch,
  type SettingsTab,
} from '../../core/ipc';
import type { FileSystem, LogFileSystem, Logger } from '../../core/ports';
import { SettingsValidationError, type SettingsRepository } from '../../core/settings';
import type { Watcher } from '../../core/watcher';
import { currentAppState } from './events';
import type { IpcHandlers } from './register';
import {
  expectAbsolutePath,
  expectArity,
  expectArray,
  expectBoolean,
  expectInteger,
  expectNoArgs,
  expectObject,
  expectOneOf,
  expectString,
} from './validate';

/** Limits for strings from the renderer; generous for real input, small enough to stop abuse. */
export const LIMITS = {
  model: 200,
  namingTemplate: 500,
  apiKey: 4096,
  folder: 255,
  description: 2000,
  rules: 200,
  query: 200,
} as const;

export const USER_MESSAGES = {
  importNotFound: 'This import is no longer in the history.',
  inboxEntryNotFound: 'This file is no longer in the inbox.',
  trashFailed: 'The file could not be moved to the Trash.',
  notAllowed: 'Filey only opens files in the inbox or the target folder.',
  notAllowedInbox: 'Filey only moves files in the inbox folder to the Trash.',
  fileMissing: 'The file is no longer there. It may have been moved or deleted.',
  inboxMissing: 'The inbox folder does not exist. Choose another one in Settings.',
  inboxFailed: 'The inbox folder could not be opened.',
  logsFailed: 'The log file could not be opened.',
} as const;

/** Handlers that work even if the database could not be opened. */
export interface AppHandlerDeps {
  getAppVersion(): string;
  quit(): void;
  /** Opens or focuses the Settings window, optionally on a tab. */
  openSettings(tab?: SettingsTab): void;
  openLogs(): Promise<OpenLogsResult>;
  /** `app.getLoginItemSettings().openAtLogin`. */
  getLoginItem(): boolean;
  /** Hides the menu-bar popover if it is open. */
  hidePopover(): void;
  /** Resizes the popover window to fit its content (already within `POPOVER_HEIGHT`). */
  setPopoverHeight(height: number): void;
}

export function createAppHandlers(deps: AppHandlerDeps): IpcHandlers {
  const { app, popover } = IPC_CHANNELS;
  return {
    [app.getVersion]: { validate: expectNoArgs, handle: () => deps.getAppVersion() },
    [app.quit]: { validate: expectNoArgs, handle: () => deps.quit() },
    [app.openSettings]: {
      validate: (args) => {
        expectArity(args, 0, 1);
        return args[0] === undefined ? [] : [expectOneOf(args[0], 'tab', SETTINGS_TABS)];
      },
      handle: (tab) => deps.openSettings(tab),
    },
    [app.openLogs]: { validate: expectNoArgs, handle: () => deps.openLogs() },
    [app.getLoginItem]: { validate: expectNoArgs, handle: () => deps.getLoginItem() },
    [popover.hide]: { validate: expectNoArgs, handle: () => deps.hidePopover() },
    [popover.setHeight]: {
      validate: (args) => {
        expectArity(args, 1);
        return [expectInteger(args[0], 'height', POPOVER_HEIGHT)];
      },
      handle: (height) => deps.setPopoverHeight(height),
    },
  };
}

/** Handlers that need the database, the key store and the import pipeline. */
export interface ServiceHandlerDeps {
  settings: Pick<SettingsRepository, 'getSettings' | 'updateSettings' | 'listRules' | 'saveRules'>;
  apiKeys: Pick<ApiKeyStore, 'status' | 'set' | 'clear'>;
  imports: Pick<
    ImportService,
    | 'listInbox'
    | 'getInboxEntry'
    | 'retry'
    | 'handleRemoved'
    | 'listHistory'
    | 'getHistoryEntry'
    | 'getState'
    | 'queuedCount'
    | 'analyzingId'
  >;
  watcher: Pick<Watcher, 'restart'>;
  testConnection(input: ConnectionTestInput): Promise<ConnectionTestResult>;
  fs: Pick<FileSystem, 'exists'>;
  /** Thin wrapper around Electron's `shell`. */
  shell: {
    showItemInFolder(fullPath: string): void;
    /** Resolves with an error message, or '' on success (like `shell.openPath`). */
    openPath(fullPath: string): Promise<string>;
    /** Moves a file to the Trash (`shell.trashItem`); rejects if that fails. */
    trashItem(fullPath: string): Promise<void>;
  };
  /** Native folder picker (`dialog.showOpenDialog`); resolves with the path or null if cancelled. */
  chooseFolder(options: { title: string; defaultPath?: string }): Promise<string | null>;
  /** `app.setLoginItemSettings({ openAtLogin })`. */
  setLoginItem(enabled: boolean): void;
  getLoginItem(): boolean;
  logger: Logger;
  /** Called after settings were saved, e.g. to broadcast `settings:changed`. */
  onSettingsChanged?(settings: Settings): void;
  /** How the default folders were set up at this start (`setupDefaultFolders`). */
  folderSetup: FolderSetup;
  /** Called after `completeOnboarding` saved the flag; main closes the first-launch window (arc42 §6.4 step 4). */
  onOnboardingCompleted?(): void;
}

const toSettingsError = (err: SettingsValidationError): SettingsError => ({
  message: err.message,
  ...(err.field === undefined ? {} : { field: err.field }),
  ...(err.ruleIndex === undefined ? {} : { ruleIndex: err.ruleIndex }),
});

function validatePatch(value: unknown): SettingsPatch {
  const raw = expectObject(value, 'patch', EDITABLE_SETTINGS);
  const patch: SettingsPatch = {};
  // Empty strings pass, so the settings validation can answer with a user-facing message for that field.
  const pathOrEmpty = (v: unknown, name: string) => (v === '' ? '' : expectAbsolutePath(v, name));
  if (raw.model !== undefined) patch.model = expectString(raw.model, 'model', { max: LIMITS.model, allowEmpty: true });
  if (raw.inboxPath !== undefined) patch.inboxPath = pathOrEmpty(raw.inboxPath, 'inboxPath');
  if (raw.targetPath !== undefined) patch.targetPath = pathOrEmpty(raw.targetPath, 'targetPath');
  if (raw.namingTemplate !== undefined) {
    patch.namingTemplate = expectString(raw.namingTemplate, 'namingTemplate', { max: LIMITS.namingTemplate, allowEmpty: true });
  }
  if (raw.debugLogging !== undefined) patch.debugLogging = expectBoolean(raw.debugLogging, 'debugLogging');
  return patch;
}

function validateRules(value: unknown): FolderRule[] {
  return expectArray(value, 'rules', { max: LIMITS.rules }).map((entry) => {
    const rule = expectObject(entry, 'rule', ['folder', 'description'] as const);
    return {
      folder: expectString(rule.folder, 'rule.folder', { max: LIMITS.folder, allowEmpty: true }),
      description: expectString(rule.description, 'rule.description', { max: LIMITS.description, allowEmpty: true }),
    };
  });
}

function validateConnectionInput(args: unknown[]): [ConnectionTestInput] {
  expectArity(args, 0, 1);
  if (args[0] === undefined) return [{}];
  const raw = expectObject(args[0], 'input', ['key', 'model'] as const);
  const input: ConnectionTestInput = {};
  if (raw.key !== undefined) input.key = expectString(raw.key, 'key', { max: LIMITS.apiKey, allowEmpty: true });
  if (raw.model !== undefined) input.model = expectString(raw.model, 'model', { max: LIMITS.model, allowEmpty: true });
  return [input];
}

function validateHistoryQuery(value: unknown): HistoryQuery {
  const raw = expectObject(value, 'query', ['limit', 'query'] as const);
  const query: HistoryQuery = { limit: expectInteger(raw.limit, 'limit', { min: 1, max: MAX_HISTORY_LIMIT }) };
  if (raw.query !== undefined) query.query = expectString(raw.query, 'query', { max: LIMITS.query, allowEmpty: true });
  return query;
}

const entryId = (args: unknown[]): [number] => {
  expectArity(args, 1);
  return [expectInteger(args[0], 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })];
};

const sameFolder = (a: string, b: string) => path.resolve(a) === path.resolve(b);

export function createServiceHandlers(deps: ServiceHandlerDeps): IpcHandlers {
  const { settings, apiKeys, imports, logger } = deps;
  const { app, settings: settingsChannels, apiKey, connection, inbox, history, state, dialogs } = IPC_CHANNELS;

  const saved = (next: Settings) => {
    deps.onSettingsChanged?.(next);
    return next;
  };

  const reveal = async (what: string, file: string): Promise<RevealResult> => {
    const target = resolveRevealPath(file, settings.getSettings());
    if (!target.ok) {
      logger.log('warn', `IPC: refused to reveal ${what}, its file is outside the inbox and target folder`);
      return { ok: false, reason: 'not-allowed', message: USER_MESSAGES.notAllowed };
    }
    if (!(await deps.fs.exists(target.path))) return { ok: false, reason: 'file-missing', message: USER_MESSAGES.fileMissing };
    deps.shell.showItemInFolder(target.path);
    return { ok: true };
  };

  return {
    [app.setLoginItem]: {
      validate: (args) => {
        expectArity(args, 1);
        return [expectBoolean(args[0], 'enabled')];
      },
      handle: (enabled) => {
        deps.setLoginItem(enabled);
        saved(settings.updateSettings({ autostart: enabled }));
        return deps.getLoginItem();
      },
    },
    [app.completeOnboarding]: {
      validate: expectNoArgs,
      handle: () => {
        const next = saved(settings.updateSettings({ onboardingCompleted: true }));
        deps.onOnboardingCompleted?.();
        return next;
      },
    },

    [app.getFolderSetup]: { validate: expectNoArgs, handle: () => deps.folderSetup },

    [settingsChannels.get]: { validate: expectNoArgs, handle: () => settings.getSettings() },
    [settingsChannels.update]: {
      validate: (args) => {
        expectArity(args, 1);
        return [validatePatch(args[0])];
      },
      handle: (patch) => {
        const before = settings.getSettings();
        let next: Settings;
        try {
          next = settings.updateSettings(patch);
        } catch (err) {
          if (err instanceof SettingsValidationError) return { ok: false, error: toSettingsError(err) };
          throw err;
        }
        // The watcher only follows the inbox it was started with (arc42 §6.3); move it to the new one.
        if (!sameFolder(before.inboxPath, next.inboxPath)) {
          logger.log('info', 'Settings: inbox changed, restarting the watcher');
          deps.watcher.restart(next.inboxPath);
        }
        return { ok: true, settings: saved(next) };
      },
    },
    [settingsChannels.listRules]: { validate: expectNoArgs, handle: () => settings.listRules() },
    [settingsChannels.saveRules]: {
      validate: (args) => {
        expectArity(args, 1);
        return [validateRules(args[0])];
      },
      handle: (rules) => {
        try {
          return { ok: true, rules: settings.saveRules(rules) };
        } catch (err) {
          if (err instanceof SettingsValidationError) return { ok: false, error: toSettingsError(err) };
          throw err;
        }
      },
    },

    [apiKey.status]: { validate: expectNoArgs, handle: () => apiKeys.status() },
    [apiKey.save]: {
      validate: (args) => {
        expectArity(args, 1);
        return [expectString(args[0], 'key', { max: LIMITS.apiKey, allowEmpty: true })];
      },
      handle: async (key) => {
        try {
          await apiKeys.set(key);
          return { ok: true };
        } catch (err) {
          // ApiKeyError messages are fixed text and never contain the key.
          if (err instanceof ApiKeyError) return { ok: false, reason: err.reason, message: err.message };
          throw err;
        }
      },
    },
    [apiKey.clear]: { validate: expectNoArgs, handle: () => apiKeys.clear() },

    [connection.test]: { validate: validateConnectionInput, handle: (input) => deps.testConnection(input) },

    [inbox.list]: {
      validate: expectNoArgs,
      handle: () => {
        const context = { analyzingId: imports.analyzingId(), findProcessed: (id: number) => imports.getHistoryEntry(id) };
        return imports.listInbox().map((record) => toInboxRow(record, context));
      },
    },
    [inbox.retry]: { validate: entryId, handle: (id) => imports.retry(id) },
    [inbox.moveToTrash]: {
      validate: entryId,
      handle: async (id): Promise<TrashResult> => {
        const entry = imports.getInboxEntry(id);
        if (!entry) return { ok: false, reason: 'not-found', message: USER_MESSAGES.inboxEntryNotFound };
        const file = entry.inboxPath;
        const { inboxPath } = settings.getSettings();
        // Only files directly managed in the inbox may be trashed, never the target folder.
        if (!path.isAbsolute(file) || file.includes('\0') || !isInside(file, inboxPath)) {
          logger.log('warn', `IPC: refused to trash inbox entry ${id}, its file is outside the inbox folder`);
          return { ok: false, reason: 'not-allowed', message: USER_MESSAGES.notAllowedInbox };
        }
        const resolved = path.resolve(file);
        if (!(await deps.fs.exists(resolved))) {
          // Already gone: make the row disappear as well.
          imports.handleRemoved(resolved);
          return { ok: false, reason: 'file-missing', message: USER_MESSAGES.fileMissing };
        }
        try {
          await deps.shell.trashItem(resolved);
        } catch (err) {
          logger.log('error', `IPC: could not move inbox entry ${id} to the Trash: ${err instanceof Error ? err.message : String(err)}`);
          return { ok: false, reason: 'failed', message: USER_MESSAGES.trashFailed };
        }
        imports.handleRemoved(resolved);
        return { ok: true };
      },
    },
    [inbox.revealInFinder]: {
      validate: entryId,
      handle: async (id): Promise<RevealResult> => {
        const entry = imports.getInboxEntry(id);
        if (!entry) return { ok: false, reason: 'not-found', message: USER_MESSAGES.inboxEntryNotFound };
        return reveal(`inbox entry ${id}`, entry.inboxPath);
      },
    },
    [inbox.openFolder]: {
      validate: expectNoArgs,
      handle: async (): Promise<OpenInboxResult> => {
        const folder = path.resolve(settings.getSettings().inboxPath);
        if (!(await deps.fs.exists(folder))) return { ok: false, reason: 'missing', message: USER_MESSAGES.inboxMissing };
        const error = await deps.shell.openPath(folder);
        if (error !== '') {
          logger.log('error', `IPC: could not open the inbox: ${error}`);
          return { ok: false, reason: 'failed', message: USER_MESSAGES.inboxFailed };
        }
        return { ok: true };
      },
    },

    [history.list]: {
      validate: (args) => {
        expectArity(args, 1);
        return [validateHistoryQuery(args[0])];
      },
      handle: (query) => listHistoryRows((limit) => imports.listHistory(limit), { targetPath: settings.getSettings().targetPath }, query),
    },
    [history.revealInFinder]: {
      validate: entryId,
      handle: async (id): Promise<RevealResult> => {
        const record = imports.getHistoryEntry(id);
        if (!record) return { ok: false, reason: 'not-found', message: USER_MESSAGES.importNotFound };
        return reveal(`import ${id}`, record.targetPath);
      },
    },

    [state.get]: { validate: expectNoArgs, handle: () => currentAppState(imports) },

    [dialogs.chooseFolder]: {
      validate: (args) => {
        expectArity(args, 1);
        return [expectOneOf(args[0], 'kind', FOLDER_KINDS)];
      },
      handle: (kind) => {
        const current = settings.getSettings();
        return deps.chooseFolder(
          kind === 'inbox'
            ? { title: 'Choose the inbox folder', defaultPath: current.inboxPath }
            : { title: 'Choose the target folder', defaultPath: current.targetPath },
        );
      },
    },
  };
}

export interface OpenLogsDeps {
  /** The app's log file; flushed first, so the newest lines are on disk. */
  logFile: { readonly path: string; flush(): Promise<void> };
  fs: Pick<LogFileSystem, 'mkdir' | 'append'>;
  /** `shell.openPath`: resolves with an error message, or '' on success. */
  openPath(fullPath: string): Promise<string>;
  logger: Logger;
}

/**
 * "Show logs" (tray menu, application menu, Settings → General): opens `filey.log` with the default app
 * (Console on macOS), creating an empty file first if nothing was logged yet (arc42 §8 "Logging").
 * Only ever opens this one path; the renderer cannot pass one.
 */
export function createOpenLogs({ logFile, fs, openPath, logger }: OpenLogsDeps): () => Promise<OpenLogsResult> {
  return async () => {
    try {
      await logFile.flush();
      await fs.mkdir(path.dirname(logFile.path));
      await fs.append(logFile.path, '');
      const error = await openPath(logFile.path);
      if (error !== '') throw new Error(error);
      return { ok: true };
    } catch (err) {
      logger.log('error', `Logs: could not open the log file: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed', message: USER_MESSAGES.logsFailed };
    }
  };
}
