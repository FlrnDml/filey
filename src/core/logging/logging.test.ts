import { describe, expect, it } from 'vitest';
import type { LogFileSystem, Logger, LogLevel } from '../ports';
import {
  createAppLogger,
  createLogFile,
  formatLogLine,
  isLevelEnabled,
  logFilePaths,
  MAX_MESSAGE_LENGTH,
  MAX_PENDING_LINES,
  REDACTED,
  sanitizeLogMessage,
  syncDebugLogging,
} from './index';

const FAKE_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';

/** In-memory log folder; `append` resolves on a later tick, like the real disk. */
class FakeLogFs implements LogFileSystem {
  files = new Map<string, string>();
  dirs = new Set<string>();
  calls: string[] = [];
  failAppend: Error | undefined;
  inFlight = 0;
  maxInFlight = 0;
  async append(p: string, text: string) {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await Promise.resolve();
    this.inFlight--;
    if (this.failAppend) throw this.failAppend;
    this.calls.push(`append ${p}`);
    this.files.set(p, (this.files.get(p) ?? '') + text);
  }
  async size(p: string) {
    return Buffer.byteLength(this.files.get(p) ?? '');
  }
  async rename(from: string, to: string) {
    const content = this.files.get(from);
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    this.calls.push(`rename ${from} -> ${to}`);
    this.files.set(to, content);
    this.files.delete(from);
  }
  async mkdir(p: string) {
    this.dirs.add(p);
  }
}

const DIR = '/Users/me/Library/Logs/Filey';
const [CURRENT, FIRST, SECOND] = logFilePaths(DIR) as [string, string, string];
const clock = { now: () => new Date('2026-10-15T10:00:00.000Z') };

class MemorySink implements Logger {
  lines: Array<[LogLevel, string]> = [];
  log(level: LogLevel, line: string) {
    this.lines.push([level, line]);
  }
}

describe('format', () => {
  it('formats one line with an ISO time and a padded level', () => {
    expect(formatLogLine(clock.now(), 'info', 'Import: filed a.pdf')).toBe('2026-10-15T10:00:00.000Z INFO  Import: filed a.pdf');
    expect(formatLogLine(clock.now(), 'error', 'x')).toBe('2026-10-15T10:00:00.000Z ERROR x');
  });

  it('drops debug unless debug logging is on', () => {
    expect(isLevelEnabled('debug', false)).toBe(false);
    expect(isLevelEnabled('info', false)).toBe(true);
    expect(isLevelEnabled('debug', true)).toBe(true);
    expect(isLevelEnabled('error', true)).toBe(true);
  });

  it('redacts API keys and bearer tokens', () => {
    const text = sanitizeLogMessage(`key ${FAKE_KEY} failed; header Authorization: Bearer ${FAKE_KEY}abc`);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('0123456789abcdef');
    expect(text).toBe(`key ${REDACTED} failed; header Authorization: Bearer ${REDACTED}`);
  });

  it('keeps a message on one line and limits its length', () => {
    expect(sanitizeLogMessage('a.pdf\n2026-01-01T00:00:00.000Z ERROR forged')).toBe('a.pdf 2026-01-01T00:00:00.000Z ERROR forged');
    const long = sanitizeLogMessage('x'.repeat(MAX_MESSAGE_LENGTH + 500));
    expect(long.length).toBeLessThan(MAX_MESSAGE_LENGTH + 20);
    expect(long.endsWith('(truncated)')).toBe(true);
  });
});

describe('createAppLogger', () => {
  it('sends the same formatted, redacted line to every sink', () => {
    const a = new MemorySink();
    const b = new MemorySink();
    createAppLogger({ clock, sinks: [a, b] }).log('warn', `Saving ${FAKE_KEY} failed`);
    expect(a.lines).toEqual([['warn', `2026-10-15T10:00:00.000Z WARN  Saving ${REDACTED} failed`]]);
    expect(b.lines).toEqual(a.lines);
  });

  it('toggles the debug level live', () => {
    const sink = new MemorySink();
    const logger = createAppLogger({ clock, sinks: [sink] });
    logger.log('debug', 'hidden');
    logger.setDebug(true);
    expect(logger.isDebug()).toBe(true);
    logger.log('debug', 'shown');
    logger.setDebug(false);
    logger.log('debug', 'hidden again');
    logger.log('info', 'always');
    expect(sink.lines.map(([, line]) => line.slice(25))).toEqual(['DEBUG shown', 'INFO  always']);
  });

  it('follows the debug logging setting and notes each change once', () => {
    const sink = new MemorySink();
    const logger = createAppLogger({ clock, sinks: [sink] });
    syncDebugLogging(logger, { debugLogging: false });
    expect(sink.lines).toHaveLength(0);
    syncDebugLogging(logger, { debugLogging: true });
    syncDebugLogging(logger, { debugLogging: true });
    logger.log('debug', 'detail');
    syncDebugLogging(logger, { debugLogging: false });
    logger.log('debug', 'hidden');
    expect(sink.lines.map(([, line]) => line.slice(25))).toEqual(['INFO  Log: debug logging on', 'DEBUG detail', 'INFO  Log: debug logging off']);
  });

  it('keeps logging when one sink throws', () => {
    const sink = new MemorySink();
    const broken: Logger = {
      log: () => {
        throw new Error('broken');
      },
    };
    expect(() => createAppLogger({ clock, sinks: [broken, sink] }).log('info', 'still here')).not.toThrow();
    expect(sink.lines).toHaveLength(1);
  });
});

describe('createLogFile', () => {
  it('names the current file and the rotated ones', () => {
    expect(logFilePaths(DIR)).toEqual([`${DIR}/filey.log`, `${DIR}/filey.1.log`, `${DIR}/filey.2.log`]);
  });

  it('queues lines without blocking and writes them in order, one batch at a time', async () => {
    const fs = new FakeLogFs();
    const file = createLogFile({ fs, dir: DIR });
    for (let i = 0; i < 5; i++) file.log('info', `line ${i}`);
    expect(fs.files.size).toBe(0); // nothing written synchronously
    await file.flush();
    expect(fs.dirs.has(DIR)).toBe(true);
    expect(fs.files.get(CURRENT)).toBe('line 0\nline 1\nline 2\nline 3\nline 4\n');
    expect(fs.maxInFlight).toBe(1);
    expect(file.path).toBe(CURRENT);
  });

  it('rotates before the file would exceed the limit and keeps at most three files', async () => {
    const fs = new FakeLogFs();
    const file = createLogFile({ fs, dir: DIR, maxBytes: 20 });
    const write = async (line: string) => {
      file.log('info', line);
      await file.flush();
    };
    await write('aaaaaaaaa'); // 10 bytes
    await write('bbbbbbbbb'); // 20 bytes: still fits
    expect(fs.files.get(CURRENT)).toBe('aaaaaaaaa\nbbbbbbbbb\n');
    await write('ccccccccc'); // would be 30: rotate first
    expect(fs.files.get(FIRST)).toBe('aaaaaaaaa\nbbbbbbbbb\n');
    expect(fs.files.get(CURRENT)).toBe('ccccccccc\n');
    await write('ddddddddd');
    await write('eeeeeeeee'); // rotate again: 1 -> 2, current -> 1
    expect(fs.files.get(SECOND)).toBe('aaaaaaaaa\nbbbbbbbbb\n');
    expect(fs.files.get(FIRST)).toBe('ccccccccc\nddddddddd\n');
    expect(fs.files.get(CURRENT)).toBe('eeeeeeeee\n');
    await write('fffffffff');
    await write('ggggggggg'); // the oldest file is replaced, never a fourth one
    expect([...fs.files.keys()].sort()).toEqual([CURRENT, FIRST, SECOND].sort());
    expect(fs.files.get(SECOND)).toBe('ccccccccc\nddddddddd\n');
  });

  it('continues an existing file and rotates it on start when it is already full', async () => {
    const fs = new FakeLogFs();
    fs.files.set(CURRENT, 'x'.repeat(30));
    const file = createLogFile({ fs, dir: DIR, maxBytes: 20 });
    file.log('info', 'new');
    await file.flush();
    expect(fs.files.get(FIRST)).toBe('x'.repeat(30));
    expect(fs.files.get(CURRENT)).toBe('new\n');
  });

  it('reports a failed write and keeps going', async () => {
    const fs = new FakeLogFs();
    const errors: unknown[] = [];
    const file = createLogFile({ fs, dir: DIR, onError: (e) => errors.push(e) });
    fs.failAppend = new Error('disk full');
    file.log('info', 'lost');
    await file.flush();
    expect(errors).toHaveLength(1);
    fs.failAppend = undefined;
    file.log('info', 'kept');
    await file.flush();
    expect(fs.files.get(CURRENT)).toBe('kept\n');
  });

  it('drops the oldest lines when the queue overflows and says so', async () => {
    const fs = new FakeLogFs();
    const file = createLogFile({ fs, dir: DIR });
    // The first line starts the background write; everything after waits in the queue.
    for (let i = 0; i < MAX_PENDING_LINES + 11; i++) file.log('info', `l${i}`);
    await file.flush();
    const lines = fs.files.get(CURRENT)!.trimEnd().split('\n');
    expect(lines[0]).toBe('l0');
    expect(lines[1]).toMatch(/WARN {2}Log: 10 lines dropped/);
    expect(lines[2]).toBe('l11');
    expect(lines.at(-1)).toBe(`l${MAX_PENDING_LINES + 10}`);
  });

  it('never writes an API key to disk', async () => {
    const fs = new FakeLogFs();
    const file = createLogFile({ fs, dir: DIR });
    const logger = createAppLogger({ clock, sinks: [file], debug: true });
    // What could reach the logger by mistake: a key inside an error text or a request header.
    logger.log('error', `OpenRouter rejected ${FAKE_KEY}`);
    logger.log('debug', `Authorization: Bearer ${FAKE_KEY}`);
    logger.log('info', `Import: filed scan.pdf (3fa9c2d1e0b4)`);
    await file.flush();
    const written = [...fs.files.values()].join('');
    expect(written).not.toContain(FAKE_KEY);
    expect(written).not.toContain('0123456789abcdef');
    expect(written).toContain('Import: filed scan.pdf (3fa9c2d1e0b4)');
  });
});
