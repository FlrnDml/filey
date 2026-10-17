/**
 * What the menu-bar icon shows for the pipeline state (docs/design-system/components/TrayIcon, arc42 §6.5–§6.7).
 * Pure logic plus a small event bridge, so it is unit-tested without Electron.
 */
import type { ImportService } from '../core/import';
import type { AppState } from '../core/ipc';
import { currentAppState } from './ipc/events';

/** Icon variants shipped under `assets/tray/`. */
export type TrayIconVariant = 'idle' | 'working' | 'attention';

export interface TrayAppearance {
  icon: TrayIconVariant;
  tooltip: string;
}

/** Template image file (1x; macOS picks the `@2x` file next to it) for each variant. */
export const TRAY_ICON_FILES: Record<TrayIconVariant, string> = {
  idle: 'trayTemplate.png',
  working: 'trayWorkingTemplate.png',
  attention: 'trayAttentionTemplate.png',
};

export interface TrayStatus {
  /** Null when the import pipeline could not start. */
  state: AppState | null;
}

/**
 * Idle scanner normally; the heavier scan line ("working") while a PDF is analyzed; the "needs attention"
 * dot when imports are paused (key missing or unreadable), when inbox entries failed or are duplicates, or
 * when the pipeline could not start. Working wins over attention, since the next result decides again.
 * Offline is shown in the tooltip (files wait, nothing failed, arc42 §6.7).
 */
export function trayAppearance({ state }: TrayStatus): TrayAppearance {
  if (state === null) return { icon: 'attention', tooltip: 'Filey · Could not start' };
  const parts = ['Filey'];
  let attention = state.attentionCount > 0;
  const working = state.analyzingId !== null;
  switch (state.mode) {
    case 'running':
      if (working) parts.push('Filing a scan…');
      break;
    case 'paused':
      attention = true;
      parts.push(state.reason === 'missing' ? 'Paused, API key missing' : 'Paused, API key unreadable');
      break;
    case 'offline':
      parts.push(state.queuedCount > 0 ? `Offline, ${state.queuedCount} waiting` : 'Offline');
      break;
  }
  if (state.attentionCount > 0) parts.push(`${state.attentionCount} need${state.attentionCount === 1 ? 's' : ''} attention`);
  const showWorking = state.mode === 'running' && working;
  return { icon: showWorking ? 'working' : attention ? 'attention' : 'idle', tooltip: parts.join(' · ') };
}

export interface TrayStateDeps {
  imports: Pick<
    ImportService,
    'onInboxChanged' | 'onStateChange' | 'onQueuedCountChange' | 'onAnalyzingChange' | 'getState' | 'queuedCount' | 'analyzingId' | 'listInbox'
  >;
  /** Applies the appearance to the tray; only called when it changed. */
  apply(appearance: TrayAppearance): void;
}

/** Keeps the tray in sync with the import pipeline. Returns a function that stops it. */
export function connectTrayState({ imports, apply }: TrayStateDeps): () => void {
  let last: TrayAppearance | undefined;

  const update = () => {
    const next = trayAppearance({ state: currentAppState(imports) });
    if (last && last.icon === next.icon && last.tooltip === next.tooltip) return;
    last = next;
    apply(next);
  };

  const disposers = [imports.onInboxChanged(update), imports.onStateChange(update), imports.onQueuedCountChange(update), imports.onAnalyzingChange(update)];
  update();
  return () => disposers.splice(0).forEach((dispose) => dispose());
}
