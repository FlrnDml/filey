import type { WebContents, WebPreferences } from 'electron';
import { parseSurfaceHash, surfaceHash, type Surface } from '../core/surfaces';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

/** Security defaults for every window: the renderer gets no Node access and only the preload bridge. */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const satisfies WebPreferences;

/**
 * True if `url` is the same document as one of `entries` (same protocol, host and path; query and hash may differ).
 */
export function isSameDocument(url: string, entries: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return entries.some((entry) => {
    const e = new URL(entry);
    return e.protocol === parsed.protocol && e.host === parsed.host && e.pathname === parsed.pathname;
  });
}

/**
 * True if `url` is the renderer entry page showing one of the app's surfaces: the entry itself plus exactly
 * one known fragment (`#popover`, `#settings/<tab>`, `#onboarding`, see `src/core/surfaces.ts`) and no query.
 */
export function isAppPage(url: string, entry: string): boolean {
  if (!isSameDocument(url, [entry])) return false;
  const parsed = new URL(url);
  return parsed.search === '' && parseSurfaceHash(parsed.hash) !== null;
}

/** True if `url` is one of the pages this app loads into its windows (used by the IPC sender check). */
export function isAppPageUrl(url: string): boolean {
  return isAppPage(url, MAIN_WINDOW_WEBPACK_ENTRY);
}

/** The renderer entry page and its preload script, as built by Electron Forge's webpack plugin. */
export const rendererEntry = (): { url: string; preload: string } => ({
  url: MAIN_WINDOW_WEBPACK_ENTRY,
  preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
});

/** The URL that shows `surface`. */
export function surfaceUrl(entry: string, surface: Surface): string {
  return `${entry}${surfaceHash(surface)}`;
}

/** The navigation guards every app window gets: no new windows, no navigation away from the app page. */
export function guardNavigation(contents: Pick<WebContents, 'setWindowOpenHandler' | 'on'>): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Fragment changes within the page (`#settings/<tab>`) do not emit `will-navigate`; everything else is blocked.
  contents.on('will-navigate', (event) => event.preventDefault());
}
