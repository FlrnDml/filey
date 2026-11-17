import { generateObject as aiGenerateObject, type LanguageModel } from 'ai';
import type { PageRenderer } from '../ports';
import type { FolderRule } from '../settings';
import { buildContent, buildImageContent } from './buildContent';
import { createModel, type ModelConfig } from './createModel';
import { classifyError, type AnalyzeFailure } from './errors';
import { needsPassword } from './pdf-password';
import { buildPrompt } from './prompt';
import { createDocumentInfoSchema, type DocumentInfo } from './schema';

export type AnalyzeResult = { ok: true; info: DocumentInfo } | { ok: false; failure: AnalyzeFailure };

export interface AnalyzeOptions {
  /** Provider and model; for OpenRouter with the key from `ApiKeyStore.get()` (the caller handles missing/unreadable keys). */
  config: ModelConfig;
  /** The user's folder rules from the settings repository. */
  rules: readonly FolderRule[];
  /** Overall timeout; running into it is a `timeout` failure. Default 2 minutes (OpenRouter) or 5 minutes (Ollama). */
  timeoutMs?: number;
}

/** Injection points so tests need neither network nor the provider. */
export interface AnalyzeDeps {
  generateObject?: typeof aiGenerateObject;
  createModel?: (config: ModelConfig) => LanguageModel;
  /** Needed for Ollama only: renders the first pages of the PDF to images. */
  pageRenderer?: PageRenderer;
}

/** Ollama gets the first pages only: date, sender and title are almost always there, and every page costs about 1,000 tokens. */
export const OLLAMA_MAX_PAGES = 3;
/** Longer edge of a page image sent to Ollama, in pixels. */
export const OLLAMA_MAX_EDGE_PX = 1024;

const DEFAULT_TIMEOUT_MS = 120_000;
/** A local model is slower, and the first request after a pause includes loading it into memory. */
const OLLAMA_TIMEOUT_MS = 300_000;

/**
 * Sends the document with the prompt to the model and returns validated `{date, sender, title, category}`
 * or a typed failure. OpenRouter gets the PDF, Ollama the first pages as images. A password-protected PDF fails
 * right away without being sent. Never throws for model, key or network problems; missing values come back as `null`
 * (the Filer applies the fallbacks from arc42 §5.2).
 */
export async function analyze(pdf: Buffer, options: AnalyzeOptions, deps: AnalyzeDeps = {}): Promise<AnalyzeResult> {
  const generateObject = deps.generateObject ?? aiGenerateObject;
  const makeModel = deps.createModel ?? createModel;
  const { config } = options;
  if (needsPassword(pdf)) {
    return { ok: false, failure: { kind: 'password_protected', message: 'The PDF is password-protected' } };
  }
  const text = 'Classify the attached document.';
  let content;
  if (config.provider === 'ollama') {
    try {
      if (!deps.pageRenderer) throw new Error('No page renderer');
      const pages = await deps.pageRenderer.render(pdf, { maxPages: OLLAMA_MAX_PAGES, maxEdgePx: OLLAMA_MAX_EDGE_PX });
      if (pages.length === 0) throw new Error('No pages');
      content = buildImageContent(pages, text);
    } catch {
      return { ok: false, failure: { kind: 'render_failed', message: 'The PDF could not be turned into images' } };
    }
  } else {
    content = buildContent(pdf, text);
  }
  try {
    const { object } = await generateObject({
      model: makeModel(config),
      schema: createDocumentInfoSchema(options.rules),
      schemaName: 'DocumentInfo',
      instructions: buildPrompt(options.rules),
      messages: [{ role: 'user', content }],
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? (config.provider === 'ollama' ? OLLAMA_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)),
    });
    return { ok: true, info: object };
  } catch (error) {
    return { ok: false, failure: classifyError(error, config.provider) };
  }
}
