import { describe, expect, it } from 'vitest';
import { buildFolderTree, countUnmapped, createScanService, defaultDescription, proposeRules, scanFolder, upsertRules, type DirEntry, type ScanFileSystem } from '.';

const clock = { now: () => new Date('2026-11-17T10:00:00.000Z') };

/** A fake file system from a list of paths below `/t`; a trailing `/` marks a folder, `@` a symbolic link. */
function fakeFs(paths: string[], { unreadable = [] as string[] } = {}): ScanFileSystem & { calls: string[] } {
  const tree = new Map<string, DirEntry[]>();
  const add = (dir: string, entry: DirEntry) => {
    const list = tree.get(dir) ?? [];
    if (!list.some((e) => e.name === entry.name)) list.push(entry);
    tree.set(dir, list);
  };
  tree.set('/t', []);
  for (const raw of paths) {
    const isDir = raw.endsWith('/');
    const isLink = raw.startsWith('@');
    const parts = raw.replace(/^@/, '').replace(/\/$/, '').split('/');
    let dir = '/t';
    parts.forEach((name, i) => {
      const last = i === parts.length - 1;
      const kind = last ? (isLink ? 'other' : isDir ? 'directory' : 'file') : 'directory';
      add(dir, { name, kind });
      dir = `${dir}/${name}`;
      if (kind === 'directory' && !tree.has(dir)) tree.set(dir, []);
    });
  }
  const calls: string[] = [];
  return {
    calls,
    list: async (dir) => {
      calls.push(dir);
      if (unreadable.includes(dir)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      const entries = tree.get(dir);
      if (!entries) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return entries;
    },
  };
}

describe('scanFolder', () => {
  it('lists folders with file counts and sample names, and every file', async () => {
    const fs = fakeFs(['Health/Health insurance/b.pdf', 'Health/Health insurance/a.pdf', 'Health/Doctor/', 'Taxes/2025.pdf', 'loose.pdf']);
    const result = await scanFolder('/t', { fs, clock });
    expect(result).toEqual({
      root: '/t',
      folders: [
        { path: 'Health', fileCount: 0, sampleFileNames: [] },
        { path: 'Health/Doctor', fileCount: 0, sampleFileNames: [] },
        { path: 'Health/Health insurance', fileCount: 2, sampleFileNames: ['a.pdf', 'b.pdf'] },
        { path: 'Taxes', fileCount: 1, sampleFileNames: ['2025.pdf'] },
      ],
      files: [
        { path: 'Health/Health insurance/a.pdf', placeholder: false },
        { path: 'Health/Health insurance/b.pdf', placeholder: false },
        { path: 'Taxes/2025.pdf', placeholder: false },
        { path: 'loose.pdf', placeholder: false },
      ],
      truncated: false,
      scannedAt: '2026-11-17T10:00:00.000Z',
    });
  });

  it('skips the inbox, hidden entries and links, and lists iCloud placeholders under their real name', async () => {
    const fs = fakeFs(['Inbox/new.pdf', '.git/config', 'Taxes/.DS_Store', 'Taxes/.2024.pdf.icloud', 'Taxes/.2025.pdf.icloud', 'Taxes/2025.pdf', '@Link']);
    const result = await scanFolder('/t', { fs, clock }, { inboxPath: '/t/inbox' });
    expect(result.folders).toEqual([{ path: 'Taxes', fileCount: 2, sampleFileNames: ['2024.pdf', '2025.pdf'] }]);
    expect(result.files).toEqual([
      { path: 'Taxes/2024.pdf', placeholder: true },
      { path: 'Taxes/2025.pdf', placeholder: false },
    ]);
    expect(fs.calls).not.toContain('/t/Inbox');
  });

  it('keeps at most five sample names and NFC-normalizes names', async () => {
    const fs = fakeFs(['A/1.pdf', 'A/2.pdf', 'A/3.pdf', 'A/4.pdf', 'A/5.pdf', 'A/6.pdf', 'Ärzte'.normalize('NFD') + '/x.pdf']);
    const result = await scanFolder('/t', { fs, clock });
    expect(result.folders[0]).toEqual({ path: 'A', fileCount: 6, sampleFileNames: ['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf'] });
    expect(result.folders[1]?.path).toBe('Ärzte'.normalize('NFC'));
  });

  it('stops at the depth limit and says so', async () => {
    const fs = fakeFs(['a/b/c/d.pdf']);
    const result = await scanFolder('/t', { fs, clock }, { maxDepth: 2 });
    expect(result.folders.map((f) => f.path)).toEqual(['a', 'a/b']);
    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it('stops at the entry limit, keeps found folders and says so', async () => {
    const fs = fakeFs(['A/1.pdf', 'B/2.pdf', 'C/3.pdf']);
    const result = await scanFolder('/t', { fs, clock }, { maxEntries: 4 });
    expect(result.truncated).toBe(true);
    expect(result.folders.map((f) => f.path)).toEqual(['A', 'B', 'C']);
    expect(result.files.map((f) => f.path)).toEqual(['A/1.pdf']);
  });

  it('leaves out unreadable subfolders and rejects for an unreadable target folder', async () => {
    const fs = fakeFs(['A/1.pdf', 'B/2.pdf'], { unreadable: ['/t/A'] });
    const result = await scanFolder('/t', { fs, clock });
    expect(result.folders.map((f) => f.path)).toEqual(['B']);
    await expect(scanFolder('/missing', { fs, clock })).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createScanService', () => {
  const logger = { log: () => undefined };

  it('keeps the last scan for the current target folder only', async () => {
    const current = { targetPath: '/t', inboxPath: '/inbox' };
    const service = createScanService({ fs: fakeFs(['A/1.pdf']), settings: { getSettings: () => current }, clock, logger });
    expect(service.last()).toBeUndefined();
    const outcome = await service.run();
    expect(outcome).toMatchObject({ ok: true, scan: { folders: [{ path: 'A' }] } });
    expect(service.last()?.root).toBe('/t');
    current.targetPath = '/other';
    expect(service.last()).toBeUndefined();
  });

  it('answers a missing target folder with a message', async () => {
    const service = createScanService({ fs: fakeFs([]), settings: { getSettings: () => ({ targetPath: '/gone', inboxPath: '/i' }) }, clock, logger });
    await expect(service.run()).resolves.toEqual({ ok: false, reason: 'missing', message: expect.stringContaining('does not exist') });
  });

  it('runs one scan at a time', async () => {
    const fs = fakeFs(['A/1.pdf']);
    const service = createScanService({ fs, settings: { getSettings: () => ({ targetPath: '/t', inboxPath: '/i' }) }, clock, logger });
    const [a, b] = await Promise.all([service.run(), service.run()]);
    expect(a).toBe(b);
    expect(fs.calls.filter((c) => c === '/t')).toHaveLength(1);
  });
});

describe('buildFolderTree', () => {
  const folders = [
    { path: 'Health', fileCount: 0, sampleFileNames: [] },
    { path: 'Health/Health insurance', fileCount: 2, sampleFileNames: [] },
    { path: 'Taxes', fileCount: 1, sampleFileNames: [] },
  ];

  it('marks folders with a rule, without a rule, and rules without a folder', () => {
    const tree = buildFolderTree(folders, [
      { folder: 'health/health insurance', description: 'Letters from my insurer' },
      { folder: 'Insurance/Car', description: 'Car' },
      { folder: 'Unsorted', description: 'Fallback' },
    ]);
    expect(tree.map((n) => [n.name, n.exists, n.rule?.description])).toEqual([
      ['Health', true, undefined],
      ['Insurance', false, undefined],
      ['Taxes', true, undefined],
      ['Unsorted', false, 'Fallback'],
    ]);
    expect(tree[0]?.children[0]).toMatchObject({ path: 'Health/Health insurance', exists: true, fileCount: 2, rule: { description: 'Letters from my insurer' } });
    expect(tree[1]?.children[0]).toMatchObject({ path: 'Insurance/Car', exists: false, rule: { folder: 'Insurance/Car' } });
    expect(countUnmapped(tree)).toBe(2);
  });
});

describe('Map folders', () => {
  it('derives a description from the folder name', () => {
    expect(defaultDescription('Taxes')).toBe('Documents about Taxes');
    expect(defaultDescription('Health/Health insurance')).toBe('Documents about Health insurance (Health)');
  });

  it('proposes rules for folders without one and preselects folders with files', () => {
    const proposals = proposeRules(
      [
        { path: 'Health', fileCount: 0, sampleFileNames: [] },
        { path: 'Health/Health insurance', fileCount: 2, sampleFileNames: [] },
        { path: 'Taxes', fileCount: 1, sampleFileNames: [] },
        { path: 'Unsorted', fileCount: 3, sampleFileNames: [] },
        { path: `${'x'.repeat(300)}`, fileCount: 1, sampleFileNames: [] },
      ],
      [{ folder: 'taxes', description: 'Tax' }],
    );
    expect(proposals).toEqual([
      { folder: 'Health', description: 'Documents about Health', fileCount: 0, selected: false },
      { folder: 'Health/Health insurance', description: 'Documents about Health insurance (Health)', fileCount: 2, selected: true },
    ]);
  });

  it('adds new rules above Unsorted and updates existing ones', () => {
    const rules = [
      { folder: 'Taxes', description: 'Tax' },
      { folder: 'Unsorted', description: 'Fallback' },
    ];
    expect(
      upsertRules(rules, [
        { folder: 'Health', description: 'Health' },
        { folder: 'TAXES', description: 'Tax letters' },
      ]),
    ).toEqual([
      { folder: 'Taxes', description: 'Tax letters' },
      { folder: 'Health', description: 'Health' },
      { folder: 'Unsorted', description: 'Fallback' },
    ]);
    expect(rules[0]?.description).toBe('Tax');
  });
});
