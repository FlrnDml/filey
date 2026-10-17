import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

/** Minimal stand-in for Electron's BrowserWindow: records what the window manager does with it. */
class FakeWindow {
  static instances: FakeWindow[] = [];
  readonly handlers = new Map<string, Handler[]>();
  readonly loaded: string[] = [];
  visible = false;
  destroyed = false;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  alwaysOnTop: unknown[] = [];
  readonly webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
  constructor(readonly options: Record<string, unknown>) {
    FakeWindow.instances.push(this);
  }
  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  once(event: string, handler: Handler) {
    return this.on(event, handler);
  }
  emit(event: string) {
    (this.handlers.get(event) ?? []).forEach((h) => h());
  }
  loadURL(url: string) {
    this.loaded.push(url);
    return Promise.resolve();
  }
  isDestroyed = () => this.destroyed;
  isVisible = () => this.visible;
  isMinimized = () => false;
  restore() {}
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  focus = vi.fn();
  setBounds(bounds: FakeWindow['bounds']) {
    this.bounds = bounds;
  }
  invalidateShadow = vi.fn();
  setAlwaysOnTop(...args: unknown[]) {
    this.alwaysOnTop = args;
  }
  setVisibleOnAllWorkspaces = vi.fn();
  close() {
    this.destroyed = true;
    this.emit('closed');
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }) },
}));

const { createWindowManager, BLUR_TOGGLE_GRACE_MS, POPOVER_WIDTH } = await import('./windows');

const ENTRY = 'file:///app/.webpack/renderer/main_window/index.html';
const tray = { x: 1000, y: 0, width: 28, height: 24 };

function setup(platform: NodeJS.Platform = 'linux') {
  let time = 10_000;
  const activateApp = vi.fn();
  const manager = createWindowManager({ entry: { url: ENTRY, preload: '/preload.js' }, activateApp, now: () => time, platform });
  return { manager, activateApp, advance: (ms: number) => (time += ms) };
}

beforeEach(() => {
  FakeWindow.instances = [];
});

describe('popover on macOS Spaces', () => {
  it('is a non-activating panel visible on all Spaces and over full-screen apps', () => {
    const { manager } = setup('darwin');
    manager.togglePopover(tray);
    const window = FakeWindow.instances[0]!;
    expect(window.options).toMatchObject({ type: 'panel' });
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  });

  it('never activates the app when showing, and re-applies the all-Spaces flag on every show', () => {
    const { manager, activateApp } = setup('darwin');
    manager.togglePopover(tray);
    const window = FakeWindow.instances[0]!;
    window.emit('ready-to-show');
    manager.togglePopover(tray); // hide
    window.setVisibleOnAllWorkspaces.mockClear();
    manager.togglePopover(tray); // show again
    expect(window.visible).toBe(true);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1);
    expect(activateApp).not.toHaveBeenCalled();
  });

  it('uses no panel type and no workspace flags on other platforms', () => {
    const { manager } = setup('linux');
    manager.togglePopover(tray);
    const window = FakeWindow.instances[0]!;
    expect(window.options).not.toHaveProperty('type');
    expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });

  it('still activates the app for Settings, which is a regular window', () => {
    const { manager, activateApp } = setup('darwin');
    manager.openSettings();
    FakeWindow.instances[0]!.emit('ready-to-show');
    expect(activateApp).toHaveBeenCalled();
  });
});

describe('popover', () => {
  it('is a secure, frameless, hidden pop-up window loading #popover', () => {
    const { manager } = setup();
    manager.togglePopover(tray);
    const [window] = FakeWindow.instances;
    expect(window?.options).toMatchObject({
      width: POPOVER_WIDTH,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: '/preload.js' },
    });
    expect(window?.alwaysOnTop).toEqual([true, 'pop-up-menu']);
    expect(window?.loaded).toEqual([`${ENTRY}#popover`]);
    expect(window?.webContents.setWindowOpenHandler).toHaveBeenCalled();
    expect(window?.webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function));
  });

  it('shows under the tray icon once rendered, then toggles', () => {
    const { manager, activateApp } = setup();
    manager.togglePopover(tray);
    const window = FakeWindow.instances[0]!;
    expect(window.visible).toBe(false);
    window.emit('ready-to-show');
    expect(window.visible).toBe(true);
    expect(window.bounds).toMatchObject({ x: 1014 - 180, y: 28, width: 360 });
    expect(activateApp).not.toHaveBeenCalled();

    manager.togglePopover(tray);
    expect(window.visible).toBe(false);
    manager.togglePopover(tray);
    expect(window.visible).toBe(true);
    expect(FakeWindow.instances).toHaveLength(1);
  });

  it('hides on blur and ignores the tray click that caused the blur', () => {
    const { manager, advance } = setup();
    manager.showPopover(tray);
    const window = FakeWindow.instances[0]!;
    window.emit('ready-to-show');

    window.emit('blur');
    expect(window.visible).toBe(false);
    advance(50);
    manager.togglePopover(tray);
    expect(window.visible).toBe(false);

    advance(BLUR_TOGGLE_GRACE_MS);
    manager.togglePopover(tray);
    expect(window.visible).toBe(true);
  });

  it('fits its content height and hides on request', () => {
    const { manager } = setup();
    manager.showPopover(tray);
    const window = FakeWindow.instances[0]!;
    window.emit('ready-to-show');
    manager.setPopoverHeight(300);
    expect(window.bounds).toMatchObject({ height: 300, y: 28 });
    manager.hidePopover();
    expect(manager.isPopoverVisible()).toBe(false);
  });
});

describe('Settings window', () => {
  it('opens once on the requested tab and is focused again afterwards', () => {
    const { manager } = setup();
    manager.openSettings('provider');
    const window = FakeWindow.instances[0]!;
    expect(window.options).toMatchObject({ width: 620, show: false, webPreferences: { sandbox: true } });
    expect(window.loaded).toEqual([`${ENTRY}#settings/provider`]);
    window.emit('ready-to-show');
    expect(window.visible).toBe(true);

    manager.openSettings('filing');
    manager.openSettings();
    expect(FakeWindow.instances).toHaveLength(1);
    expect(window.loaded).toEqual([`${ENTRY}#settings/provider`, `${ENTRY}#settings/filing`]);
    expect(window.focus).toHaveBeenCalledTimes(3);
  });

  it('defaults to the General tab and is created again after closing', () => {
    const { manager } = setup();
    manager.openSettings();
    FakeWindow.instances[0]!.close();
    manager.openSettings();
    expect(FakeWindow.instances.map((w) => w.loaded[0])).toEqual([`${ENTRY}#settings/general`, `${ENTRY}#settings/general`]);
  });
});

describe('onboarding window', () => {
  it('is a single small window loading #onboarding', () => {
    const { manager } = setup();
    manager.openOnboarding();
    manager.openOnboarding();
    expect(FakeWindow.instances).toHaveLength(1);
    expect(FakeWindow.instances[0]?.options).toMatchObject({ width: 300, resizable: false });
    expect(FakeWindow.instances[0]?.loaded).toEqual([`${ENTRY}#onboarding`]);
  });

  it('closes on request ("Got it") and opens again later', () => {
    const { manager } = setup();
    manager.closeOnboarding(); // nothing open: no error
    manager.openOnboarding();
    manager.closeOnboarding();
    expect(FakeWindow.instances[0]?.destroyed).toBe(true);
    manager.openOnboarding();
    expect(FakeWindow.instances).toHaveLength(2);
  });
});
