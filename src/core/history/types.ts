/**
 * The rows the popover shows (arc42 §5.2): the Inbox view lists unprocessed imports, the History view
 * processed ones. Only names, folders, status and times: never document contents and no content hash.
 * Pure types, shared with the renderer.
 */

/** Status of a file that is still in the inbox. `pending` is new or waiting for the connection. */
export type InboxStatus = 'pending' | 'failed' | 'duplicate';

/** One file in the inbox (Inbox view). */
export interface InboxRow {
  id: number;
  /** File name in the inbox, e.g. `Scan 2026-10-16 08.14.pdf`. */
  fileName: string;
  status: InboxStatus;
  /** True while this file is being analyzed and filed ("Working"). */
  working: boolean;
  /** User-facing reason for a `failed` import. */
  error: string | null;
  /** For a `duplicate`: the filed document it duplicates (history id and file name), if it is still in the history. */
  duplicateOf: { id: number; finalName: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** One filed document (History view). */
export interface HistoryRow {
  id: number;
  /** File name in the inbox before filing. */
  originalName: string;
  /** File name after filing, e.g. `2026-10-15_Northwind_Invoice.pdf`. */
  finalName: string;
  /**
   * Destination folder relative to the target folder with `/` separators (e.g. `Health/Health insurance`),
   * `''` for the target folder itself, or the absolute folder if it lies outside the current target folder.
   */
  folder: string;
  /** Folder rule the model chose. */
  category: string | null;
  filedAt: string;
}
