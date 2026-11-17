import * as pdfjs from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';

/**
 * pdf.js runs its "worker" in this page instead of a separate Worker, so no worker file or `blob:` URL is needed
 * (and the Content-Security-Policy stays strict). This window only does this one job, so that is fine.
 */
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

/** Renders the first `maxPages` pages of a PDF to PNG images whose longer edge is `maxEdgePx` pixels. */
export async function renderPages(pdf: Uint8Array, maxPages: number, maxEdgePx: number): Promise<Uint8Array[]> {
  const task = pdfjs.getDocument({ data: pdf });
  try {
    const doc = await task.promise;
    const pages: Uint8Array[] = [];
    for (let number = 1; number <= Math.min(doc.numPages, maxPages); number++) {
      const page = await doc.getPage(number);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: maxEdgePx / Math.max(base.width, base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No canvas');
        // PNG keeps transparency; a model sees transparent pixels as black, so paint the paper white first.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, canvas, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No image');
        pages.push(new Uint8Array(await blob.arrayBuffer()));
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
