import { describe, expect, it } from 'vitest';
import type { ICloudDownloader, Logger } from '../ports';
import { createICloudPrepare, ensureDownloaded, type EnsureDownloadedDeps, type FileStat, type ICloudFiles } from './index';
import { placeholderToRealPath, realToPlaceholderPath } from './placeholder';

const REAL = '/inbox/scan.pdf';
const HOLDER = '/inbox/.scan.pdf.icloud';

/** Fake disk + virtual clock: `sleep` advances time and runs scheduled events. */
function setup(opts: { downloader?: ICloudDownloader; readHead?: ICloudFiles['readHead'] } = {}) {
  let t = 1_000_000;
  const disk = new Map<string, FileStat>();
  const events: { at: number; run: () => void }[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  const logger: Logger = { log: (l, m) => logs.push(`${l}: ${m}`) };
  const deps: EnsureDownloadedDeps = {
    files: {
      stat: (p) => Promise.resolve(disk.get(p)),
      readHead:
        opts.readHead ??
        ((p) => {
          calls.push(`read ${p}`);
          return Promise.resolve();
        }),
    },
    downloader: opts.downloader ?? {
      requestDownload: (p) => {
        calls.push(`download ${p}`);
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date(t) },
    sleep: (ms) => {
      t += ms;
      for (const e of events.filter((x) => x.at <= t)) e.run();
      return Promise.resolve();
    },
    logger,
  };
  const at = (msFromNow: number, run: () => void) => events.push({ at: t + msFromNow, run });
  return { deps, disk, at, logs, calls };
}

describe('placeholder paths', () => {
  it('maps placeholders to real paths and back', () => {
    expect(placeholderToRealPath(HOLDER)).toBe(REAL);
    expect(placeholderToRealPath('/inbox/.Scan.PDF.icloud')).toBe('/inbox/Scan.PDF');
    expect(realToPlaceholderPath(REAL)).toBe(HOLDER);
  });
  it('does not treat other files as placeholders', () => {
    for (const p of [REAL, '/inbox/.scan.pdf', '/inbox/scan.pdf.icloud', '/inbox/.note.txt.icloud', '/inbox/.DS_Store']) {
      expect(placeholderToRealPath(p), p).toBeUndefined();
    }
  });
});

describe('ensureDownloaded', () => {
  it('requests the download once for a placeholder and resolves ready after the file appears and is stable', async () => {
    const { deps, disk, at, calls } = setup();
    disk.set(HOLDER, { size: 100, mtimeMs: 1 });
    at(5000, () => {
      disk.delete(HOLDER);
      disk.set(REAL, { size: 10, mtimeMs: 2 });
    });
    await expect(ensureDownloaded(REAL, deps)).resolves.toBe('ready');
    expect(calls).toEqual([`download ${REAL}`]);
    expect(disk.has(REAL)).toBe(true);
  });

  it('waits while the size is still changing', async () => {
    const { deps, disk, at } = setup();
    disk.set(REAL, { size: 1, mtimeMs: 1 });
    for (const [ms, size] of [[1500, 2], [3000, 3]] as const) at(ms, () => disk.set(REAL, { size, mtimeMs: ms }));
    const start = deps.clock.now().getTime();
    await ensureDownloaded(REAL, deps);
    expect(deps.clock.now().getTime() - start).toBeGreaterThanOrEqual(3000 + 2000);
  });

  it('does not request a download for a plain file', async () => {
    const { deps, disk, calls } = setup();
    disk.set(REAL, { size: 1, mtimeMs: 1 });
    await expect(ensureDownloaded(REAL, deps)).resolves.toBe('ready');
    expect(calls).toEqual([]);
  });

  it('resolves timeout when the download never completes and leaves the placeholder untouched', async () => {
    const { deps, disk, logs } = setup();
    disk.set(HOLDER, { size: 100, mtimeMs: 1 });
    await expect(ensureDownloaded(REAL, deps, { timeoutMs: 10_000 })).resolves.toBe('timeout');
    expect([...disk.keys()]).toEqual([HOLDER]);
    expect(logs.some((l) => l.startsWith('warn:') && l.includes('left untouched'))).toBe(true);
  });

  it('resolves gone when neither file nor placeholder exists, also while waiting', async () => {
    const a = setup();
    await expect(ensureDownloaded(REAL, a.deps)).resolves.toBe('gone');
    const b = setup();
    b.disk.set(HOLDER, { size: 1, mtimeMs: 1 });
    b.at(3000, () => b.disk.delete(HOLDER));
    await expect(ensureDownloaded(REAL, b.deps)).resolves.toBe('gone');
  });

  it('falls back to a read when brctl fails, and keeps waiting', async () => {
    const { deps, disk, at, calls, logs } = setup({ downloader: { requestDownload: () => Promise.reject(new Error('brctl: not found')) } });
    disk.set(HOLDER, { size: 1, mtimeMs: 1 });
    at(2000, () => {
      disk.delete(HOLDER);
      disk.set(REAL, { size: 5, mtimeMs: 1 });
    });
    await expect(ensureDownloaded(REAL, deps)).resolves.toBe('ready');
    expect(calls).toEqual([`read ${REAL}`]);
    expect(logs.some((l) => l.includes('brctl download failed'))).toBe(true);
  });

  it('survives a failing read fallback', async () => {
    const { deps, disk, logs } = setup({
      downloader: { requestDownload: () => Promise.reject(new Error('x')) },
      readHead: () => Promise.reject(new Error('EIO')),
    });
    disk.set(HOLDER, { size: 1, mtimeMs: 1 });
    await expect(ensureDownloaded(REAL, deps, { timeoutMs: 3000 })).resolves.toBe('timeout');
    expect(logs.some((l) => l.includes('read fallback failed'))).toBe(true);
  });
});

describe('createICloudPrepare', () => {
  it('passes non-placeholder files through without touching the disk', async () => {
    const { deps, calls } = setup();
    await createICloudPrepare(deps)(REAL, { viaPlaceholder: false });
    await createICloudPrepare(deps)(REAL);
    expect(calls).toEqual([]);
  });
  it('resolves for a downloaded placeholder and rejects on timeout or gone', async () => {
    const ok = setup();
    ok.disk.set(REAL, { size: 1, mtimeMs: 1 });
    await expect(createICloudPrepare(ok.deps)(REAL, { viaPlaceholder: true })).resolves.toBeUndefined();
    const slow = setup();
    slow.disk.set(HOLDER, { size: 1, mtimeMs: 1 });
    await expect(createICloudPrepare(slow.deps, { timeoutMs: 2000 })(REAL, { viaPlaceholder: true })).rejects.toThrow('"timeout"');
    await expect(createICloudPrepare(setup().deps)(REAL, { viaPlaceholder: true })).rejects.toThrow('"gone"');
    await expect(createICloudPrepare(setup().deps)(REAL, { viaPlaceholder: true })).rejects.toMatchObject({
      name: 'ICloudDownloadError',
      result: 'gone',
      path: REAL,
    });
  });
});
