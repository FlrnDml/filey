import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { analyze } from '../core/analyzer';
import { createApiKeyStore } from '../core/api-key';
import { createConnectionTester } from '../core/connection-test';
import { setupDefaultFolders } from '../core/folders';
import { createICloudPrepare } from '../core/icloud';
import { createImportService } from '../core/import';
import { IPC_CHANNELS, type EventChannel, type EventContract } from '../core/ipc';
import { createAppLogger, createLogFile, syncDebugLogging, type LogFile } from '../core/logging';
import type { Logger, NotificationTarget } from '../core/ports';
import { createSettingsRepository } from '../core/settings';
import { createWatcher } from '../core/watcher';
import {
  brctlDownloader,
  chooseFolderDialog,
  consoleLogger,
  createElectronNotifier,
  electronConnectivity,
  electronPaths,
  electronShell,
  createSafeStorageSecretStore,
  loginItem,
  logsDir,
  nodeFileSystem,
  nodeICloudFiles,
  nodeLogFileSystem,
  readSampleScan,
  systemClock,
  timerScheduler,
} from './adapters';
import { openAppDatabase } from './db';
import { connectPipelineEvents } from './ipc/events';
import { createAppHandlers, createOpenLogs, createServiceHandlers } from './ipc/handlers';
import { broadcast, createSenderCheck, registerIpcHandlers } from './ipc/register';
import { connectKeyPrompt, createNotificationClickHandler, startApp, type RunningServices } from './lifecycle';
import { createAppTray, trayMenuTemplate, type AppTray } from './tray';
import { connectTrayState } from './tray-state';
import { isAppPageUrl, rendererEntry } from './window';
import { createWindowManager, type WindowManager } from './windows';

/** The log file (arc42 §8 "Logging"); created once `app` is ready and `app.getPath('logs')` can be used. */
let logFile: LogFile | undefined;
const fileSink: Logger = { log: (level, line) => logFile?.log(level, line) };
/** Every main-process message goes to the console and to `~/Library/Logs/Filey/filey.log`. */
const logger = createAppLogger({ clock: systemClock, sinks: [consoleLogger, fileSink] });

/** IPC is only accepted from the main frame of an app window showing one of the app's own pages. */
const ipcOptions = { isTrustedSender: createSenderCheck(() => BrowserWindow.getAllWindows(), isAppPageUrl), logger };

const sendToWindows = <C extends EventChannel>(channel: C, payload: EventContract[C]) =>
  broadcast(
    BrowserWindow.getAllWindows().map((w) => w.webContents),
    channel,
    payload,
  );

interface ServiceContext {
  windows: WindowManager;
  /** Opens the popover under the tray icon (error notification click). */
  showInbox(): void;
}

/**
 * Opens the database, runs the import pipeline (Watcher -> ImportService) and registers the IPC
 * handlers that need them. Resolves once everything is ready; `stop` stops it again.
 */
async function startServices({ windows, showInbox }: ServiceContext): Promise<RunningServices & { stop(): void }> {
  const store = await openAppDatabase(electronPaths);
  const settings = createSettingsRepository({ settings: store.settings }, { home: electronPaths.home() });
  syncDebugLogging(logger, settings.getSettings());
  // First launch: create Filey/Inbox (iCloud Drive, else this Mac's Documents) before the watcher starts on it.
  const folderSetup = await setupDefaultFolders({ settings, fs: nodeFileSystem, home: electronPaths.home(), logger });
  const apiKeys = createApiKeyStore(createSafeStorageSecretStore(electronPaths));

  const onNotificationClick = createNotificationClickHandler({
    getTargetPath: () => settings.getSettings().targetPath,
    exists: nodeFileSystem.exists,
    showItemInFolder: electronShell.showItemInFolder,
    showInbox,
    logger,
  });

  const service = createImportService({
    imports: store.imports,
    settings,
    apiKeys,
    analyze,
    fs: nodeFileSystem,
    notifier: createElectronNotifier((target: NotificationTarget) => void onNotificationClick(target)),
    logger,
    clock: systemClock,
    connectivity: electronConnectivity,
    scheduler: timerScheduler,
  });
  const stopEvents = connectPipelineEvents({ imports: service, settings, send: sendToWindows });
  service.start();
  // §6.6: an unreadable key opens Settings on the Provider tab once; checked right away, not only before the next import.
  const stopKeyPrompt = connectKeyPrompt({
    imports: service,
    isOnboardingCompleted: () => settings.getSettings().onboardingCompleted,
    openSettings: (tab) => windows.openSettings(tab),
    logger,
  });
  await service.checkKey();

  const watcher = createWatcher({
    inboxPath: settings.getSettings().inboxPath,
    onFile: (filePath) => service.handleFile(filePath),
    onRemove: (filePath) => service.handleRemoved(filePath),
    onReady: (presentPaths) => service.reconcileInbox(presentPaths),
    logger,
    prepare: createICloudPrepare({
      files: nodeICloudFiles,
      downloader: brctlDownloader,
      clock: systemClock,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      logger,
    }),
  });
  watcher.start();

  const unregister = registerIpcHandlers(
    ipcMain,
    createServiceHandlers({
      settings,
      apiKeys,
      imports: service,
      watcher,
      testConnection: createConnectionTester({ analyze, loadSample: readSampleScan, apiKeys, settings }),
      fs: nodeFileSystem,
      shell: electronShell,
      chooseFolder: chooseFolderDialog,
      setLoginItem: loginItem.set,
      getLoginItem: loginItem.get,
      logger,
      folderSetup,
      onSettingsChanged: (next) => {
        syncDebugLogging(logger, next);
        sendToWindows(IPC_CHANNELS.settings.changed, next);
      },
      // Close after the reply went out, so the renderer's call resolves first.
      onOnboardingCompleted: () => setTimeout(() => windows.closeOnboarding(), 0),
    }),
    ipcOptions,
  );

  let stopTrayState: (() => void) | undefined;
  return {
    getSettings: () => settings.getSettings(),
    attachTray(tray: AppTray) {
      stopTrayState = connectTrayState({ imports: service, apply: (appearance) => tray.apply(appearance) });
    },
    stop() {
      unregister();
      stopTrayState?.();
      stopKeyPrompt();
      stopEvents();
      watcher.stop();
      service.stop();
      store.db.close();
    },
  };
}

/** Writes the queued log lines before the app exits (at most a second). */
function flushLogOnQuit() {
  let flushed = false;
  app.on('will-quit', (event) => {
    if (flushed || !logFile) return;
    event.preventDefault();
    const timeout = new Promise((resolve) => setTimeout(resolve, 1000));
    void Promise.race([logFile.flush(), timeout]).finally(() => {
      flushed = true;
      app.quit();
    });
  });
}

void app.whenReady().then(async () => {
  logFile = createLogFile({
    fs: nodeLogFileSystem,
    dir: logsDir(),
    onError: (err) => console.error(`Log file: ${err instanceof Error ? err.message : String(err)}`),
  });
  flushLogOnQuit();
  logger.log('info', `App: Filey ${app.getVersion()} starting`);

  // A menu-bar app: no Dock icon and no main window, only the tray (arc42 §6.3).
  if (process.platform === 'darwin') app.dock?.hide();

  const windows = createWindowManager({
    entry: rendererEntry(),
    // Without a Dock icon the app is not activated by showing a window; bring it to the front explicitly.
    activateApp: () => {
      if (process.platform === 'darwin') app.focus({ steal: true });
    },
  });

  const openLogs = createOpenLogs({ logFile, fs: nodeLogFileSystem, openPath: electronShell.openPath, logger });
  const showLogs = async () => {
    const result = await openLogs();
    if (!result.ok) await dialog.showMessageBox({ type: 'warning', message: result.message });
  };
  const menuActions = { openSettings: () => windows.openSettings(), showLogs: () => void showLogs(), quit: () => app.quit() };

  // The application menu is invisible without a Dock icon, but its shortcuts (⌘, and ⌘Q) and the Edit
  // commands (copy and paste in text fields) still work while a Filey window has focus.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, ...trayMenuTemplate(menuActions)] },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );

  registerIpcHandlers(
    ipcMain,
    createAppHandlers({
      getAppVersion: () => app.getVersion(),
      quit: () => app.quit(),
      openSettings: (tab) => windows.openSettings(tab),
      openLogs,
      getLoginItem: loginItem.get,
      hidePopover: () => windows.hidePopover(),
      setPopoverHeight: (height) => windows.setPopoverHeight(height),
    }),
    ipcOptions,
  );

  /** Set by `startApp` once the services are ready; a notification can only arrive after that. */
  const trayRef: { current?: AppTray } = {};
  const showInbox = () => {
    if (trayRef.current) windows.showPopover(trayRef.current.anchor());
  };
  // The tray is created after the services (and their IPC handlers) are ready: a click never finds an empty popover.
  await startApp({
    startServices: async () => {
      const services = await startServices({ windows, showInbox });
      app.once('before-quit', () => services.stop());
      return services;
    },
    createTray: () => (trayRef.current = createAppTray({ ...menuActions, togglePopover: (anchor) => windows.togglePopover(anchor) })),
    openOnboarding: () => windows.openOnboarding(),
    logger,
  });
});

// Closing the Settings or first-launch window must not quit: Filey keeps running in the menu bar.
app.on('window-all-closed', () => undefined);
