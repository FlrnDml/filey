/**
 * The app's windows (arc42 §5.1 "UI"). There is no main window: the app starts with only the
 * tray (§6.3). Every window loads the same renderer entry; the URL fragment picks the surface
 * (`src/core/surfaces.ts`):
 *
 * - popover (`#popover`): frameless, under the tray icon, hidden on blur and Esc, kept after the first open,
 * - Settings (`#settings/<tab>`): standard window, created on demand, one instance,
 * - first launch (`#onboarding`): small standard window, one instance.
 */
import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import type { SettingsTab } from '../core/ipc';
import { DEFAULT_SETTINGS_TAB, type Surface } from '../core/surfaces';
import { popoverBounds, type Rect } from './popover-position';
import { guardNavigation, SECURE_WEB_PREFERENCES, surfaceUrl } from './window';

export const POPOVER_WIDTH = 360;
/** Height until the renderer reports its content height (`popover.setHeight`). */
export const POPOVER_INITIAL_HEIGHT = 420;
/**
 * A tray click that arrives this soon after the popover hid on blur is the click that caused the blur
 * (clicking the tray icon blurs the popover first); it must not reopen the popover.
 */
export const BLUR_TOGGLE_GRACE_MS = 300;

export const SETTINGS_SIZE = { width: 620, height: 640 } as const;
/** The first-launch window (docs/design-system/components/Onboarding: 300–480px wide, one step at a time). */
export const ONBOARDING_SIZE = { width: 300, height: 580 } as const;

export interface WindowManagerOptions {
  /** The renderer entry page and preload script (`rendererEntry()`). */
  entry: { url: string; preload: string };
  /** Brings the app to the foreground; a menu-bar app without Dock icon is not activated by `show()` alone. */
  activateApp(): void;
  /** Milliseconds clock, injectable for tests. */
  now?: () => number;
  /** Injectable for tests. */
  platform?: NodeJS.Platform;
}

export interface WindowManager {
  /** Tray click: shows the popover under `anchor` (the tray icon bounds), or hides it if it is open. */
  togglePopover(anchor: Rect): void;
  showPopover(anchor: Rect): void;
  hidePopover(): void;
  isPopoverVisible(): boolean;
  /** Resizes the popover to its content height (CSS px), keeping it anchored at the tray icon. */
  setPopoverHeight(height: number): void;
  /** Opens or focuses the Settings window; with a tab, switches to it. */
  openSettings(tab?: SettingsTab): void;
  /** Opens or focuses the first-launch window. */
  openOnboarding(): void;
  /** Closes the first-launch window if it is open ("Got it", arc42 §6.4 step 4). */
  closeOnboarding(): void;
}

const alive = (window: BrowserWindow | undefined): window is BrowserWindow => window !== undefined && !window.isDestroyed();

export function createWindowManager({ entry, activateApp, now = Date.now, platform = process.platform }: WindowManagerOptions): WindowManager {
  let popover: BrowserWindow | undefined;
  let popoverReady = false;
  let popoverHeight = POPOVER_INITIAL_HEIGHT;
  let anchor: Rect | undefined;
  let hiddenOnBlurAt = Number.NEGATIVE_INFINITY;
  let settings: BrowserWindow | undefined;
  let onboarding: BrowserWindow | undefined;

  const urlFor = (surface: Surface) => surfaceUrl(entry.url, surface);

  const webPreferences = { ...SECURE_WEB_PREFERENCES, preload: entry.preload };

  const bringToFront = (window: BrowserWindow) => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    activateApp();
  };

  /**
   * Shows the popover on the Space the user is looking at. It must not activate the app:
   * activating a Dock-less app makes macOS switch to the Space (or full-screen app) of its other windows.
   * The popover is a non-activating panel (see `createPopover`), so `show()`/`focus()` give it keyboard
   * focus without that. The all-Spaces flag is re-applied before every show because macOS can drop it
   * while the window is hidden.
   */
  const showOnCurrentSpace = (window: BrowserWindow) => {
    if (platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.show();
    window.focus();
  };

  const placePopover = (window: BrowserWindow) => {
    if (!anchor) return;
    const { workArea } = screen.getDisplayMatching(anchor);
    window.setBounds(popoverBounds(anchor, workArea, { width: POPOVER_WIDTH, height: popoverHeight }));
    // macOS computes the shadow of a transparent window from its content; refresh it after a resize.
    if (process.platform === 'darwin') window.invalidateShadow();
  };

  const createPopover = (): BrowserWindow => {
    const window = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: popoverHeight,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // The renderer draws the rounded, bordered panel; the window around it stays transparent.
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      title: 'Filey',
      // macOS: an NSPanel with the non-activating style, so showing it neither activates the app nor
      // switches Spaces, and it can appear over full-screen apps.
      ...(platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences,
    });
    window.setAlwaysOnTop(true, 'pop-up-menu');
    // Open on the current Space, also over full-screen apps, without turning the app into a Dock app.
    if (platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    guardNavigation(window.webContents);
    window.on('blur', () => {
      if (!window.isVisible()) return;
      hiddenOnBlurAt = now();
      window.hide();
    });
    window.once('ready-to-show', () => {
      popoverReady = true;
      if (anchor) {
        placePopover(window);
        showOnCurrentSpace(window);
      }
    });
    window.on('closed', () => {
      popover = undefined;
      popoverReady = false;
    });
    void window.loadURL(urlFor({ kind: 'popover' }));
    return window;
  };

  const showPopover = (at: Rect) => {
    anchor = at;
    if (!alive(popover)) {
      popover = createPopover(); // shown on ready-to-show
      return;
    }
    if (!popoverReady) return;
    placePopover(popover);
    showOnCurrentSpace(popover);
  };

  const hidePopover = () => {
    if (alive(popover) && popover.isVisible()) popover.hide();
  };

  /** A standard, single-instance app window that shows itself once its page has rendered. */
  const createAppWindow = (options: BrowserWindowConstructorOptions, surface: Surface): BrowserWindow => {
    const window = new BrowserWindow({ show: false, maximizable: false, fullscreenable: false, ...options, webPreferences });
    guardNavigation(window.webContents);
    window.once('ready-to-show', () => bringToFront(window));
    void window.loadURL(urlFor(surface));
    return window;
  };

  return {
    togglePopover(at) {
      if (alive(popover) && popover.isVisible()) {
        popover.hide();
        return;
      }
      if (now() - hiddenOnBlurAt < BLUR_TOGGLE_GRACE_MS) return;
      showPopover(at);
    },
    showPopover,
    hidePopover,
    isPopoverVisible: () => alive(popover) && popover.isVisible(),
    setPopoverHeight(height) {
      popoverHeight = height;
      if (alive(popover) && popover.isVisible()) placePopover(popover);
    },
    openSettings(tab) {
      if (alive(settings)) {
        // Same document, new fragment: the renderer switches the tab on `hashchange`.
        if (tab !== undefined) settings.loadURL(urlFor({ kind: 'settings', tab })).catch(() => undefined);
        bringToFront(settings);
        return;
      }
      const window = createAppWindow(
        { ...SETTINGS_SIZE, minWidth: SETTINGS_SIZE.width, minHeight: 480, title: 'Settings' },
        { kind: 'settings', tab: tab ?? DEFAULT_SETTINGS_TAB },
      );
      window.on('closed', () => {
        if (settings === window) settings = undefined;
      });
      settings = window;
    },
    openOnboarding() {
      if (alive(onboarding)) {
        bringToFront(onboarding);
        return;
      }
      const window = createAppWindow({ ...ONBOARDING_SIZE, resizable: false, minimizable: false, title: 'Welcome to Filey' }, { kind: 'onboarding' });
      window.on('closed', () => {
        if (onboarding === window) onboarding = undefined;
      });
      onboarding = window;
    },
    closeOnboarding() {
      if (alive(onboarding)) onboarding.close();
    },
  };
}
