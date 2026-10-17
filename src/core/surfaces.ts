/**
 * The renderer surfaces (windows) of Filey. All of them load the same renderer entry page; the
 * URL fragment picks the screen: `#popover`, `#settings/<tab>` or `#onboarding`.
 *
 * Shared by main (to build window URLs and to accept IPC only from these pages) and the renderer
 * (to pick the screen), so it must stay free of Electron and Node imports.
 */
import { SETTINGS_TABS, type SettingsTab } from './ipc';

export type Surface = { kind: 'popover' } | { kind: 'settings'; tab: SettingsTab } | { kind: 'onboarding' };

export const DEFAULT_SETTINGS_TAB: SettingsTab = 'general';

/** The fragment (with `#`) that shows `surface`. */
export function surfaceHash(surface: Surface): string {
  switch (surface.kind) {
    case 'popover':
      return '#popover';
    case 'settings':
      return `#settings/${surface.tab}`;
    case 'onboarding':
      return '#onboarding';
  }
}

/**
 * Parses a fragment (with or without `#`). Returns null for anything that is not exactly one of the
 * known surfaces, so a page with another fragment is not treated as an app page.
 */
export function parseSurfaceHash(hash: string): Surface | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  if (value === 'popover') return { kind: 'popover' };
  if (value === 'onboarding') return { kind: 'onboarding' };
  if (value === 'settings') return { kind: 'settings', tab: DEFAULT_SETTINGS_TAB };
  const match = /^settings\/([a-z]+)$/.exec(value);
  const tab = match?.[1];
  if (tab !== undefined && (SETTINGS_TABS as readonly string[]).includes(tab)) return { kind: 'settings', tab: tab as SettingsTab };
  return null;
}
