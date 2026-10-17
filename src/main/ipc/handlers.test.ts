import { describe, expect, it, vi } from 'vitest';
import { createApiKeyStore, InMemorySecretStore, type ApiKeyStore } from '../../core/api-key';
import { openMigratedDatabase, type NewProcessedImport } from '../../core/db';
import type { ImportState } from '../../core/import';
import { IPC_CHANNELS, type EventChannel, type InvokeChannel } from '../../core/ipc';
import { createSettingsRepository, defaultRules } from '../../core/settings';
import { createAppHandlers, createOpenLogs, createServiceHandlers, USER_MESSAGES, type ServiceHandlerDeps } from './handlers';
import { registerFake } from './testing';

const API_KEY = 'sk-or-SECRET-KEY-123';

function setup(overrides: Partial<ServiceHandlerDeps> = {}) {
  const store = openMigratedDatabase(':memory:');
  const settings = createSettingsRepository({ settings: store.settings }, { home: '/home/u' });
  settings.updateSettings({ inboxPath: '/inbox', targetPath: '/target' });
  const secrets = new InMemorySecretStore();
  const apiKeys: ApiKeyStore = createApiKeyStore(secrets);
  const now = '2026-10-15T10:00:00.000Z';
  const state: { current: ImportState; queued: number; analyzingId: number | null } = { current: { mode: 'running' }, queued: 0, analyzingId: null };
  const imports = {
    listInbox: () => store.imports.unprocessed.list(),
    getInboxEntry: (id: number) => store.imports.unprocessed.getById(id),
    retry: vi.fn(async () => 'started' as const),
    handleRemoved: vi.fn((filePath: string) => void store.imports.unprocessed.deleteByPath(filePath)),
    listHistory: (limit: number) => store.imports.processed.listRecent(limit),
    getHistoryEntry: (id: number) => store.imports.processed.getById(id),
    getState: () => state.current,
    queuedCount: () => state.queued,
    analyzingId: () => state.analyzingId,
  };
  const existing = new Set<string>();
  const deps: ServiceHandlerDeps = {
    settings,
    apiKeys,
    imports,
    watcher: { restart: vi.fn() },
    testConnection: vi.fn(async () => ({ ok: true as const, message: 'Connected · model can read PDFs' })),
    fs: { exists: async (p) => existing.has(p) },
    shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => ''), trashItem: vi.fn(async () => undefined) },
    chooseFolder: vi.fn(async () => '/Users/u/Picked'),
    setLoginItem: vi.fn(),
    getLoginItem: vi.fn(() => true),
    logger: { log: () => undefined },
    onSettingsChanged: vi.fn(),
    folderSetup: { status: 'icloud', inboxPath: '/inbox', targetPath: '/target' },
    ...overrides,
  };
  const fake = registerFake(createServiceHandlers(deps));
  const addInbox = (fields: Partial<Parameters<typeof store.imports.unprocessed.upsert>[0]> = {}) =>
    store.imports.unprocessed.upsert({ inboxPath: '/inbox/Scan.pdf', fileName: 'Scan.pdf', contentHash: 'h', status: 'failed', error: 'Invalid result', now, ...fields });
  const addFiled = (fields: Partial<NewProcessedImport> = {}) =>
    store.imports.markFiled('/inbox/none.pdf', { contentHash: 'h', originalName: 'Scan.pdf', targetPath: '/target/a.pdf', documentDate: null, sender: null, category: null, title: null, model: null, filedAt: now, ...fields });
  return { ...fake, deps, settings, secrets, apiKeys, store, state, existing, addInbox, addFiled };
}

describe('handler coverage', () => {
  it('handles every invoke channel of the contract exactly once', () => {
    const t = setup();
    const app = registerFake(
      createAppHandlers({ getAppVersion: () => '1', quit: vi.fn(), openSettings: vi.fn(), openLogs: async () => ({ ok: true }), getLoginItem: () => false, hidePopover: vi.fn(), setPopoverHeight: vi.fn() }),
    );
    const eventChannels: EventChannel[] = [IPC_CHANNELS.inbox.changed, IPC_CHANNELS.history.changed, IPC_CHANNELS.state.changed, IPC_CHANNELS.settings.changed];
    const invokeChannels = Object.values(IPC_CHANNELS)
      .flatMap((group) => Object.values(group) as string[])
      .filter((c) => !(eventChannels as string[]).includes(c)) as InvokeChannel[];
    const handled = [...t.ipcMain.listeners.keys(), ...app.ipcMain.listeners.keys()];
    expect(handled.sort()).toEqual([...invokeChannels].sort());
  });
});

describe('settings', () => {
  it('returns the settings and saves a valid patch', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.get)).resolves.toMatchObject({ inboxPath: '/inbox' });
    const result = await t.ipcMain.invoke(IPC_CHANNELS.settings.update, { model: 'openai/gpt-4o', debugLogging: true });
    expect(result).toMatchObject({ ok: true, settings: { model: 'openai/gpt-4o', debugLogging: true } });
    expect(t.settings.getSettings().model).toBe('openai/gpt-4o');
    expect(t.deps.onSettingsChanged).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-4o' }));
    expect(t.deps.watcher.restart).not.toHaveBeenCalled();
  });

  it('restarts the watcher when the inbox changes', async () => {
    const t = setup();
    await t.ipcMain.invoke(IPC_CHANNELS.settings.update, { inboxPath: '/new/inbox/' });
    expect(t.deps.watcher.restart).toHaveBeenCalledExactlyOnceWith('/new/inbox');
    await t.ipcMain.invoke(IPC_CHANNELS.settings.update, { inboxPath: '/new/inbox' });
    expect(t.deps.watcher.restart).toHaveBeenCalledOnce();
  });

  it('answers a validation error with a user-facing message and the field, and stores nothing', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.update, { targetPath: '/inbox' })).resolves.toEqual({
      ok: false,
      error: { message: expect.stringMatching(/must not be the inbox/), field: 'targetPath' },
    });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.update, { model: '' })).resolves.toMatchObject({ ok: false, error: { field: 'model' } });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.update, { namingTemplate: '{year}.pdf' })).resolves.toMatchObject({
      ok: false,
      error: { field: 'namingTemplate' },
    });
    expect(t.settings.getSettings().targetPath).toBe('/target');
    expect(t.deps.watcher.restart).not.toHaveBeenCalled();
    expect(t.deps.onSettingsChanged).not.toHaveBeenCalled();
  });

  it.each([
    ['no patch', []],
    ['a non-object', ['x']],
    ['an array', [[]]],
    ['an unknown key', [{ apiKey: 'x' }]],
    ['a non-editable key', [{ onboardingCompleted: true }]],
    ['a relative path', [{ inboxPath: 'Documents/Inbox' }]],
    ['a wrong type', [{ debugLogging: 'yes' }]],
    ['a too long model', [{ model: 'x'.repeat(201) }]],
    ['a class instance', [new Date()]],
  ])('rejects %s', async (_name, args) => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.update, ...args)).rejects.toThrow(/Invalid arguments/);
  });

  it('lists and saves rules, reporting the offending rule', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.listRules)).resolves.toEqual(defaultRules());
    const rules = [
      { folder: 'Unsorted', description: 'Rest' },
      { folder: 'Tax', description: 'Taxes' },
    ];
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.saveRules, rules)).resolves.toEqual({ ok: true, rules });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.saveRules, [...rules, { folder: '../x', description: 'y' }])).resolves.toMatchObject({
      ok: false,
      error: { field: 'rules', ruleIndex: 2, message: expect.stringMatching(/Invalid folder name/) },
    });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.saveRules, [{ folder: 'Tax', description: 'x' }])).resolves.toMatchObject({
      ok: false,
      error: { field: 'rules', message: expect.stringMatching(/cannot be removed/) },
    });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.saveRules, [{ folder: 'Tax' }])).rejects.toThrow();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.saveRules, [{ folder: 'Tax', description: 'x', extra: 1 }])).rejects.toThrow();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.settings.saveRules, new Array(201).fill(rules[0]))).rejects.toThrow();
  });
});

describe('app settings handlers', () => {
  it('applies and stores start at login', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.app.setLoginItem, true)).resolves.toBe(true);
    expect(t.deps.setLoginItem).toHaveBeenCalledWith(true);
    expect(t.settings.getSettings().autostart).toBe(true);
    await expect(t.ipcMain.invoke(IPC_CHANNELS.app.setLoginItem, 'yes')).rejects.toThrow();
  });

  it('completes onboarding', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.app.completeOnboarding)).resolves.toMatchObject({ onboardingCompleted: true });
    expect(t.settings.getSettings().onboardingCompleted).toBe(true);
    expect(t.deps.onSettingsChanged).toHaveBeenCalled();
  });

  it('tells the renderer how the default folders were set up', async () => {
    const t = setup({ folderSetup: { status: 'failed', inboxPath: '/Users/u/Documents/Filey/Inbox', targetPath: '/Users/u/Documents/Filey' } });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.app.getFolderSetup)).resolves.toEqual({
      status: 'failed',
      inboxPath: '/Users/u/Documents/Filey/Inbox',
      targetPath: '/Users/u/Documents/Filey',
    });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.app.getFolderSetup, 'x')).rejects.toThrow();
  });

  it('tells main to close the first-launch window after saving the flag', async () => {
    let savedWhenClosed: boolean | undefined;
    const t = setup({
      onOnboardingCompleted: vi.fn(() => {
        savedWhenClosed = t.settings.getSettings().onboardingCompleted;
      }),
    });
    await t.ipcMain.invoke(IPC_CHANNELS.app.completeOnboarding);
    expect(t.deps.onOnboardingCompleted).toHaveBeenCalledOnce();
    expect(savedWhenClosed).toBe(true);
  });
});

describe('createOpenLogs', () => {
  const LOG = '/Users/u/Library/Logs/Filey/filey.log';
  const setupLogs = (openPathResult = '') => {
    const calls: string[] = [];
    const logs: string[] = [];
    const open = createOpenLogs({
      logFile: { path: LOG, flush: async () => void calls.push('flush') },
      fs: {
        mkdir: async (p) => void calls.push(`mkdir ${p}`),
        append: async (p, text) => void calls.push(`append ${p} ${JSON.stringify(text)}`),
      },
      openPath: async (p) => {
        calls.push(`open ${p}`);
        return openPathResult;
      },
      logger: { log: (_l, m) => logs.push(m) },
    });
    return { open, calls, logs };
  };

  it('flushes, creates the file if missing (empty append) and opens it', async () => {
    const t = setupLogs();
    await expect(t.open()).resolves.toEqual({ ok: true });
    expect(t.calls).toEqual(['flush', 'mkdir /Users/u/Library/Logs/Filey', `append ${LOG} ""`, `open ${LOG}`]);
  });

  it('answers with a user-facing message when the file cannot be opened', async () => {
    const t = setupLogs('No application knows how to open it');
    await expect(t.open()).resolves.toEqual({ ok: false, reason: 'failed', message: USER_MESSAGES.logsFailed });
    expect(t.logs[0]).toContain('No application knows how to open it');
  });
});

describe('api key', () => {
  it('saves, reports status and clears without ever returning the key', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.apiKey.status)).resolves.toBe('missing');
    const saved = await t.ipcMain.invoke(IPC_CHANNELS.apiKey.save, ` ${API_KEY} `);
    expect(saved).toEqual({ ok: true });
    expect(t.secrets.values.get('openrouter-api-key')).toBe(API_KEY);
    const status = await t.ipcMain.invoke(IPC_CHANNELS.apiKey.status);
    expect(status).toBe('set');
    expect(JSON.stringify([saved, status])).not.toContain(API_KEY);
    await t.ipcMain.invoke(IPC_CHANNELS.apiKey.clear);
    await expect(t.ipcMain.invoke(IPC_CHANNELS.apiKey.status)).resolves.toBe('missing');
  });

  it('answers an empty key and unavailable storage with a typed result', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.apiKey.save, '  ')).resolves.toMatchObject({ ok: false, reason: 'empty' });
    t.secrets.set = async () => {
      throw new Error('no keychain');
    };
    await expect(t.ipcMain.invoke(IPC_CHANNELS.apiKey.save, API_KEY)).resolves.toMatchObject({ ok: false, reason: 'storage-unavailable' });
  });

  it('rejects a non-string or huge key and never logs it', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.apiKey.save, 42)).rejects.toThrow();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.apiKey.save, API_KEY + 'x'.repeat(5000))).rejects.toThrow();
    expect(t.logs.join('\n')).not.toContain(API_KEY);
  });
});

describe('connection test', () => {
  it('passes typed key and model through, and accepts no input', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.connection.test, { key: API_KEY, model: 'a/b' })).resolves.toMatchObject({ ok: true });
    await t.ipcMain.invoke(IPC_CHANNELS.connection.test);
    await t.ipcMain.invoke(IPC_CHANNELS.connection.test, {});
    expect(vi.mocked(t.deps.testConnection).mock.calls).toEqual([[{ key: API_KEY, model: 'a/b' }], [{}], [{}]]);
  });

  it('rejects unexpected input', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.connection.test, { key: 1 })).rejects.toThrow();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.connection.test, { url: 'https://evil' })).rejects.toThrow();
    expect(t.deps.testConnection).not.toHaveBeenCalled();
  });
});

describe('inbox', () => {
  it('lists the inbox rows without the content hash or path', async () => {
    const t = setup();
    const filed = t.addFiled({ targetPath: '/target/Tax/2026-01-01_Office_Notice.pdf', contentHash: 'a' });
    t.addInbox({ inboxPath: '/inbox/A.pdf', fileName: 'A.pdf', status: 'pending', error: null, contentHash: 'b' });
    t.addInbox({ inboxPath: '/inbox/B.pdf', fileName: 'B.pdf', status: 'duplicate', error: null, contentHash: 'a', duplicateOfId: filed.id });
    t.state.analyzingId = 1;
    const rows = (await t.ipcMain.invoke(IPC_CHANNELS.inbox.list)) as { fileName: string }[];
    expect(rows.map((r) => r.fileName)).toEqual(['B.pdf', 'A.pdf']);
    expect(rows[0]).toMatchObject({ status: 'duplicate', duplicateOf: { id: filed.id } });
    expect(rows[1]).toMatchObject({ status: 'pending', working: true });
    for (const row of rows) {
      expect(row).not.toHaveProperty('contentHash');
      expect(row).not.toHaveProperty('inboxPath');
    }
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.list, 1)).rejects.toThrow();
  });

  it('retries by id and validates the id', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.retry, 7)).resolves.toBe('started');
    expect(t.deps.imports.retry).toHaveBeenCalledWith(7);
    for (const bad of ['7', 0, -1, 1.5, Number.NaN, null]) {
      await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.retry, bad)).rejects.toThrow();
    }
  });

  it('moves an inbox file to the Trash and drops its row', async () => {
    const t = setup();
    const row = t.addInbox();
    t.existing.add('/inbox/Scan.pdf');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.moveToTrash, row.id)).resolves.toEqual({ ok: true });
    expect(t.deps.shell.trashItem).toHaveBeenCalledExactlyOnceWith('/inbox/Scan.pdf');
    expect(t.deps.imports.handleRemoved).toHaveBeenCalledExactlyOnceWith('/inbox/Scan.pdf');
    expect(t.store.imports.unprocessed.getById(row.id)).toBeUndefined();
  });

  it('refuses to trash unknown entries, files outside the inbox and missing files', async () => {
    const t = setup();
    const outside = t.addInbox({ inboxPath: '/target/a.pdf', contentHash: 'c' });
    const traversal = t.addInbox({ inboxPath: '/inbox/../etc/passwd', contentHash: 'd' });
    const relative = t.addInbox({ inboxPath: 'inbox/x.pdf', contentHash: 'e' });
    const gone = t.addInbox({ inboxPath: '/inbox/gone.pdf', contentHash: 'f' });
    t.existing.add('/target/a.pdf').add('/etc/passwd');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.moveToTrash, 999)).resolves.toMatchObject({ ok: false, reason: 'not-found' });
    for (const row of [outside, traversal, relative]) {
      await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.moveToTrash, row.id)).resolves.toMatchObject({ ok: false, reason: 'not-allowed' });
    }
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.moveToTrash, gone.id)).resolves.toMatchObject({ ok: false, reason: 'file-missing' });
    expect(t.deps.shell.trashItem).not.toHaveBeenCalled();
  });

  it('keeps the row and reports "failed" if the Trash move fails', async () => {
    const t = setup();
    const row = t.addInbox();
    t.existing.add('/inbox/Scan.pdf');
    vi.mocked(t.deps.shell.trashItem).mockRejectedValueOnce(new Error('denied'));
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.moveToTrash, row.id)).resolves.toMatchObject({ ok: false, reason: 'failed' });
    expect(t.deps.imports.handleRemoved).not.toHaveBeenCalled();
  });

  it('reveals the inbox file, with the same checks', async () => {
    const t = setup();
    const row = t.addInbox();
    const outside = t.addInbox({ inboxPath: '/etc/passwd', contentHash: 'c' });
    t.existing.add('/inbox/Scan.pdf').add('/etc/passwd');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.revealInFinder, row.id)).resolves.toEqual({ ok: true });
    expect(t.deps.shell.showItemInFolder).toHaveBeenCalledExactlyOnceWith('/inbox/Scan.pdf');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.revealInFinder, outside.id)).resolves.toMatchObject({ ok: false, reason: 'not-allowed' });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.revealInFinder, 999)).resolves.toMatchObject({ ok: false, reason: 'not-found' });
    expect(t.deps.shell.showItemInFolder).toHaveBeenCalledOnce();
  });

  it('opens the configured inbox only', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.openFolder)).resolves.toMatchObject({ ok: false, reason: 'missing' });
    t.existing.add('/inbox');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.openFolder)).resolves.toEqual({ ok: true });
    expect(t.deps.shell.openPath).toHaveBeenCalledWith('/inbox');
    vi.mocked(t.deps.shell.openPath).mockResolvedValueOnce('Failed to open');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.openFolder)).resolves.toMatchObject({ ok: false, reason: 'failed' });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.inbox.openFolder, '/etc')).rejects.toThrow();
  });
});

describe('history', () => {
  it('lists rows the UI can render, filtered by a query', async () => {
    const t = setup();
    t.addFiled({ targetPath: '/target/Tax/2026-01-01_Office_Notice.pdf', category: 'Tax', contentHash: 'a', sender: 'Office' });
    t.addFiled({ targetPath: '/target/Other.pdf', originalName: 'Other.pdf', contentHash: 'b' });
    const rows = (await t.ipcMain.invoke(IPC_CHANNELS.history.list, { limit: 10 })) as { originalName: string }[];
    expect(rows.map((r) => r.originalName)).toEqual(['Other.pdf', 'Scan.pdf']);
    expect(rows[1]).toMatchObject({ finalName: '2026-01-01_Office_Notice.pdf', folder: 'Tax' });
    expect(rows[1]).not.toHaveProperty('sender');
    expect(rows[1]).not.toHaveProperty('contentHash');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.history.list, { limit: 10, query: 'notice' })).resolves.toHaveLength(1);
  });

  it.each([[{}], [{ limit: 0 }], [{ limit: 501 }], [{ limit: 1.5 }], [{ limit: 10, query: 3 }], [{ limit: 10, sql: 'x' }]])(
    'rejects the query %o',
    async (query) => {
      const t = setup();
      await expect(t.ipcMain.invoke(IPC_CHANNELS.history.list, query)).rejects.toThrow();
    },
  );

  it('reveals the filed PDF', async () => {
    const t = setup();
    const filed = t.addFiled({ targetPath: '/target/Tax/a.pdf' });
    t.existing.add('/target/Tax/a.pdf');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.history.revealInFinder, filed.id)).resolves.toEqual({ ok: true });
    expect(t.deps.shell.showItemInFolder).toHaveBeenCalledExactlyOnceWith('/target/Tax/a.pdf');
    for (const bad of ['7', 0, -1, 1.5, null]) await expect(t.ipcMain.invoke(IPC_CHANNELS.history.revealInFinder, bad)).rejects.toThrow();
  });

  it('refuses to reveal unknown documents, missing files and paths outside the folders', async () => {
    const t = setup();
    const outside = t.addFiled({ targetPath: '/etc/passwd', contentHash: 'c' });
    const gone = t.addFiled({ targetPath: '/target/gone.pdf', contentHash: 'd' });
    t.existing.add('/etc/passwd');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.history.revealInFinder, 999)).resolves.toEqual({
      ok: false,
      reason: 'not-found',
      message: USER_MESSAGES.importNotFound,
    });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.history.revealInFinder, outside.id)).resolves.toMatchObject({ ok: false, reason: 'not-allowed' });
    await expect(t.ipcMain.invoke(IPC_CHANNELS.history.revealInFinder, gone.id)).resolves.toMatchObject({ ok: false, reason: 'file-missing' });
    expect(t.deps.shell.showItemInFolder).not.toHaveBeenCalled();
  });
});

describe('state', () => {
  it('returns the pipeline state with the queue length', async () => {
    const t = setup();
    t.state.current = { mode: 'paused', reason: 'unreadable' };
    t.state.queued = 2;
    await expect(t.ipcMain.invoke(IPC_CHANNELS.state.get)).resolves.toEqual({ mode: 'paused', reason: 'unreadable', queuedCount: 2, analyzingId: null, attentionCount: 0 });
  });
});

describe('dialogs', () => {
  it('opens the native picker at the current folder and returns its choice', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.dialogs.chooseFolder, 'inbox')).resolves.toBe('/Users/u/Picked');
    await t.ipcMain.invoke(IPC_CHANNELS.dialogs.chooseFolder, 'target');
    expect(vi.mocked(t.deps.chooseFolder).mock.calls).toEqual([
      [{ title: 'Choose the inbox folder', defaultPath: '/inbox' }],
      [{ title: 'Choose the target folder', defaultPath: '/target' }],
    ]);
    expect(t.settings.getSettings().inboxPath).toBe('/inbox'); // choosing does not save
  });

  it('accepts only the two folder kinds, never a path', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.dialogs.chooseFolder, '/etc')).rejects.toThrow();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.dialogs.chooseFolder)).rejects.toThrow();
  });
});
