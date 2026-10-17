import type { AnalyzeOptions, AnalyzeResult } from '../analyzer';
import type { ApiKeyStore } from '../api-key';
import type { ImportTables, ProcessedImport, UnprocessedImport } from '../db';
import type { Clock, Connectivity, FileSystem, Logger, Notifier, Scheduler } from '../ports';
import type { SettingsRepository } from '../settings';

/** What the import pipeline is doing right now. */
export type ImportState =
  | { mode: 'running' }
  /** The API key is missing or unreadable (arc42 §6.6): nothing is sent or moved until a key is saved. */
  | { mode: 'paused'; reason: 'missing' | 'unreadable' }
  /** OpenRouter cannot be reached (arc42 §6.7): files wait in the queue. */
  | { mode: 'offline' };

export type ImportOutcome = 'filed' | 'failed' | 'duplicate' | 'queued' | 'paused' | 'vanished' | 'skipped';

export type RetryResult = 'started' | 'not-found' | 'not-failed' | 'file-missing';

/** A change to the inbox list (`unprocessed_imports`): a row was written, or the file left the inbox. */
export type InboxChange = { kind: 'upsert'; record: UnprocessedImport } | { kind: 'remove'; id: number };

/** A change to the history (`processed_imports`): a document was filed, or its entry was removed. */
export type HistoryChange = { kind: 'upsert'; record: ProcessedImport } | { kind: 'remove'; id: number };

export interface ImportServiceDeps {
  imports: ImportTables;
  settings: Pick<SettingsRepository, 'getSettings' | 'listRules'>;
  apiKeys: Pick<ApiKeyStore, 'get' | 'onStatusChange'>;
  /** `analyze` from `core/analyzer`; injected so tests need no model. */
  analyze: (pdf: Buffer, options: AnalyzeOptions) => Promise<AnalyzeResult>;
  fs: FileSystem;
  notifier: Notifier;
  logger: Logger;
  clock: Clock;
  connectivity: Connectivity;
  scheduler: Scheduler;
}

export interface ImportService {
  /** The Watcher's `onFile`: runs one import, one at a time. Never rejects. */
  handleFile(filePath: string): Promise<void>;
  /** The Watcher's `onRemove`: a file left the inbox (deleted, moved, trashed). Drops its inbox row. */
  handleRemoved(filePath: string): void;
  /**
   * The Watcher's `onReady`, with the PDFs found by the initial scan: drops inbox rows whose file is no longer
   * in the inbox (deleted while Filey was not running). Only the inbox is looked at, never the target folder.
   */
  reconcileInbox(presentPaths: readonly string[]): void;
  /** Re-runs a `failed` inbox entry (the file must still be in the inbox). */
  retry(inboxId: number): Promise<RetryResult>;
  /** Starts listening for key changes, connectivity changes and wake events. */
  start(): void;
  /** Stops listeners and timers. */
  stop(): void;
  getState(): ImportState;
  /** Called whenever the state changes (tray, settings window). Returns an unsubscribe function. */
  onStateChange(listener: (state: ImportState) => void): () => void;
  /** Files still in the inbox, newest first. */
  listInbox(): UnprocessedImport[];
  getInboxEntry(inboxId: number): UnprocessedImport | undefined;
  /** Called after every inbox write or removal (feeds `inbox:changed`). Returns an unsubscribe function. */
  onInboxChanged(listener: (change: InboxChange) => void): () => void;
  /** Filed documents, most recent first. */
  listHistory(limit: number): ProcessedImport[];
  getHistoryEntry(historyId: number): ProcessedImport | undefined;
  /** Called after every history write or removal (feeds `history:changed`). Returns an unsubscribe function. */
  onHistoryChanged(listener: (change: HistoryChange) => void): () => void;
  /** Number of files waiting for the connection. */
  queuedCount(): number;
  /** Called with the new `queuedCount()` whenever it changes. Returns an unsubscribe function. */
  onQueuedCountChange(listener: (count: number) => void): () => void;
  /** Id of the inbox entry being analyzed and filed right now, or null (the tray's "working" icon, the "Working" row). */
  analyzingId(): number | null;
  /** Called with `analyzingId()` whenever it changes. Returns an unsubscribe function. */
  onAnalyzingChange(listener: (inboxId: number | null) => void): () => void;
  /**
   * Reads the stored key once and pauses if it is missing or unreadable, so the app notices an unreadable
   * key on start and not only before the next import (arc42 §6.6). Never rejects.
   */
  checkKey(): Promise<void>;
}
