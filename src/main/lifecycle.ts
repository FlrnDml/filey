/**
 * App lifecycle decisions that do not need Electron (arc42 §6.3, §6.4, §6.6, §8 "Notifications"), so they
 * are unit-tested: the start order, the first-launch window, asking for an unreadable key once, and what a
 * notification click does. `index.ts` wires them to Electron.
 */
import * as path from 'node:path';
import { isInside } from '../core/history';
import type { ImportService } from '../core/import';
import type { SettingsTab } from '../core/ipc';
import type { Logger, NotificationTarget } from '../core/ports';
import type { Settings } from '../core/settings';
import type { AppTray } from './tray';
import { trayAppearance } from './tray-state';

/** First launch: the onboarding window opens until the flow was completed once (§6.4). */
export const shouldOpenOnboarding = (settings: Pick<Settings, 'onboardingCompleted'>): boolean => !settings.onboardingCompleted;

/** What `startServices` hands back to the start sequence. */
export interface RunningServices {
  getSettings(): Pick<Settings, 'onboardingCompleted'>;
  /** Keeps the tray icon in sync with the pipeline. */
  attachTray(tray: AppTray): void;
}

export interface StartupDeps {
  /** Opens the database, starts the pipeline and registers the IPC handlers that need them. Rejects on failure. */
  startServices(): Promise<RunningServices>;
  createTray(): AppTray;
  openOnboarding(): void;
  logger: Logger;
}

export interface Started {
  tray: AppTray;
  /** Undefined when the services could not start; the tray then shows "Could not start". */
  services?: RunningServices;
}

/**
 * The start sequence (§6.3, §6.4). The tray is created only after the services are ready (or failed), so a
 * click on the icon never opens a popover whose IPC handlers and data are not there yet. Then the
 * first-launch window opens if onboarding was not completed; otherwise there is only the tray.
 */
export async function startApp(deps: StartupDeps): Promise<Started> {
  let services: RunningServices | undefined;
  try {
    services = await deps.startServices();
  } catch (err) {
    deps.logger.log('error', `Services could not start: ${err instanceof Error ? err.message : String(err)}`);
  }
  const tray = deps.createTray();
  if (!services) {
    tray.apply(trayAppearance({ state: null }));
    return { tray };
  }
  services.attachTray(tray);
  if (shouldOpenOnboarding(services.getSettings())) {
    deps.logger.log('info', 'App: first launch, opening the onboarding window');
    deps.openOnboarding();
  }
  return { tray, services };
}

export interface KeyPromptDeps {
  imports: Pick<ImportService, 'getState' | 'onStateChange'>;
  /** Until onboarding is done, its first step asks for the key; no extra Settings window then. */
  isOnboardingCompleted(): boolean;
  openSettings(tab: SettingsTab): void;
  logger: Logger;
}

/**
 * §6.6: when the stored key cannot be read, imports pause and the Settings window opens on the Provider tab
 * (it shows the explanation and the key field). It opens once per occurrence, not on every import attempt;
 * once the key is usable again (or replaced by a missing one), a later unreadable key asks again.
 * Returns a function that stops listening.
 */
export function connectKeyPrompt({ imports, isOnboardingCompleted, openSettings, logger }: KeyPromptDeps): () => void {
  let prompted = false;
  const check = (state: ReturnType<typeof imports.getState>) => {
    if (state.mode !== 'paused' || state.reason !== 'unreadable') {
      prompted = false;
      return;
    }
    if (prompted || !isOnboardingCompleted()) return;
    prompted = true;
    logger.log('warn', 'App: the stored API key cannot be read, asking for it in Settings');
    openSettings('provider');
  };
  const off = imports.onStateChange(check);
  check(imports.getState());
  return off;
}

export interface NotificationClickDeps {
  /** The configured target folder; a revealed file must be inside it. */
  getTargetPath(): string;
  exists(fullPath: string): Promise<boolean>;
  showItemInFolder(fullPath: string): void;
  /** Opens the popover under the tray icon (the renderer shows the Inbox tab when the inbox has entries). */
  showInbox(): void;
  logger: Logger;
}

/**
 * What clicking a notification does (§8 "Notifications"): a success notification reveals the filed file in
 * Finder, an error notification opens the popover. A file outside the target folder is never revealed, and
 * a file that is gone by now falls back to the popover, which shows where it went.
 */
export function createNotificationClickHandler(deps: NotificationClickDeps): (target: NotificationTarget) => Promise<void> {
  return async (target) => {
    if (target.kind === 'inbox') {
      deps.showInbox();
      return;
    }
    const file = path.resolve(target.path);
    if (!path.isAbsolute(target.path) || !isInside(file, deps.getTargetPath())) {
      deps.logger.log('warn', 'Notification: refused to reveal a file outside the target folder');
      deps.showInbox();
      return;
    }
    if (!(await deps.exists(file))) {
      deps.logger.log('info', `Notification: ${path.basename(file)} is no longer there, showing the history`);
      deps.showInbox();
      return;
    }
    deps.showItemInFolder(file);
  };
}
