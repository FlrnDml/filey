import { generateObject as aiGenerateObject, type LanguageModel } from 'ai';
import type { FolderRule } from '../settings';
import { buildContent } from './buildContent';
import { createModel } from './createModel';
import { classifyError, type AnalyzeFailure } from './errors';
import { needsPassword } from './pdf-password';
import { buildPrompt } from './prompt';
import { createDocumentInfoSchema, type DocumentInfo } from './schema';

export type AnalyzeResult = { ok: true; info: DocumentInfo } | { ok: false; failure: AnalyzeFailure };

export interface AnalyzeOptions {
  /** OpenRouter API key from `ApiKeyStore.get()`; the caller handles missing/unreadable keys. */
  apiKey: string;
  /** Model id from the settings. */
  model: string;
  /** The user's folder rules from the settings repository. */
  rules: readonly FolderRule[];
  /** Overall timeout; running into it is a `timeout` failure. Default 2 minutes. */
  timeoutMs?: number;
}

/** Injection points so tests need neither network nor the provider. */
export interface AnalyzeDeps {
  generateObject?: typeof aiGenerateObject;
  createModel?: (options: { apiKey: string; model: string }) => LanguageModel;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Sends the PDF with the prompt to the model and returns validated `{date, sender, title, category}`
 * or a typed failure. A password-protected PDF fails right away without being sent. Never throws for model, key or network problems; missing values come back as `null`
 * (the Filer applies the fallbacks from arc42 §5.2).
 */
export async function analyze(pdf: Buffer, options: AnalyzeOptions, deps: AnalyzeDeps = {}): Promise<AnalyzeResult> {
  const generateObject = deps.generateObject ?? aiGenerateObject;
  const makeModel = deps.createModel ?? createModel;
  if (needsPassword(pdf)) {
    return { ok: false, failure: { kind: 'password_protected', message: 'The PDF is password-protected' } };
  }
  try {
    const { object } = await generateObject({
      model: makeModel({ apiKey: options.apiKey, model: options.model }),
      schema: createDocumentInfoSchema(options.rules),
      schemaName: 'DocumentInfo',
      instructions: buildPrompt(options.rules),
      messages: [{ role: 'user', content: buildContent(pdf, 'Classify the attached document.') }],
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return { ok: true, info: object };
  } catch (error) {
    return { ok: false, failure: classifyError(error) };
  }
}
