import { describe, expect, it, vi } from 'vitest';
import type { FolderSample } from '../../core/analyzer';
import { IPC_CHANNELS } from '../../core/ipc';
import type { Renamer } from '../../core/renamer';
import type { ScanResult, ScanService } from '../../core/scanner';
import type { Settings } from '../../core/settings';
import { createFolderHandlers, FOLDER_MESSAGES, type FolderHandlerDeps } from './folder-handlers';
import { registerFake } from './testing';

const SCAN: ScanResult = {
  root: '/target',
  folders: [
    { path: 'Health', fileCount: 1, sampleFileNames: ['a.pdf'] },
    { path: 'Taxes', fileCount: 0, sampleFileNames: [] },
  ],
  files: [{ path: 'Health/a.pdf', placeholder: false }],
  truncated: false,
  scannedAt: '2026-11-17T10:00:00.000Z',
};

function setup({ provider = 'openrouter' as Settings['provider'], key = 'ok' as 'ok' | 'missing' } = {}) {
  let last: ScanResult | undefined;
  const scans: ScanService = {
    run: vi.fn(async () => {
      last = SCAN;
      return { ok: true as const, scan: SCAN };
    }),
    last: () => last,
  };
  const renamer: Renamer = {
    check: vi.fn(async () => ({ ok: true as const, issues: [], checked: 0, truncated: false })),
    suggest: vi.fn(async () => ({ ok: true as const, suggestions: [] })),
    apply: vi.fn(async () => []),
  };
  const deps: FolderHandlerDeps = {
    scans,
    renamer,
    settings: { getSettings: () => ({ provider, model: 'm', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5vl:7b' }) as Settings },
    apiKeys: { get: async () => (key === 'ok' ? { status: 'ok', value: 'sk-or-secret' } : { status: 'missing' }) },
    describeFolders: vi.fn(async (folders: readonly FolderSample[]) => ({ ok: true as const, rules: folders.map((f) => ({ folder: f.folder, description: `About ${f.folder}` })) })),
    logger: { log: () => undefined },
  };
  return { ...registerFake(createFolderHandlers(deps)), deps };
}

describe('folder handlers', () => {
  it('scans and returns the folders without absolute paths or file lists', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.folders.lastScan)).resolves.toBeNull();
    const result = await t.ipcMain.invoke(IPC_CHANNELS.folders.scan);
    expect(result).toEqual({ ok: true, scan: { folders: SCAN.folders, fileCount: 1, truncated: false, scannedAt: SCAN.scannedAt } });
    expect(JSON.stringify(result)).not.toContain('/target');
    await expect(t.ipcMain.invoke(IPC_CHANNELS.folders.lastScan)).resolves.toMatchObject({ fileCount: 1 });
  });

  it('describes only scanned folders, with sample names from the scan', async () => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.folders.suggestDescriptions, ['Health'])).resolves.toEqual({ ok: false, reason: 'no-scan', message: FOLDER_MESSAGES.noScan });
    await t.ipcMain.invoke(IPC_CHANNELS.folders.scan);
    const result = await t.ipcMain.invoke(IPC_CHANNELS.folders.suggestDescriptions, ['Health', 'Unknown', 'Health']);
    expect(result).toEqual({ ok: true, rules: [{ folder: 'Health', description: 'About Health' }] });
    expect(t.deps.describeFolders).toHaveBeenCalledExactlyOnceWith([{ folder: 'Health', sampleFileNames: ['a.pdf'] }], {
      provider: 'openrouter',
      apiKey: 'sk-or-secret',
      model: 'm',
    });
  });

  it('asks for the key first and passes failures on', async () => {
    const t = setup({ key: 'missing' });
    await t.ipcMain.invoke(IPC_CHANNELS.folders.scan);
    await expect(t.ipcMain.invoke(IPC_CHANNELS.folders.suggestDescriptions, ['Health'])).resolves.toMatchObject({ ok: false, reason: 'missing-key' });
    expect(t.deps.describeFolders).not.toHaveBeenCalled();

    const ollama = setup({ provider: 'ollama', key: 'missing' });
    await ollama.ipcMain.invoke(IPC_CHANNELS.folders.scan);
    vi.mocked(ollama.deps.describeFolders).mockResolvedValueOnce({ ok: false, failure: { kind: 'offline', message: 'Ollama cannot be reached' } });
    await expect(ollama.ipcMain.invoke(IPC_CHANNELS.folders.suggestDescriptions, ['Health'])).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'Ollama cannot be reached',
    });
  });

  it('forwards the rename queue calls', async () => {
    const t = setup();
    await t.ipcMain.invoke(IPC_CHANNELS.names.check);
    await t.ipcMain.invoke(IPC_CHANNELS.names.suggest, ['Health/a.pdf']);
    await t.ipcMain.invoke(IPC_CHANNELS.names.apply, ['Health/a.pdf']);
    expect(t.deps.renamer.check).toHaveBeenCalledOnce();
    expect(t.deps.renamer.suggest).toHaveBeenCalledWith(['Health/a.pdf']);
    expect(t.deps.renamer.apply).toHaveBeenCalledWith(['Health/a.pdf']);
  });

  it.each([
    ['an absolute path', ['/etc/passwd']],
    ['a parent folder', ['../a.pdf']],
    ['a dot part', ['Health/./a.pdf']],
    ['a backslash', ['Health\\a.pdf']],
    ['an empty part', ['Health//a.pdf']],
    ['a non-string', [1]],
    ['too many files', Array.from({ length: 21 }, (_, i) => `${i}.pdf`)],
  ])('rejects %s', async (_name, list) => {
    const t = setup();
    await expect(t.ipcMain.invoke(IPC_CHANNELS.names.suggest, list)).rejects.toThrow(/Invalid arguments/);
    expect(t.deps.renamer.suggest).not.toHaveBeenCalled();
  });
});
