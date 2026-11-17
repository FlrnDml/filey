import type { PageRenderer, PageRenderOptions } from '../core/ports';

/** The channel to one hidden render window, as `createPageRenderer` sees it. */
export interface RenderChannel {
  /** Resolves with PNG pages; rejects if the window fails, crashes or is closed meanwhile. */
  render(pdf: Uint8Array, options: PageRenderOptions): Promise<Uint8Array[]>;
  /** Destroys the window; pending renders reject. */
  close(): void;
}

export interface PageRendererDeps {
  /** Creates a hidden window (real implementation: `openRenderWindow`). */
  open(): RenderChannel;
  /** Closes the window after this long without work. Default 60 seconds (arc42 §5.3). */
  idleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface ManagedPageRenderer extends PageRenderer {
  /** Closes the window now (app quit). */
  dispose(): void;
}

export const PAGE_RENDERER_IDLE_MS = 60_000;

/**
 * The page renderer (arc42 §5.3): opens its hidden window when the first PDF needs rendering, renders one PDF
 * at a time and closes the window again after `idleMs` without work, so no hidden window stays open while idle.
 */
export function createPageRenderer({
  open,
  idleMs = PAGE_RENDERER_IDLE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer as NodeJS.Timeout),
}: PageRendererDeps): ManagedPageRenderer {
  let channel: RenderChannel | undefined;
  let idleTimer: unknown;
  let chain: Promise<unknown> = Promise.resolve();

  const close = () => {
    if (idleTimer !== undefined) clearTimer(idleTimer);
    idleTimer = undefined;
    channel?.close();
    channel = undefined;
  };

  async function renderOne(pdf: Uint8Array, options: PageRenderOptions): Promise<Uint8Array[]> {
    if (idleTimer !== undefined) clearTimer(idleTimer);
    idleTimer = undefined;
    channel ??= open();
    try {
      return await channel.render(pdf, options);
    } catch (error) {
      // A window that failed (crashed, hung) is not reused for the next document.
      close();
      throw error;
    } finally {
      if (channel) idleTimer = setTimer(close, idleMs);
    }
  }

  return {
    render(pdf, options) {
      const run = chain.then(() => renderOne(pdf, options));
      chain = run.catch(() => undefined);
      return run;
    },
    dispose: close,
  };
}
