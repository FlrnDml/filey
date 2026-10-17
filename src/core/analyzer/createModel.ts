import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

export interface CreateModelOptions {
  /** OpenRouter API key from `ApiKeyStore.get()`. Never logged. */
  apiKey: string;
  /** OpenRouter model id, e.g. `google/gemini-2.5-flash`. */
  model: string;
}

/**
 * The single place that knows about the provider (arc42 §5.2). Everything else
 * works with the AI SDK's `LanguageModel`, so another provider only changes this file.
 */
export function createModel({ apiKey, model }: CreateModelOptions): LanguageModel {
  return createOpenRouter({ apiKey }).chat(model);
}
