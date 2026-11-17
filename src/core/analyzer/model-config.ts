import type { ApiKeyStore } from '../api-key';
import type { Settings } from '../settings';
import type { ModelConfig } from './createModel';

export type ModelConfigResult = { ok: true; config: ModelConfig } | { ok: false; reason: 'missing-key' | 'unreadable-key'; message: string };

export const MODEL_CONFIG_MESSAGES = {
  'missing-key': 'Add your OpenRouter API key under Provider first.',
  'unreadable-key': 'Filey cannot read the saved OpenRouter API key. Enter it again under Provider.',
} as const;

/**
 * The provider and model of the saved settings, for requests the user starts in Settings ("Suggest descriptions",
 * "Suggest names"). For OpenRouter the key comes from the Keychain; without a usable key the result says why.
 */
export async function resolveModelConfig(
  settings: Pick<Settings, 'provider' | 'model' | 'ollamaUrl' | 'ollamaModel'>,
  apiKeys: Pick<ApiKeyStore, 'get'>,
): Promise<ModelConfigResult> {
  if (settings.provider === 'ollama') return { ok: true, config: { provider: 'ollama', baseUrl: settings.ollamaUrl, model: settings.ollamaModel } };
  const key = await apiKeys.get();
  if (key.status === 'ok') return { ok: true, config: { provider: 'openrouter', apiKey: key.value, model: settings.model } };
  const reason = key.status === 'missing' ? 'missing-key' : 'unreadable-key';
  return { ok: false, reason, message: MODEL_CONFIG_MESSAGES[reason] };
}
