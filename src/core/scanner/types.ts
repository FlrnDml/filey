/**
 * Types of the target-folder scan (arc42 §5.4). Shared with the renderer through `src/core/ipc.ts`, so this file
 * imports nothing.
 */

/** One folder below the target folder. */
export interface ScannedFolder {
  /** Relative to the target folder, `/` between folders, NFC. Never empty (the target folder itself is not listed). */
  path: string;
  /** Files directly in this folder (hidden files not counted, iCloud placeholders counted). */
  fileCount: number;
  /** Up to `MAX_SAMPLE_FILE_NAMES` file names directly in this folder, sorted. */
  sampleFileNames: string[];
}

/** One file in the target folder or below it. */
export interface ScannedFile {
  /** Relative to the target folder, `/` between folders, NFC; an iCloud placeholder is listed under its real name. */
  path: string;
  /** True if only the iCloud placeholder (`.name.pdf.icloud`) is on this Mac. */
  placeholder: boolean;
}

export interface ScanResult {
  /** The target folder that was scanned (absolute). */
  root: string;
  /** Sorted by path. */
  folders: ScannedFolder[];
  /** Sorted by path. */
  files: ScannedFile[];
  /** True if the scan stopped at the depth or entry limit, so folders or files are missing. */
  truncated: boolean;
  /** ISO time of the scan. */
  scannedAt: string;
}

/** Scan limits (arc42 §5.4). */
export const SCAN_MAX_DEPTH = 6;
export const SCAN_MAX_ENTRIES = 5000;
/** Sample file names kept per folder; at most these are sent with "Suggest descriptions". */
export const MAX_SAMPLE_FILE_NAMES = 5;
