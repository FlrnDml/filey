import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../core/ipc';
import { createAppHandlers } from './handlers';
import { broadcast, createSenderCheck, type AppWindowLike, type FrameLike, type IpcHandlers } from './register';
import { registerFake } from './testing';

const appDeps = (getAppVersion = vi.fn(() => '1.2.3')) => ({
  getAppVersion,
  quit: vi.fn(),
  openSettings: vi.fn(),
  openLogs: vi.fn(async () => ({ ok: true as const })),
  getLoginItem: () => false,
  hidePopover: vi.fn(),
  setPopoverHeight: vi.fn(),
});

const setup = (handlers: IpcHandlers = createAppHandlers(appDeps())) => registerFake(handlers);

describe('registerIpcHandlers', () => {
  const channel = IPC_CHANNELS.app.getVersion;

  it('registers a handler per channel and answers calls', async () => {
    const { ipcMain } = setup();
    expect([...ipcMain.listeners.keys()]).toContain(channel);
    await expect(ipcMain.invoke(channel)).resolves.toBe('1.2.3');
  });

  it('rejects invalid arguments without calling the handler and logs without the payload', async () => {
    const getAppVersion = vi.fn(() => '1.2.3');
    const { ipcMain, logs } = setup(createAppHandlers(appDeps(getAppVersion)));

    await expect(ipcMain.invoke(channel, 'SECRET-PAYLOAD')).rejects.toThrow(`Invalid arguments for ${channel}`);
    expect(getAppVersion).not.toHaveBeenCalled();
    expect(logs).toEqual([`warn: IPC: rejected ${channel}: Expected no arguments, got 1`]);
  });

  it('rejects calls from untrusted senders before validating', async () => {
    const getAppVersion = vi.fn(() => '1.2.3');
    const { ipcMain, logs } = setup(createAppHandlers(appDeps(getAppVersion)));

    await expect(ipcMain.invokeAs({ senderFrame: null }, channel)).rejects.toThrow(`Rejected ${channel}`);
    expect(getAppVersion).not.toHaveBeenCalled();
    expect(logs).toEqual([`warn: IPC: rejected ${channel}: untrusted sender`]);
  });

  it('does not log messages of unexpected validation errors (they might contain the payload)', async () => {
    const handlers = {
      [channel]: {
        validate: () => {
          throw new Error('payload SECRET');
        },
        handle: () => 'x',
      },
    } as IpcHandlers;
    const { ipcMain, logs } = setup(handlers);
    await expect(ipcMain.invoke(channel)).rejects.toThrow();
    expect(logs.join()).not.toContain('SECRET');
  });

  it('logs handler failures and hides their details from the renderer', async () => {
    const handlers = {
      [channel]: {
        validate: () => [],
        handle: () => {
          throw new Error('/Users/me/secret/path broke');
        },
      },
    } as IpcHandlers;
    const { ipcMain, logs } = setup(handlers);
    const error = await ipcMain.invoke(channel).catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe(`${channel} failed`);
    expect(logs).toEqual([`error: IPC: ${channel} failed: /Users/me/secret/path broke`]);
  });

  it('removes its handlers when the returned function is called', () => {
    const { ipcMain, dispose } = setup();
    dispose();
    expect(ipcMain.listeners.size).toBe(0);
  });

  it('validates the optional settings tab', async () => {
    const deps = appDeps();
    const { ipcMain } = setup(createAppHandlers(deps));
    await ipcMain.invoke(IPC_CHANNELS.app.openSettings);
    await ipcMain.invoke(IPC_CHANNELS.app.openSettings, 'filing');
    await expect(ipcMain.invoke(IPC_CHANNELS.app.openSettings, 'admin')).rejects.toThrow();
    await expect(ipcMain.invoke(IPC_CHANNELS.app.openSettings, 'filing', 'x')).rejects.toThrow();
    expect(deps.openSettings.mock.calls).toEqual([[undefined], ['filing']]);
  });

  it('answers quit, getLoginItem and openLogs', async () => {
    const deps = appDeps();
    const { ipcMain } = setup(createAppHandlers(deps));
    await ipcMain.invoke(IPC_CHANNELS.app.quit);
    expect(deps.quit).toHaveBeenCalledOnce();
    await expect(ipcMain.invoke(IPC_CHANNELS.app.getLoginItem)).resolves.toBe(false);
    await expect(ipcMain.invoke(IPC_CHANNELS.app.openLogs)).resolves.toEqual({ ok: true });
    await expect(ipcMain.invoke(IPC_CHANNELS.app.openLogs, '/etc/passwd')).rejects.toThrow();
    expect(deps.openLogs).toHaveBeenCalledOnce();
  });

  it('hides the popover and accepts only an integer height in range', async () => {
    const deps = appDeps();
    const { ipcMain } = setup(createAppHandlers(deps));
    await ipcMain.invoke(IPC_CHANNELS.popover.hide);
    expect(deps.hidePopover).toHaveBeenCalledOnce();
    await expect(ipcMain.invoke(IPC_CHANNELS.popover.hide, 'x')).rejects.toThrow();

    await ipcMain.invoke(IPC_CHANNELS.popover.setHeight, 320);
    for (const bad of [119, 561, 320.5, '320', Number.NaN, undefined]) {
      await expect(ipcMain.invoke(IPC_CHANNELS.popover.setHeight, bad)).rejects.toThrow();
    }
    await expect(ipcMain.invoke(IPC_CHANNELS.popover.setHeight)).rejects.toThrow();
    expect(deps.setPopoverHeight.mock.calls).toEqual([[320]]);
  });
});

describe('createSenderCheck', () => {
  const page = 'http://localhost:3000/main_window';
  const frame = (fields: Partial<FrameLike> = {}): FrameLike => ({ url: page, processId: 4, routingId: 1, ...fields });
  const mainFrame = frame();
  const windows: AppWindowLike[] = [{ webContents: { mainFrame } }];
  const check = createSenderCheck(
    () => windows,
    (url) => url.startsWith(page),
  );

  it('accepts the main frame of an app window', () => {
    expect(check({ senderFrame: mainFrame })).toBe(true);
    expect(check({ senderFrame: frame() })).toBe(true); // another wrapper of the same frame
  });

  it('rejects missing frames, subframes, other windows and foreign pages', () => {
    expect(check({})).toBe(false);
    expect(check({ senderFrame: null })).toBe(false);
    expect(check(null)).toBe(false);
    expect(check({ senderFrame: frame({ routingId: 2 }) })).toBe(false);
    expect(check({ senderFrame: frame({ processId: 9 }) })).toBe(false);
    expect(check({ senderFrame: { ...mainFrame, url: 'https://evil.example/' } })).toBe(false);
  });

  it('skips windows that throw while being destroyed', () => {
    const broken = {
      get webContents(): never {
        throw new Error('Object has been destroyed');
      },
    } as unknown as AppWindowLike;
    const check2 = createSenderCheck(
      () => [broken, ...windows],
      () => true,
    );
    expect(check2({ senderFrame: mainFrame })).toBe(true);
  });
});

describe('broadcast', () => {
  it('sends to live targets and skips destroyed ones', () => {
    const live = { isDestroyed: () => false, send: vi.fn() };
    const dead = { isDestroyed: () => true, send: vi.fn() };
    const payload = { mode: 'running' as const, queuedCount: 0, analyzingId: null, attentionCount: 0 };

    broadcast([live, dead], IPC_CHANNELS.state.changed, payload);

    expect(live.send).toHaveBeenCalledWith(IPC_CHANNELS.state.changed, payload);
    expect(dead.send).not.toHaveBeenCalled();
  });
});
