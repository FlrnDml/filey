import { describe, expect, it, vi } from 'vitest';
import type { ImportState } from '../core/import';
import type { NotificationTarget } from '../core/ports';
import {
  connectKeyPrompt,
  createNotificationClickHandler,
  shouldOpenOnboarding,
  startApp,
  type RunningServices,
  type StartupDeps,
} from './lifecycle';
import type { AppTray } from './tray';

const silent = { log: () => undefined };

describe('startApp', () => {
  const setup = (services: Partial<RunningServices> | Error, onboardingCompleted = false) => {
    const order: string[] = [];
    const tray: AppTray = { apply: vi.fn(), anchor: () => ({ x: 0, y: 0, width: 0, height: 0 }), destroy: vi.fn() };
    const running: RunningServices = {
      getSettings: () => ({ onboardingCompleted }),
      attachTray: vi.fn(() => void order.push('attachTray')),
      ...(services instanceof Error ? {} : services),
    };
    let resolveStart!: () => void;
    const deps: StartupDeps = {
      startServices: vi.fn(
        () =>
          new Promise<RunningServices>((resolve, reject) => {
            resolveStart = () => {
              order.push('services');
              if (services instanceof Error) reject(services);
              else resolve(running);
            };
          }),
      ),
      createTray: vi.fn(() => {
        order.push('tray');
        return tray;
      }),
      openOnboarding: vi.fn(() => void order.push('onboarding')),
      logger: silent,
    };
    return { deps, tray, order, finishStart: () => resolveStart() };
  };

  it('creates the tray only after the services are ready, then opens onboarding on first launch', async () => {
    const t = setup({}, false);
    const started = startApp(t.deps);
    await Promise.resolve();
    // A tray click before this point would find no IPC handlers: there is no tray yet.
    expect(t.deps.createTray).not.toHaveBeenCalled();
    t.finishStart();
    await started;
    expect(t.order).toEqual(['services', 'tray', 'attachTray', 'onboarding']);
  });

  it('shows only the tray once onboarding is completed', async () => {
    const t = setup({}, true);
    const started = startApp(t.deps);
    t.finishStart();
    await expect(started).resolves.toMatchObject({ tray: t.tray });
    expect(t.order).toEqual(['services', 'tray', 'attachTray']);
    expect(t.deps.openOnboarding).not.toHaveBeenCalled();
  });

  it('still creates the tray, marked "Could not start", when the services fail, and skips onboarding', async () => {
    const t = setup(new Error('database locked'));
    const started = startApp(t.deps);
    t.finishStart();
    const result = await started;
    expect(result.services).toBeUndefined();
    expect(t.tray.apply).toHaveBeenCalledWith({ icon: 'attention', tooltip: 'Filey · Could not start' });
    expect(t.deps.openOnboarding).not.toHaveBeenCalled();
  });

  it('decides about onboarding from the stored flag', () => {
    expect(shouldOpenOnboarding({ onboardingCompleted: false })).toBe(true);
    expect(shouldOpenOnboarding({ onboardingCompleted: true })).toBe(false);
  });
});

describe('connectKeyPrompt', () => {
  const setup = (initial: ImportState, onboardingCompleted = true) => {
    let state = initial;
    const listeners = new Set<(s: ImportState) => void>();
    const openSettings = vi.fn();
    const stop = connectKeyPrompt({
      imports: {
        getState: () => state,
        onStateChange: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      isOnboardingCompleted: () => onboardingCompleted,
      openSettings,
      logger: silent,
    });
    const set = (next: ImportState) => {
      state = next;
      listeners.forEach((l) => l(next));
    };
    return { openSettings, set, stop, listeners };
  };
  const UNREADABLE: ImportState = { mode: 'paused', reason: 'unreadable' };

  it('opens Settings on the Provider tab when the key is unreadable at start', () => {
    const t = setup(UNREADABLE);
    expect(t.openSettings).toHaveBeenCalledExactlyOnceWith('provider');
  });

  it('opens it once, not again on every paused import', () => {
    const t = setup({ mode: 'running' });
    expect(t.openSettings).not.toHaveBeenCalled();
    t.set(UNREADABLE);
    t.set(UNREADABLE);
    t.set(UNREADABLE);
    expect(t.openSettings).toHaveBeenCalledOnce();
  });

  it('asks again after the key worked in between', () => {
    const t = setup(UNREADABLE);
    t.set({ mode: 'running' });
    t.set(UNREADABLE);
    expect(t.openSettings).toHaveBeenCalledTimes(2);
  });

  it('leaves a missing key to the popover and the first launch to onboarding', () => {
    setup({ mode: 'paused', reason: 'missing' });
    const t = setup(UNREADABLE, false);
    expect(t.openSettings).not.toHaveBeenCalled();
  });

  it('stops listening', () => {
    const t = setup({ mode: 'running' });
    t.stop();
    expect(t.listeners.size).toBe(0);
  });
});

describe('createNotificationClickHandler', () => {
  const TARGET = '/Users/me/iCloud/Filey';
  const setup = (existing: string[] = []) => {
    const deps = {
      getTargetPath: () => TARGET,
      exists: vi.fn(async (p: string) => existing.includes(p)),
      showItemInFolder: vi.fn(),
      showInbox: vi.fn(),
      logger: silent,
    };
    return { deps, click: createNotificationClickHandler(deps) };
  };
  const reveal = (path: string): NotificationTarget => ({ kind: 'reveal', path });

  it('reveals a filed document in Finder', async () => {
    const file = `${TARGET}/Health/2026-10-15_Northwind_Invoice.pdf`;
    const t = setup([file]);
    await t.click(reveal(file));
    expect(t.deps.showItemInFolder).toHaveBeenCalledExactlyOnceWith(file);
    expect(t.deps.showInbox).not.toHaveBeenCalled();
  });

  it('opens the popover for an error notification', async () => {
    const t = setup();
    await t.click({ kind: 'inbox' });
    expect(t.deps.showInbox).toHaveBeenCalledOnce();
    expect(t.deps.showItemInFolder).not.toHaveBeenCalled();
  });

  it.each([
    ['outside the target folder', '/etc/passwd'],
    ['escaping it with ..', `${TARGET}/../secrets.pdf`],
    ['the target folder itself', TARGET],
    ['a relative path', 'Health/a.pdf'],
  ])('never reveals a path %s; shows the inbox instead', async (_name, file) => {
    const t = setup([file, '/etc/passwd']);
    await t.click(reveal(file));
    expect(t.deps.showItemInFolder).not.toHaveBeenCalled();
    expect(t.deps.showInbox).toHaveBeenCalledOnce();
  });

  it('shows the inbox when the filed document was moved away since', async () => {
    const t = setup();
    await t.click(reveal(`${TARGET}/Health/gone.pdf`));
    expect(t.deps.showItemInFolder).not.toHaveBeenCalled();
    expect(t.deps.showInbox).toHaveBeenCalledOnce();
  });
});
