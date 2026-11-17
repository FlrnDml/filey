import { describe, expect, it, vi } from 'vitest';
import { createPageRenderer, type RenderChannel } from './page-renderer';

const OPTIONS = { maxPages: 3, maxEdgePx: 1024 };
const PAGE = new Uint8Array([1, 2, 3]);

function setup(render: RenderChannel['render'] = async () => [PAGE]) {
  const channels: { render: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const renderer = createPageRenderer({
    open: () => {
      const channel = { render: vi.fn(render), close: vi.fn() };
      channels.push(channel);
      return channel;
    },
    idleMs: 60_000,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => void ((timer as { cleared: boolean }).cleared = true),
  });
  return { renderer, channels, timers };
}

describe('page renderer', () => {
  it('opens the window on first use, not before', async () => {
    const t = setup();
    expect(t.channels).toHaveLength(0);
    await expect(t.renderer.render(new Uint8Array([9]), OPTIONS)).resolves.toEqual([PAGE]);
    expect(t.channels).toHaveLength(1);
    expect(t.channels[0]!.render).toHaveBeenCalledWith(new Uint8Array([9]), OPTIONS);
  });

  it('reuses the window while it is in use and restarts the idle timer after each render', async () => {
    const t = setup();
    await t.renderer.render(PAGE, OPTIONS);
    await t.renderer.render(PAGE, OPTIONS);
    expect(t.channels).toHaveLength(1);
    expect(t.timers.map((x) => [x.ms, x.cleared])).toEqual([
      [60_000, true],
      [60_000, false],
    ]);
  });

  it('closes the window after the idle time and opens a new one for the next document', async () => {
    const t = setup();
    await t.renderer.render(PAGE, OPTIONS);
    t.timers.at(-1)!.fn();
    expect(t.channels[0]!.close).toHaveBeenCalledOnce();
    await t.renderer.render(PAGE, OPTIONS);
    expect(t.channels).toHaveLength(2);
  });

  it('renders one document at a time, in order', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const t = setup(
      (pdf) =>
        new Promise((resolve) => {
          order.push(`start ${pdf[0]}`);
          const done = () => {
            order.push(`end ${pdf[0]}`);
            resolve([PAGE]);
          };
          if (pdf[0] === 1) release = done;
          else done();
        }),
    );
    const first = t.renderer.render(new Uint8Array([1]), OPTIONS);
    const second = t.renderer.render(new Uint8Array([2]), OPTIONS);
    await Promise.resolve();
    expect(order).toEqual(['start 1']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('closes a window that failed and does not reuse it', async () => {
    let fail = true;
    const t = setup(async () => {
      if (fail) throw new Error('crashed');
      return [PAGE];
    });
    await expect(t.renderer.render(PAGE, OPTIONS)).rejects.toThrow('crashed');
    expect(t.channels[0]!.close).toHaveBeenCalledOnce();
    expect(t.timers.every((x) => x.cleared || x.ms === 60_000)).toBe(true);
    fail = false;
    await expect(t.renderer.render(PAGE, OPTIONS)).resolves.toEqual([PAGE]);
    expect(t.channels).toHaveLength(2);
  });

  it('keeps working after a failed document (the queue does not stay broken)', async () => {
    const t = setup(async (pdf) => {
      if (pdf[0] === 0) throw new Error('bad pdf');
      return [PAGE];
    });
    const bad = t.renderer.render(new Uint8Array([0]), OPTIONS);
    const good = t.renderer.render(new Uint8Array([1]), OPTIONS);
    await expect(bad).rejects.toThrow('bad pdf');
    await expect(good).resolves.toEqual([PAGE]);
  });

  it('dispose closes the window and the idle timer', async () => {
    const t = setup();
    await t.renderer.render(PAGE, OPTIONS);
    t.renderer.dispose();
    expect(t.channels[0]!.close).toHaveBeenCalledOnce();
    expect(t.timers.at(-1)!.cleared).toBe(true);
    // Disposing again, or with nothing open, is harmless.
    expect(() => t.renderer.dispose()).not.toThrow();
  });
});
