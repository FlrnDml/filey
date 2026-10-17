/**
 * Ports: small interfaces for everything in `src/core/` that touches the outside
 * world (Electron, OS, clock, disk). Core logic depends only on these, so unit
 * tests can pass fakes and never need to launch Electron. The real
 * implementations live in `src/main/adapters/`.
 */

/** Stores secrets (API keys). Real implementation wraps Electron `safeStorage`. */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * What clicking a notification does (arc42 §8 "Notifications"): `reveal` shows the filed file in Finder,
 * `inbox` opens the popover with the Inbox view (failed imports are listed there).
 */
export type NotificationTarget = { kind: 'reveal'; path: string } | { kind: 'inbox' };

export interface AppNotification {
  title: string;
  body: string;
  /** Without it, clicking the notification does nothing besides dismissing it. */
  onClick?: NotificationTarget;
}

/** Shows a user-visible notification. Real implementation wraps Electron `Notification`. */
export interface Notifier {
  notify(notification: AppNotification): void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Writes diagnostic log lines. Never log secrets. */
export interface Logger {
  log(level: LogLevel, message: string): void;
}

/** Source of the current time, so time-dependent logic is deterministic in tests. */
export interface Clock {
  now(): Date;
}

/** Asks macOS to download an evicted iCloud file. Real implementation runs `brctl download`. Rejects on failure. */
export interface ICloudDownloader {
  requestDownload(path: string): Promise<void>;
}

/** Well-known directories. Real implementation wraps Electron `app.getPath`. */
export interface AppPaths {
  /** Per-user app data directory (database, settings). */
  userData(): string;
  /** The user's home directory. */
  home(): string;
}

/** The subset of file system operations the core needs. Real implementation wraps `node:fs/promises`. */
export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<string[]>;
  /** Creates the directory and any missing parents; no error if it already exists. */
  mkdir(path: string): Promise<void>;
  /** Deletes a file. Rejects with `code: 'ENOENT'` if it does not exist. */
  remove(path: string): Promise<void>;
}

/** File operations the log file needs (all async; the main process never blocks on the log). Real implementation wraps `node:fs/promises`. */
export interface LogFileSystem {
  /** Appends text, creating the file (not its folder) if needed. */
  append(path: string, text: string): Promise<void>;
  /** Size in bytes; 0 if the file does not exist. */
  size(path: string): Promise<number>;
  /** Replaces `to` if it exists. Rejects with `code: 'ENOENT'` if `from` does not exist. */
  rename(from: string, to: string): Promise<void>;
  /** Creates the folder and any missing parents; no error if it already exists. */
  mkdir(path: string): Promise<void>;
}

/** Whether the machine has a network connection. Real implementation wraps Electron `net.isOnline()` and `powerMonitor`. */
export interface Connectivity {
  isOnline(): boolean;
  /** Called when connectivity may have changed (network change, wake from sleep). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** Repeating timer, injectable so tests need no real waiting. Real implementation wraps `setInterval`. */
export interface Scheduler {
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
}
