import { renderPages } from './render';
import type { PdfRendererBridge } from './protocol';

declare global {
  interface Window {
    /** Defined by the window's preload script. */
    pdfRenderer: PdfRendererBridge;
  }
}

window.pdfRenderer.onRequest((request) => {
  renderPages(request.pdf, request.maxPages, request.maxEdgePx).then(
    (pages) => window.pdfRenderer.respond({ id: request.id, pages }),
    (error: unknown) => window.pdfRenderer.respond({ id: request.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
