import type { UserContent } from 'ai';

export const PDF_MEDIA_TYPE = 'application/pdf';

/**
 * Message content for one document. The PDF goes to the model as a `file` part; there is
 * no own OCR, models without native PDF support are handled by OpenRouter.
 */
export function buildContent(pdf: Buffer, text?: string): Exclude<UserContent, string> {
  const file = { type: 'file' as const, data: pdf, mediaType: PDF_MEDIA_TYPE };
  return text === undefined ? [file] : [{ type: 'text', text }, file];
}
