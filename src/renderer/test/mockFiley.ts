/**
 * Stand-ins for the preload bridge, so screens render in jsdom (tests) without Electron. Not part of the app bundle.
 */
import type {
  ApiKeyStatus,
  AppState,
  ConnectionTestResult,
  EventContract,
  FileyApi,
  FolderRule,
  FolderSetup,
  HistoryRow,
  InboxRow,
  SaveApiKeyResult,
  Settings,
  SettingsError,
  SettingsPatch,
} from '../../core/ipc';

export interface MockFileyOptions {
  /** Filed documents (History view). */
  history?: HistoryRow[];
  /** Files in the inbox (Inbox view). */
  inbox?: InboxRow[];
  state?: AppState;
  inboxPath?: string;
  /** Overrides of the mock settings. */
  settings?: Partial<Settings>;
  rules?: FolderRule[];
  /** Default: from `state` ('set' unless paused). */
  apiKeyStatus?: ApiKeyStatus;
  /** What "Test connection" answers. Default: connected. */
  connection?: ConnectionTestResult;
  /** What the folder picker answers. Default: cancelled (null). */
  chosenFolder?: string | null;
  /** Stands in for main's validation: return an error to reject a settings change. */
  rejectUpdate?: (patch: SettingsPatch, current: Settings) => SettingsError | undefined;
  /** Stands in for main's rule validation. */
  rejectRules?: (rules: FolderRule[]) => SettingsError | undefined;
  /** How the default folders were set up (last onboarding step). Default: created in iCloud Drive. */
  folderSetup?: FolderSetup;
  /** What saving the API key answers. Default: saved. */
  saveApiKey?: (key: string) => SaveApiKeyResult;
}

export interface MockFiley {
  api: FileyApi;
  /** Pushes a main -> renderer event to the registered listeners. */
  emit<C extends keyof EventContract>(channel: C, payload: EventContract[C]): void;
}

export const MOCK_RULES: FolderRule[] = [
  { folder: 'Insurance/Car', description: 'Everything about my car insurance, including contract, invoices and claims' },
  { folder: 'Health/Health insurance', description: 'Letters from my health insurer' },
  { folder: 'Unsorted', description: 'Fallback when nothing matches' },
];

const MOCK_FOLDER_SETUP: FolderSetup = {
  status: 'icloud',
  inboxPath: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Filey/Inbox',
  targetPath: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Filey',
};

const SETTINGS: Settings = {
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
  inboxPath: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Documents',
  targetPath: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Filed',
  namingTemplate: '{category}/{date}_{sender}_{title}.pdf',
  autostart: true,
  debugLogging: false,
  onboardingCompleted: true,
};

/**
 * A mock `window.filey` with in-memory data. Settings, rules and the key status are kept and change
 * like in the app (without its validation); unused methods resolve with harmless values.
 */
export function createMockFiley({
  history = [],
  inbox = [],
  state,
  inboxPath,
  settings: settingsOverrides,
  rules: initialRules = MOCK_RULES,
  apiKeyStatus,
  connection = { ok: true, message: 'Connected · model can read PDFs' },
  chosenFolder = null,
  rejectUpdate,
  rejectRules,
  folderSetup = MOCK_FOLDER_SETUP,
  saveApiKey = () => ({ ok: true }),
}: MockFileyOptions = {}): MockFiley {
  const appState: AppState = state ?? {
    mode: 'running',
    queuedCount: inbox.filter((row) => row.status === 'pending').length,
    analyzingId: inbox.find((row) => row.working)?.id ?? null,
    attentionCount: inbox.filter((row) => row.status !== 'pending').length,
  };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const on = (channel: string) => (listener: (payload: never) => void) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    listeners.set(channel, set);
    return () => {
      set.delete(listener as (payload: unknown) => void);
    };
  };
  const emit = <C extends keyof EventContract>(channel: C, payload: EventContract[C]) =>
    listeners.get(channel)?.forEach((listener) => listener(payload));
  let settings: Settings = { ...SETTINGS, ...(inboxPath ? { inboxPath } : {}), ...settingsOverrides };
  let rules = initialRules;
  let keyStatus: ApiKeyStatus = apiKeyStatus ?? (appState.mode === 'paused' ? appState.reason : 'set');

  const api: FileyApi = {
    app: {
      getVersion: async () => '1.0.0 (mock)',
      quit: async () => undefined,
      openSettings: async () => undefined,
      openLogs: async () => ({ ok: true }),
      getLoginItem: async () => true,
      setLoginItem: async (enabled) => enabled,
      completeOnboarding: async () => settings,
      getFolderSetup: async () => folderSetup,
    },
    settings: {
      get: async () => settings,
      update: async (patch) => {
        const error = rejectUpdate?.(patch, settings);
        if (error) return { ok: false, error };
        settings = { ...settings, ...patch };
        emit('settings:changed', settings);
        return { ok: true, settings };
      },
      listRules: async () => rules,
      saveRules: async (r) => {
        const error = rejectRules?.(r);
        if (error) return { ok: false, error };
        rules = r;
        return { ok: true, rules };
      },
      onChanged: on('settings:changed'),
    },
    apiKey: {
      status: async () => keyStatus,
      save: async (key) => {
        const result = saveApiKey(key);
        if (result.ok) keyStatus = 'set';
        return result;
      },
      clear: async () => {
        keyStatus = 'missing';
      },
    },
    connection: { test: async () => connection },
    inbox: {
      list: async () => inbox,
      retry: async () => 'started',
      moveToTrash: async () => ({ ok: true }),
      revealInFinder: async () => ({ ok: true }),
      openFolder: async () => ({ ok: true }),
      onChanged: on('inbox:changed'),
    },
    history: {
      list: async ({ limit }) => history.slice(0, limit),
      revealInFinder: async () => ({ ok: true }),
      onChanged: on('history:changed'),
    },
    state: { get: async () => appState, onChanged: on('state:changed') },
    dialogs: { chooseFolder: async () => chosenFolder },
    popover: { hide: async () => undefined, setHeight: async () => undefined },
  };

  return { api, emit };
}

/** Installs a mock as `window.filey` (for tests). */
export function installMockFiley(options?: MockFileyOptions): void {
  window.filey = createMockFiley(options).api;
}
