import type { UserContent } from 'ai';

export const PDF_MEDIA_TYPE = 'application/pdf';
export const PAGE_MEDIA_TYPE = 'image/png';

/**
 * Message content for one document sent to OpenRouter. The PDF goes to the model as a `file` part; there is
 * no own OCR, models without native PDF support are handled by OpenRouter.
 */
export function buildContent(pdf: Buffer, text?: string): Exclude<UserContent, string> {
  const file = { type: 'file' as const, data: pdf, mediaType: PDF_MEDIA_TYPE };
  return text === undefined ? [file] : [{ type: 'text', text }, file];
}

/**
 * Message content for Ollama, which does not accept PDFs: the rendered pages (PNG) go as `file` parts with an
 * image media type, in page order. The bytes are passed as base64 text on purpose: `ollama-ai-provider-v2` (4.1) fails
 * on raw bytes together with AI SDK 7 ("Cannot read properties of undefined"), but handles base64 text.
 */
export function buildImageContent(pages: readonly Uint8Array[], text?: string): Exclude<UserContent, string> {
  const images = pages.map((page) => ({
    type: 'file' as const,
    data: Buffer.from(page.buffer, page.byteOffset, page.byteLength).toString('base64'),
    mediaType: PAGE_MEDIA_TYPE,
  }));
  return text === undefined ? images : [{ type: 'text', text }, ...images];
}
