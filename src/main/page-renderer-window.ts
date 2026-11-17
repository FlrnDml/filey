import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import type { PageRenderOptions } from '../core/ports';
import { PAGE_RENDERER_CHANNELS, parseResponse, type RenderRequest } from '../pdf-renderer/protocol';
import type { RenderChannel } from './page-renderer';
import { guardNavigation, SECURE_WEB_PREFERENCES } from './window';

declare const PDF_RENDERER_WEBPACK_ENTRY: string;
declare const PDF_RENDERER_PRELOAD_WEBPACK_ENTRY: string;

/** A page rendering that takes longer than this is treated as a hang. */
const RENDER_TIMEOUT_MS = 60_000;
/**
 * Opens the hidden, sandboxed window that renders PDF pages with pdf.js (arc42 §5.3). It has no Node access,
 * loads only the app's own page and may not navigate or open windows; answers are accepted only from this window's contents.
 */
export function openRenderWindow(): RenderChannel {
  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 1000,
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload: PDF_RENDERER_PRELOAD_WEBPACK_ENTRY, backgroundThrottling: false, spellcheck: false },
  });
  const { webContents } = window;
  guardNavigation(webContents);

  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { maxPages: number; resolve(pages: Uint8Array[]): void; reject(error: Error): void; timer: NodeJS.Timeout }>();

  const rejectAll = (message: string) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
      pending.delete(id);
    }
  };

  const onResult = (event: IpcMainEvent, raw: unknown) => {
    if (event.sender !== webContents) return;
    const entryId = typeof (raw as { id?: unknown } | null)?.id === 'number' ? (raw as { id: number }).id : undefined;
    const entry = entryId === undefined ? undefined : pending.get(entryId);
    if (!entry || entryId === undefined) return;
    const response = parseResponse(raw, entry.maxPages);
    pending.delete(entryId);
    clearTimeout(entry.timer);
    if (!response) entry.reject(new Error('Invalid answer from the page renderer'));
    else if ('error' in response) entry.reject(new Error(response.error));
    else entry.resolve(response.pages);
  };
  ipcMain.on(PAGE_RENDERER_CHANNELS.result, onResult);
  webContents.on('render-process-gone', () => rejectAll('The page renderer crashed'));

  const loaded = new Promise<void>((resolve, reject) => {
    webContents.once('did-finish-load', () => resolve());
    webContents.once('did-fail-load', (_event, _code, description) => reject(new Error(`The page renderer did not load: ${description}`)));
  });
  loaded.catch(() => undefined);
  void window.loadURL(PDF_RENDERER_WEBPACK_ENTRY).catch(() => undefined);

  const close = () => {
    if (closed) return;
    closed = true;
    ipcMain.removeListener(PAGE_RENDERER_CHANNELS.result, onResult);
    rejectAll('The page renderer was closed');
    if (!window.isDestroyed()) window.destroy();
  };

  return {
    async render(pdf: Uint8Array, options: PageRenderOptions) {
      if (closed) throw new Error('The page renderer was closed');
      await loaded;
      const id = nextId++;
      const request: RenderRequest = { id, pdf, maxPages: options.maxPages, maxEdgePx: options.maxEdgePx };
      return new Promise<Uint8Array[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('The page renderer took too long'));
        }, RENDER_TIMEOUT_MS);
        pending.set(id, { maxPages: options.maxPages, resolve, reject, timer });
        webContents.send(PAGE_RENDERER_CHANNELS.request, request);
      });
    },
    close,
  };
}
