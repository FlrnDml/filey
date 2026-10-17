/** Real (Electron / Node) implementations of the ports in `src/core/ports/`. Not unit-tested: they are thin wrappers. */
import { app, BrowserWindow, dialog, net, Notification, powerMonitor, safeStorage, shell } from 'electron';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ICloudFiles } from '../../core/icloud';
import type {
  AppPaths,
  Clock,
  Connectivity,
  FileSystem,
  ICloudDownloader,
  LogFileSystem,
  Logger,
  NotificationTarget,
  Notifier,
  Scheduler,
  SecretStore,
} from '../../core/ports';

export const systemClock: Clock = { now: () => new Date() };

/** `net.isOnline()` plus wake-from-sleep events (arc42 §6.7). Only use after `app` is ready. */
export const electronConnectivity: Connectivity = {
  isOnline: () => net.isOnline(),
  onChange(listener) {
    powerMonitor.on('resume', listener);
    return () => {
      powerMonitor.off('resume', listener);
    };
  },
};

export const timerScheduler: Scheduler = {
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
};

export const consoleLogger: Logger = {
  log(level, message) {
    console[level](message);
  },
};

/** The log file's disk access (`createLogFile`): async only, so logging never blocks the main process. */
export const nodeLogFileSystem: LogFileSystem = {
  append: (p, text) => fs.appendFile(p, text, 'utf8'),
  size: (p) =>
    fs.stat(p).then(
      (s) => s.size,
      (err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? 0 : Promise.reject(err)),
    ),
  rename: (from, to) => fs.rename(from, to),
  mkdir: async (p) => {
    await fs.mkdir(p, { recursive: true });
  },
};

/** Shown notifications that may still be clicked; without a reference, a garbage-collected one loses its handler. */
const MAX_LIVE_NOTIFICATIONS = 20;

/**
 * macOS notifications (Notification Center). `onClick` gets the notification's target (reveal a file, open the
 * history); `lifecycle.ts` decides what that does.
 */
export function createElectronNotifier(onClick: (target: NotificationTarget) => void): Notifier {
  const live: Notification[] = [];
  const release = (n: Notification) => {
    const index = live.indexOf(n);
    if (index >= 0) live.splice(index, 1);
  };
  return {
    notify({ title, body, onClick: target }) {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      live.push(notification);
      if (live.length > MAX_LIVE_NOTIFICATIONS) live.shift();
      notification.on('click', () => {
        release(notification);
        if (target) onClick(target);
      });
      notification.on('close', () => release(notification));
      notification.show();
    },
  };
}

/** Folder of the log files: `~/Library/Logs/Filey` on macOS (arc42 §3.2). Only use after `app` is ready. */
export const logsDir = (): string => app.getPath('logs');

export const electronPaths: AppPaths = {
  userData: () => app.getPath('userData'),
  home: () => app.getPath('home'),
};

export const nodeFileSystem: FileSystem = {
  readFile: (p) => fs.readFile(p),
  writeFile: (p, data) => fs.writeFile(p, data),
  rename: (from, to) => fs.rename(from, to),
  exists: (p) =>
    fs.access(p).then(
      () => true,
      () => false,
    ),
  readDir: (p) => fs.readdir(p),
  mkdir: async (p) => {
    await fs.mkdir(p, { recursive: true });
  },
  remove: (p) => fs.unlink(p),
};

/** Runs `brctl download <path>`; rejects if `brctl` is missing, fails or exceeds the timeout. */
export const brctlDownloader: ICloudDownloader = {
  requestDownload: (p) =>
    new Promise<void>((resolve, reject) => {
      execFile('brctl', ['download', p], { timeout: 30_000 }, (err) => (err ? reject(err) : resolve()));
    }),
};

/** Read-only file access for the iCloud helper. */
export const nodeICloudFiles: ICloudFiles = {
  stat: (p) =>
    fs.stat(p).then(
      (s) => ({ size: s.size, mtimeMs: s.mtimeMs }),
      (err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? undefined : Promise.reject(err)),
    ),
  readHead: async (p) => {
    const handle = await fs.open(p, 'r');
    try {
      await handle.read(Buffer.alloc(1), 0, 1, 0);
    } finally {
      await handle.close();
    }
  },
};

/** Keeps secrets encrypted with `safeStorage` (OS keychain) in one JSON file under userData. */
export function createSafeStorageSecretStore(paths: AppPaths, files: FileSystem = nodeFileSystem): SecretStore {
  const file = () => path.join(paths.userData(), 'secrets.json');

  const load = async (): Promise<Record<string, string>> =>
    (await files.exists(file())) ? (JSON.parse(Buffer.from(await files.readFile(file())).toString('utf8')) as Record<string, string>) : {};

  const save = async (data: Record<string, string>) => {
    await files.mkdir(paths.userData());
    await files.writeFile(file(), JSON.stringify(data));
  };

  return {
    async get(key) {
      const encrypted = (await load())[key];
      return encrypted === undefined ? undefined : safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    },
    async set(key, value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available');
      await save({ ...(await load()), [key]: safeStorage.encryptString(value).toString('base64') });
    },
    async delete(key) {
      const data = await load();
      delete data[key];
      await save(data);
    },
  };
}

/**
 * The bundled sample scan for "Test connection" (arc42 §6.2). Packaged builds get it via
 * `packagerConfig.extraResource` in `forge.config.mts`; in development it is read from `assets/`.
 */
export const readSampleScan = (): Promise<Uint8Array> =>
  fs.readFile(app.isPackaged ? path.join(process.resourcesPath, 'sample-scan.pdf') : path.join(app.getAppPath(), 'assets', 'sample-scan.pdf'));

export const electronShell = {
  showItemInFolder: (fullPath: string) => shell.showItemInFolder(fullPath),
  openPath: (fullPath: string) => shell.openPath(fullPath),
  /** Moves the file to the Trash, so it can be put back. */
  trashItem: (fullPath: string) => shell.trashItem(fullPath),
};

/** Native folder picker, attached to the focused window if there is one. */
export async function chooseFolderDialog(options: { title: string; defaultPath?: string }): Promise<string | null> {
  const dialogOptions: Electron.OpenDialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export const loginItem = {
  get: () => app.getLoginItemSettings().openAtLogin,
  set: (enabled: boolean) => app.setLoginItemSettings({ openAtLogin: enabled }),
};
