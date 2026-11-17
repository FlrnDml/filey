/**
 * Messages between the main process and the hidden page-renderer window (arc42 §5.3). Shared by main, the
 * window's preload and its page, so it must not import Electron.
 */

export const PAGE_RENDERER_CHANNELS = {
  /** Main -> window: render these pages. */
  request: 'pdf-renderer:request',
  /** Window -> main: the pages, or why it failed. */
  result: 'pdf-renderer:result',
} as const;

export interface RenderRequest {
  id: number;
  pdf: Uint8Array;
  maxPages: number;
  maxEdgePx: number;
}

/** `pages` are PNG images in page order; `error` is a short technical text for the log, never shown to the user. */
export type RenderResponse = { id: number; pages: Uint8Array[] } | { id: number; error: string };

/** A rendered page image larger than this is refused (a 1024 px PNG is well below 5 MB). */
export const MAX_PAGE_BYTES = 20 * 1024 * 1024;

/**
 * Checks an answer from the window: it is untrusted input like any renderer message. Returns undefined if it is
 * malformed, has more than `maxPages` pages or an empty or oversized page.
 */
export function parseResponse(value: unknown, maxPages: number): RenderResponse | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, pages, error } = value as { id?: unknown; pages?: unknown; error?: unknown };
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return undefined;
  if (typeof error === 'string') return { id, error: error.slice(0, 200) };
  if (!Array.isArray(pages) || pages.length > maxPages) return undefined;
  if (!pages.every((p) => p instanceof Uint8Array && p.byteLength > 0 && p.byteLength <= MAX_PAGE_BYTES)) return undefined;
  return { id, pages: pages as Uint8Array[] };
}

/** What the window's preload exposes to its page as `window.pdfRenderer`. */
export interface PdfRendererBridge {
  onRequest(listener: (request: RenderRequest) => void): void;
  respond(response: RenderResponse): void;
}
