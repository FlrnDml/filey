import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../ports';
import { isCandidatePdf } from './filter';
import { createWatcher, type SourceFactory, type SourceOptions, type WatcherSource } from './watcher';

class FakeSource implements WatcherSource {
  handlers: Record<string, (arg: never) => void> = {};
  closed = false;
  constructor(
    readonly inbox: string,
    readonly options: SourceOptions,
  ) {}
  on(event: string, listener: (arg: never) => void) {
    this.handlers[event] = listener;
    return this;
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  emit(event: string, arg: unknown) {
    this.handlers[event]?.(arg as never);
  }
}

function setup(extra: Partial<Parameters<typeof createWatcher>[0]> = {}) {
  const sources: FakeSource[] = [];
  const createSource: SourceFactory = (inbox, options) => {
    const s = new FakeSource(inbox, options);
    sources.push(s);
    return s;
  };
  const logs: string[] = [];
  const logger: Logger = {
    log: (level, message) => logs.push(`${level}: ${message}`),
  };
  const files: string[] = [];
  const watcher = createWatcher({
    inboxPath: '/inbox',
    onFile: (p) => void files.push(p),
    logger,
    createSource,
    ...extra,
  });
  return { watcher, sources, logs, files };
}

function src(list: FakeSource[], i: number): FakeSource {
  const s = list[i];
  if (!s) throw new Error(`no source ${i}`);
  return s;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('isCandidatePdf', () => {
  it('accepts PDFs case-insensitively', () => {
    expect(isCandidatePdf('/inbox/a.pdf')).toBe(true);
    expect(isCandidatePdf('/inbox/A.PDF')).toBe(true);
  });
  it('rejects non-PDF, hidden, temp and placeholder files', () => {
    for (const p of [
      '/inbox/a.txt',
      '/inbox/.DS_Store',
      '/inbox/.a.pdf',
      '/inbox/.a.pdf.icloud',
      '/inbox/a.pdf.icloud',
      '/inbox/~$a.pdf',
      '/inbox/a.pdf~',
      '/inbox/pdf',
    ]) {
      expect(isCandidatePdf(p), p).toBe(false);
    }
  });
});

describe('createWatcher with a fake source', () => {
  it('configures polling, stability check and depth 0, and picks up existing files', async () => {
    const { watcher, sources, files } = setup();
    watcher.start();
    const o = src(sources, 0).options;
    expect(o).toMatchObject({
      usePolling: true,
      depth: 0,
      ignoreInitial: false,
    });
    expect(o.awaitWriteFinish.stabilityThreshold).toBeGreaterThan(0);
    expect(o.ignored('/inbox/.DS_Store')).toBe(true);
    expect(o.ignored('/inbox/a.pdf')).toBe(false);
    expect(o.ignored('/inbox')).toBe(false);
    src(sources, 0).emit('add', '/inbox/a.pdf');
    await flush();
    expect(files).toEqual(['/inbox/a.pdf']);
  });

  it('ignores files that are not candidates', async () => {
    const { watcher, sources, files } = setup();
    watcher.start();
    for (const p of ['/inbox/a.txt', '/inbox/.x.pdf.icloud', '/inbox/.DS_Store']) src(sources, 0).emit('add', p);
    await flush();
    expect(files).toEqual([]);
  });

  describe('iCloud placeholders', () => {
    const prepared: [string, boolean][] = [];
    const prepare = (p: string, info: { viaPlaceholder: boolean }) => {
      prepared.push([p, info.viaPlaceholder]);
      return Promise.resolve();
    };

    it('lets placeholders through the ignore filter only when prepare is set', () => {
      const a = setup();
      a.watcher.start();
      expect(src(a.sources, 0).options.ignored('/inbox/.x.pdf.icloud')).toBe(true);
      const b = setup({ prepare });
      b.watcher.start();
      expect(src(b.sources, 0).options.ignored('/inbox/.x.pdf.icloud')).toBe(false);
      expect(src(b.sources, 0).options.ignored('/inbox/.DS_Store')).toBe(true);
    });

    it('emits the real path once for a placeholder and not again when the real file appears', async () => {
      prepared.length = 0;
      const { watcher, sources, files } = setup({ prepare });
      watcher.start();
      const s = src(sources, 0);
      s.emit('add', '/inbox/.x.pdf.icloud');
      s.emit('add', '/inbox/.x.pdf.icloud');
      await flush();
      s.emit('unlink', '/inbox/.x.pdf.icloud');
      s.emit('add', '/inbox/x.pdf');
      await flush();
      expect(files).toEqual(['/inbox/x.pdf']);
      expect(prepared).toEqual([['/inbox/x.pdf', true]]);
      // Once the filed PDF has left the inbox, a new file with the same name is a new appearance.
      s.emit('unlink', '/inbox/x.pdf');
      s.emit('add', '/inbox/x.pdf');
      await flush();
      expect(files).toEqual(['/inbox/x.pdf', '/inbox/x.pdf']);
    });

    it('emits once when the real file appears while the placeholder is still being handled', async () => {
      let release = () => {};
      const { watcher, sources, files } = setup({
        prepare: () => new Promise<void>((r) => (release = r)),
      });
      watcher.start();
      const s = src(sources, 0);
      s.emit('add', '/inbox/.x.pdf.icloud');
      s.emit('add', '/inbox/x.pdf');
      release();
      await flush();
      expect(files).toEqual(['/inbox/x.pdf']);
    });

    it('does not drop a queued placeholder file on the placeholder unlink, and skips it when prepare rejects', async () => {
      let release = () => {};
      const calls: string[] = [];
      const { watcher, sources, files, logs } = setup({
        prepare: (p) => {
          calls.push(p);
          return p === '/inbox/a.pdf' ? new Promise<void>((r) => (release = r)) : Promise.reject(new Error('timed out'));
        },
      });
      watcher.start();
      const s = src(sources, 0);
      s.emit('add', '/inbox/a.pdf');
      s.emit('add', '/inbox/.b.pdf.icloud');
      s.emit('unlink', '/inbox/.b.pdf.icloud');
      release();
      await flush();
      expect(calls).toEqual(['/inbox/a.pdf', '/inbox/b.pdf']);
      expect(files).toEqual(['/inbox/a.pdf']);
      expect(logs.some((l) => l.startsWith('error:') && l.includes('/inbox/b.pdf') && l.includes('timed out'))).toBe(true);
    });

    it('passes viaPlaceholder false for ordinary files', async () => {
      prepared.length = 0;
      const { watcher, sources } = setup({ prepare });
      watcher.start();
      src(sources, 0).emit('add', '/inbox/a.pdf');
      await flush();
      expect(prepared).toEqual([['/inbox/a.pdf', false]]);
    });
  });

  it('emits a path once while queued or running, and again after it disappeared and returned', async () => {
    const { watcher, sources, files } = setup();
    watcher.start();
    src(sources, 0).emit('add', '/inbox/a.pdf');
    src(sources, 0).emit('add', '/inbox/a.pdf');
    await flush();
    expect(files).toEqual(['/inbox/a.pdf']);
    src(sources, 0).emit('add', '/inbox/a.pdf');
    await flush();
    expect(files).toEqual(['/inbox/a.pdf', '/inbox/a.pdf']);
  });

  it('runs imports one at a time, in order', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const events: string[] = [];
    const { watcher, sources } = setup({
      onFile: async (p) => {
        events.push(`start ${p}`);
        if (p.endsWith('a.pdf')) await gate;
        events.push(`end ${p}`);
      },
    });
    watcher.start();
    src(sources, 0).emit('add', '/inbox/a.pdf');
    src(sources, 0).emit('add', '/inbox/b.pdf');
    await flush();
    expect(events).toEqual(['start /inbox/a.pdf']);
    release();
    await flush();
    expect(events).toEqual(['start /inbox/a.pdf', 'end /inbox/a.pdf', 'start /inbox/b.pdf', 'end /inbox/b.pdf']);
  });

  it('drops a queued file that disappears before it is processed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    const { watcher, sources } = setup({
      onFile: async (p) => {
        seen.push(p);
        await gate;
      },
    });
    watcher.start();
    src(sources, 0).emit('add', '/inbox/a.pdf');
    src(sources, 0).emit('add', '/inbox/b.pdf');
    src(sources, 0).emit('unlink', '/inbox/b.pdf');
    release();
    await flush();
    expect(seen).toEqual(['/inbox/a.pdf']);
  });

  it('calls prepare before onFile and skips the file if prepare fails', async () => {
    const order: string[] = [];
    const { watcher, sources, logs } = setup({
      prepare: async (p) => {
        order.push(`prepare ${p}`);
        if (p.endsWith('bad.pdf')) throw new Error('download failed');
      },
      onFile: (p) => void order.push(`file ${p}`),
    });
    watcher.start();
    src(sources, 0).emit('add', '/inbox/bad.pdf');
    src(sources, 0).emit('add', '/inbox/ok.pdf');
    await flush();
    expect(order).toEqual(['prepare /inbox/bad.pdf', 'prepare /inbox/ok.pdf', 'file /inbox/ok.pdf']);
    expect(logs.some((l) => l.startsWith('error:') && l.includes('download failed'))).toBe(true);
  });

  it('logs onFile and watcher errors instead of throwing, and keeps going', async () => {
    const seen: string[] = [];
    const { watcher, sources, logs } = setup({
      onFile: (p) => {
        seen.push(p);
        if (p.endsWith('a.pdf')) throw new Error('boom');
      },
    });
    watcher.start();
    src(sources, 0).emit('add', '/inbox/a.pdf');
    src(sources, 0).emit('add', '/inbox/b.pdf');
    src(sources, 0).emit('error', new Error('EPERM'));
    await flush();
    expect(seen).toEqual(['/inbox/a.pdf', '/inbox/b.pdf']);
    expect(logs.filter((l) => l.startsWith('error:'))).toHaveLength(2);
  });

  it('logs instead of throwing if the source cannot be created', () => {
    const logs: string[] = [];
    const watcher = createWatcher({
      inboxPath: '/inbox',
      onFile: () => undefined,
      logger: { log: (l, m) => logs.push(`${l}: ${m}`) },
      createSource: () => {
        throw new Error('nope');
      },
    });
    expect(() => watcher.start()).not.toThrow();
    expect(logs[0]).toContain('nope');
  });

  it('start is idempotent; stop closes the source and ignores late events', async () => {
    const { watcher, sources, files } = setup();
    watcher.start();
    watcher.start();
    expect(sources).toHaveLength(1);
    watcher.stop();
    expect(src(sources, 0).closed).toBe(true);
    src(sources, 0).emit('add', '/inbox/late.pdf');
    await flush();
    expect(files).toEqual([]);
    expect(() => watcher.stop()).not.toThrow();
  });

  it('reports a removed candidate PDF, but not other files or a stopped watcher', async () => {
    const removed: string[] = [];
    const { watcher, sources } = setup({
      onRemove: (p) => void removed.push(p),
    });
    watcher.start();
    const s = src(sources, 0);
    s.emit('unlink', '/inbox/a.pdf');
    s.emit('unlink', '/inbox/note.txt');
    s.emit('unlink', '/inbox/.DS_Store');
    expect(removed).toEqual(['/inbox/a.pdf']);
    watcher.stop();
    s.emit('unlink', '/inbox/b.pdf');
    expect(removed).toEqual(['/inbox/a.pdf']);
  });

  it('does not report a placeholder that vanishes because its download completed as a removal', async () => {
    const removed: string[] = [];
    const { watcher, sources } = setup({
      prepare: async () => undefined,
      onRemove: (p) => void removed.push(p),
    });
    watcher.start();
    const s = src(sources, 0);
    s.emit('add', '/inbox/.x.pdf.icloud');
    await flush();
    s.emit('unlink', '/inbox/.x.pdf.icloud');
    s.emit('add', '/inbox/x.pdf');
    await flush();
    expect(removed).toEqual([]);
    s.emit('unlink', '/inbox/x.pdf');
    expect(removed).toEqual(['/inbox/x.pdf']);
  });

  it('reports the PDFs of the initial scan once on ready, with placeholders mapped to their real path', async () => {
    const ready: string[][] = [];
    const { watcher, sources } = setup({
      prepare: async () => undefined,
      onReady: (paths) => void ready.push(paths),
    });
    watcher.start();
    const s = src(sources, 0);
    s.emit('add', '/inbox/a.pdf');
    s.emit('add', '/inbox/.b.pdf.icloud');
    s.emit('add', '/inbox/note.txt');
    s.emit('add', '/inbox/gone.pdf');
    s.emit('unlink', '/inbox/gone.pdf');
    s.emit('ready', undefined);
    expect(ready).toEqual([['/inbox/a.pdf', '/inbox/b.pdf']]);
    watcher.restart('/other');
    src(sources, 0).emit('ready', undefined); // old source: ignored
    src(sources, 1).emit('add', '/other/c.pdf');
    src(sources, 1).emit('ready', undefined);
    expect(ready).toEqual([['/inbox/a.pdf', '/inbox/b.pdf'], ['/other/c.pdf']]);
  });

  it('logs an onRemove/onReady error instead of throwing', () => {
    const { watcher, sources, logs } = setup({
      onRemove: () => {
        throw new Error('boom');
      },
    });
    watcher.start();
    src(sources, 0).emit('unlink', '/inbox/a.pdf');
    expect(logs.some((l) => l.includes('onRemove failed: boom'))).toBe(true);
  });

  it('restart watches the new inbox and discards the old one', async () => {
    const { watcher, sources, files } = setup();
    watcher.start();
    watcher.restart('/other');
    expect(src(sources, 0).closed).toBe(true);
    expect(src(sources, 1).inbox).toBe('/other');
    src(sources, 0).emit('add', '/inbox/old.pdf');
    src(sources, 1).emit('add', '/other/new.pdf');
    await flush();
    expect(files).toEqual(['/other/new.pdf']);
  });
});

describe('createWatcher with real chokidar', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('emits existing and new PDFs once, ignoring subfolders and other files', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filey-watcher-'));
    const inbox = dir;
    await fs.writeFile(path.join(inbox, 'existing.pdf'), 'x');
    await fs.mkdir(path.join(inbox, 'sub'));
    await fs.writeFile(path.join(inbox, 'sub', 'nested.pdf'), 'x');

    const files: string[] = [];
    const ready: string[][] = [];
    const watcher = createWatcher({
      inboxPath: inbox,
      onFile: (p) => void files.push(path.basename(p)),
      onReady: (paths) => void ready.push(paths.map((p) => path.basename(p))),
      logger: { log: () => undefined },
      pollInterval: 30,
      stabilityThreshold: 100,
    });
    watcher.start();
    try {
      await fs.writeFile(path.join(inbox, 'new.PDF'), 'x');
      await fs.writeFile(path.join(inbox, 'note.txt'), 'x');
      await fs.writeFile(path.join(inbox, '.hidden.pdf'), 'x');
      await vi.waitFor(() => expect([...files].sort()).toEqual(['existing.pdf', 'new.PDF']), { timeout: 5000, interval: 50 });
      expect(ready.length).toBe(1);
      expect(ready[0]).toContain('existing.pdf');
      // Give polling a few more rounds to prove nothing is emitted twice or from subfolders.
      await new Promise((r) => setTimeout(r, 400));
      expect([...files].sort()).toEqual(['existing.pdf', 'new.PDF']);
    } finally {
      watcher.stop();
    }
  });
});
