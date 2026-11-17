import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';

/** Context window Filey asks Ollama for. Ollama's default is about 4k tokens on Macs with less than 24 GB, too small for three page images (arc42 §8). */
export const OLLAMA_NUM_CTX = 8192;

/** Which provider and model an analysis uses. Built from the settings (and the Keychain for OpenRouter) by the caller. */
export type ModelConfig =
  | {
      provider: 'openrouter';
      /** OpenRouter API key from `ApiKeyStore.get()`. Never logged. */
      apiKey: string;
      /** OpenRouter model id, e.g. `google/gemini-2.5-flash`. */
      model: string;
    }
  | {
      provider: 'ollama';
      /** Address of Ollama on this Mac, without a trailing slash, e.g. `http://localhost:11434`. */
      baseUrl: string;
      /** Ollama model name, e.g. `qwen2.5vl:7b`. */
      model: string;
    };

/**
 * The single place that knows about the providers (arc42 §5.2). Everything else works with the AI SDK's
 * `LanguageModel`, so another provider only changes this file.
 */
export function createModel(config: ModelConfig): LanguageModel {
  if (config.provider === 'ollama') {
    // Ollama's native API (not `/v1`), because only that accepts `num_ctx` per request. The provider ignores model
    // settings, so the option is sent as a default provider option on every call.
    return wrapLanguageModel({
      model: createOllama({ baseURL: `${config.baseUrl}/api`, compatibility: 'strict' }).chat(config.model),
      middleware: defaultSettingsMiddleware({ settings: { providerOptions: { ollama: { options: { num_ctx: OLLAMA_NUM_CTX } } } } }),
    });
  }
  return createOpenRouter({ apiKey: config.apiKey }).chat(config.model);
}
