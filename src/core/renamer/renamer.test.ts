import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyzeResult } from '../analyzer';
import type { ScanResult, ScanService } from '../scanner';
import type { FolderRule, Settings } from '../settings';
import { createNameMatcher, createRenamer, fileNameTemplate, RENAME_MESSAGES, type RenamerDeps } from '.';

describe('createNameMatcher', () => {
  const matches = createNameMatcher('{category}/{date}_{sender}_{title}.pdf');

  it.each([
    ['2026-10-15_Northwind_Invoice.pdf', true],
    ['2026-10-15_Northwind_Invoice_2.pdf', true],
    ['2026-10-15_Unknown_Untitled.PDF', true],
    ['2026-10-15_Northwind_Contract renewal.pdf', true],
    ['2026-10-15_Northwind Health Insurance_Invoice.pdf', false],
    ['Scan_2026-10-15.pdf', false],
    ['2026-10_Northwind_Invoice.pdf', false],
    ['2026-10-15_Northwind.pdf', false],
    ['invoice.pdf', false],
  ])('%s -> %s', (name, expected) => {
    expect(matches(name)).toBe(expected);
  });

  it('uses only the file-name part of the template and escapes its literal text', () => {
    expect(fileNameTemplate('{category}/Archive/{date} {title}.pdf')).toBe('{date} {title}.pdf');
    const custom = createNameMatcher('{date} ({sender}) {title}.pdf');
    expect(custom('2026-01-02 (Contoso) Bill.pdf')).toBe(true);
    expect(custom('2026-01-02 Contoso Bill.pdf')).toBe(false);
  });
});

const ROOT = '/target';
const INFO = { date: '2026-10-15', sender: 'Northwind', title: 'Invoice', category: 'Unsorted' };

function setup({ files = ['Health/Scan 12.pdf', 'Health/2026-01-01_Contoso_Bill.pdf', 'notes.txt', 'loose.pdf'], placeholders = [] as string[] } = {}) {
  const settings: Settings = {
    provider: 'openrouter',
    model: 'test/model',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5vl:7b',
    inboxPath: '/target/Inbox',
    targetPath: ROOT,
    namingTemplate: '{category}/{date}_{sender}_{title}.pdf',
    autostart: false,
    debugLogging: false,
    onboardingCompleted: true,
  };
  const rules: FolderRule[] = [{ folder: 'Unsorted', description: 'Fallback' }];
  const disk = new Set(files.filter((f) => !placeholders.includes(f)).map((f) => path.join(ROOT, f)));
  const scan: ScanResult = {
    root: ROOT,
    folders: [{ path: 'Health', fileCount: 2, sampleFileNames: [] }],
    files: files.map((f) => ({ path: f, placeholder: placeholders.includes(f) })),
    truncated: false,
    scannedAt: '2026-11-17T10:00:00.000Z',
  };
  let last: ScanResult | undefined;
  const scans: ScanService = {
    run: vi.fn(async () => {
      last = scan;
      return { ok: true as const, scan };
    }),
    last: () => last,
  };
  const env = { next: { ok: true, info: INFO } as AnalyzeResult, keyStatus: 'ok' as 'ok' | 'missing' };
  const deps: RenamerDeps = {
    scans,
    settings: { getSettings: () => settings, listRules: () => rules },
    apiKeys: { get: async () => (env.keyStatus === 'ok' ? { status: 'ok', value: 'sk-or-key' } : { status: 'missing' }) },
    analyze: vi.fn(async () => env.next),
    fs: {
      exists: async (p) => disk.has(p),
      readFile: async (p) => {
        if (!disk.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return new TextEncoder().encode('%PDF');
      },
      rename: vi.fn(async (from: string, to: string) => {
        disk.delete(from);
        disk.add(to);
      }),
    },
    download: vi.fn(async (p: string) => {
      disk.add(p);
      return 'ready' as const;
    }),
    onRenamed: vi.fn(),
    clock: { now: () => new Date(2026, 10, 17, 12) },
    logger: { log: () => undefined },
  };
  return { renamer: createRenamer(deps), deps, disk, env, settings };
}

describe('createRenamer', () => {
  it('scans again and lists the PDFs that do not follow the template', async () => {
    const t = setup();
    await expect(t.renamer.check()).resolves.toEqual({
      ok: true,
      checked: 3,
      truncated: false,
      issues: [
        { path: 'Health/Scan 12.pdf', name: 'Scan 12.pdf', folder: 'Health', placeholder: false },
        { path: 'loose.pdf', name: 'loose.pdf', folder: '', placeholder: false },
      ],
    });
    expect(t.deps.scans.run).toHaveBeenCalledOnce();
    expect(t.deps.analyze).not.toHaveBeenCalled();
  });

  it('proposes names that keep the folder and renames only after apply', async () => {
    const t = setup();
    await t.renamer.check();
    const outcome = await t.renamer.suggest(['Health/Scan 12.pdf']);
    expect(outcome).toEqual({
      ok: true,
      suggestions: [{ path: 'Health/Scan 12.pdf', name: 'Scan 12.pdf', status: 'proposed', newName: '2026-10-15_Northwind_Invoice.pdf' }],
    });
    expect(t.deps.analyze).toHaveBeenCalledWith(expect.any(Buffer), { config: { provider: 'openrouter', apiKey: 'sk-or-key', model: 'test/model' }, rules: [{ folder: 'Unsorted', description: 'Fallback' }] });
    expect(t.deps.fs.rename).not.toHaveBeenCalled();

    await expect(t.renamer.apply(['Health/Scan 12.pdf'])).resolves.toEqual([
      { path: 'Health/Scan 12.pdf', ok: true, newName: '2026-10-15_Northwind_Invoice.pdf', newPath: 'Health/2026-10-15_Northwind_Invoice.pdf' },
    ]);
    expect(t.deps.fs.rename).toHaveBeenCalledWith('/target/Health/Scan 12.pdf', '/target/Health/2026-10-15_Northwind_Invoice.pdf');
    expect(t.deps.onRenamed).toHaveBeenCalledWith('/target/Health/Scan 12.pdf', '/target/Health/2026-10-15_Northwind_Invoice.pdf');
    // The proposal is used up.
    await expect(t.renamer.apply(['Health/Scan 12.pdf'])).resolves.toEqual([{ path: 'Health/Scan 12.pdf', ok: false, message: RENAME_MESSAGES.noProposal }]);
  });

  it('never overwrites: a taken name gets _2', async () => {
    const t = setup();
    t.disk.add('/target/Health/2026-10-15_Northwind_Invoice.pdf');
    await t.renamer.check();
    await t.renamer.suggest(['Health/Scan 12.pdf']);
    const [result] = await t.renamer.apply(['Health/Scan 12.pdf']);
    expect(result).toMatchObject({ ok: true, newName: '2026-10-15_Northwind_Invoice_2.pdf' });
  });

  it('downloads iCloud placeholders before reading them', async () => {
    const t = setup({ placeholders: ['loose.pdf'] });
    await t.renamer.check();
    await t.renamer.suggest(['loose.pdf']);
    expect(t.deps.download).toHaveBeenCalledWith('/target/loose.pdf');
  });

  it('reports failures per file and stops sending when the provider is offline', async () => {
    const t = setup();
    await t.renamer.check();
    t.env.next = { ok: false, failure: { kind: 'offline', message: 'OpenRouter cannot be reached' } };
    const outcome = await t.renamer.suggest(['Health/Scan 12.pdf', 'loose.pdf', '../outside.pdf']);
    expect(outcome).toEqual({
      ok: true,
      suggestions: [
        { path: 'Health/Scan 12.pdf', name: 'Scan 12.pdf', status: 'failed', message: 'OpenRouter cannot be reached' },
        { path: 'loose.pdf', name: 'loose.pdf', status: 'failed', message: 'OpenRouter cannot be reached' },
        { path: '../outside.pdf', name: 'outside.pdf', status: 'failed', message: 'OpenRouter cannot be reached' },
      ],
    });
    expect(t.deps.analyze).toHaveBeenCalledOnce();
  });

  it('refuses files that were not found by the check', async () => {
    const t = setup();
    await t.renamer.check();
    const outcome = await t.renamer.suggest(['../outside.pdf', 'notes.txt']);
    expect(outcome).toMatchObject({ ok: true, suggestions: [{ status: 'failed', message: RENAME_MESSAGES.notScanned }, { status: 'failed', message: RENAME_MESSAGES.notScanned }] });
    expect(t.deps.analyze).not.toHaveBeenCalled();
  });

  it('says when the same name comes back, and asks for a check or a key first', async () => {
    const t = setup();
    await expect(t.renamer.suggest(['loose.pdf'])).resolves.toEqual({ ok: false, reason: 'no-scan', message: RENAME_MESSAGES.noScan });
    await t.renamer.check();
    t.env.keyStatus = 'missing';
    await expect(t.renamer.suggest(['loose.pdf'])).resolves.toMatchObject({ ok: false, reason: 'missing-key' });
    t.env.keyStatus = 'ok';
    t.env.next = { ok: true, info: { date: '2026-01-01', sender: 'Contoso', title: 'Bill', category: 'Unsorted' } };
    await expect(t.renamer.suggest(['Health/2026-01-01_Contoso_Bill.pdf'])).resolves.toMatchObject({ ok: true, suggestions: [{ status: 'unchanged' }] });
  });

  it('does not rename a file that disappeared since the suggestion', async () => {
    const t = setup();
    await t.renamer.check();
    await t.renamer.suggest(['loose.pdf']);
    t.disk.delete('/target/loose.pdf');
    await expect(t.renamer.apply(['loose.pdf'])).resolves.toEqual([{ path: 'loose.pdf', ok: false, message: RENAME_MESSAGES.missing }]);
    expect(t.deps.fs.rename).not.toHaveBeenCalled();
  });

  it('uses the selected provider: Ollama without a key', async () => {
    const t = setup();
    t.settings.provider = 'ollama';
    t.env.keyStatus = 'missing';
    await t.renamer.check();
    await t.renamer.suggest(['loose.pdf']);
    expect(t.deps.analyze).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ config: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5vl:7b' } }));
  });
});
