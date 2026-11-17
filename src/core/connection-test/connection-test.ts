import type { AnalyzeOptions, AnalyzeResult } from '../analyzer';
import type { ApiKeyStore } from '../api-key';
import { OLLAMA_MESSAGES, type OllamaClient } from '../ollama/client';
import { isModelInstalled } from '../ollama/models';
import type { SettingsRepository } from '../settings';
import sampleExpected from '../../../assets/sample-scan.expected.json';
import { senderMatches, type SenderExpectation } from './match';

/** Why "Test connection" failed (arc42 §6.2). */
export type ConnectionTestReason =
  | 'invalid_key'
  | 'server_not_running'
  | 'model_not_installed'
  | 'unknown_model'
  | 'cannot_read_scans'
  | 'no_structured_output'
  | 'offline'
  | 'provider_error';

/** Result of "Test connection". `message` is fixed, user-facing text: never the key, the provider's raw error or document text. */
export type ConnectionTestResult = { ok: true; message: string } | { ok: false; reason: ConnectionTestReason; message: string };

export interface ConnectionTestInput {
  /** Provider typed or chosen in the settings but not saved yet; defaults to the saved provider. */
  provider?: 'openrouter' | 'ollama';
  /** OpenRouter key typed into the settings but not saved yet; defaults to the stored key. Ignored for Ollama. */
  key?: string;
  /** Model typed into the settings but not saved yet (an OpenRouter model, or an Ollama model for `provider: 'ollama'`); defaults to the saved model. */
  model?: string;
}

/** Known values of the bundled sample scan (`assets/sample-scan.pdf`, a fictitious health-insurer letter). */
export interface SampleExpectation extends SenderExpectation {
  /** `YYYY-MM-DD`. */
  date: string;
}

export interface ConnectionTesterDeps {
  /** `analyze` from `core/analyzer`; injected so tests need no model. */
  analyze: (pdf: Buffer, options: AnalyzeOptions) => Promise<AnalyzeResult>;
  /** Reads the bundled sample scan. */
  loadSample: () => Promise<Uint8Array>;
  apiKeys: Pick<ApiKeyStore, 'get'>;
  settings: Pick<SettingsRepository, 'getSettings' | 'listRules'>;
  /** Asks Ollama whether it runs and which models are installed; needed for the Ollama provider. */
  ollama?: Pick<OllamaClient, 'status'>;
  /** Defaults to `assets/sample-scan.expected.json`. */
  expected?: SampleExpectation;
  /** Default 60 seconds (3 minutes for Ollama, which loads the model first); running into it counts as `offline`. */
  timeoutMs?: number;
}

export const DEFAULT_SAMPLE_EXPECTATION: SampleExpectation = sampleExpected;

const CONNECTION_TEST_TIMEOUT_MS = 60_000;
const OLLAMA_TEST_TIMEOUT_MS = 180_000;

export const CONNECTION_TEST_MESSAGES = {
  ok: 'Connected · model can read PDFs',
  okOllama: 'Connected · model can read scans',
  missingKey: 'Enter your OpenRouter API key first.',
  unreadableKey: 'The saved API key cannot be read any more. Paste it again.',
  invalidKey: 'OpenRouter rejected the API key. Check that you copied the whole key.',
  unknownModel: 'OpenRouter does not know this model, or offers no version of it that accepts PDFs or images. Check the model name.',
  cannotReadScans: 'The model answered, but did not read the sample scan correctly. Choose a model that can read scanned documents.',
  noStructuredOutput: 'The model did not return a structured result. Choose a model that supports structured output.',
  offline: 'OpenRouter cannot be reached. Check your internet connection and try again.',
  providerError: (status?: number, provider: 'openrouter' | 'ollama' = 'openrouter') => {
    const name = provider === 'ollama' ? 'Ollama' : 'OpenRouter';
    return status === undefined ? `${name} reported an error. Try again later.` : `${name} reported an error (HTTP ${status}). Try again later.`;
  },
  ollamaNotRunning: OLLAMA_MESSAGES.notRunning,
  ollamaModelNotInstalled: (model: string) => `The model ${model} is not installed. Download it first.`,
  ollamaTimeout: 'Ollama did not answer in time. The model may still be loading, so try again in a minute.',
  renderFailed: 'The sample scan could not be turned into images. Try again, or restart Filey.',
  sampleMissing: 'The sample scan that ships with Filey could not be read. Reinstall Filey.',
} as const;

const fail = (reason: ConnectionTestReason, message: string): ConnectionTestResult => ({ ok: false, reason, message });

/**
 * "Test connection" (arc42 §6.2): runs the real analysis on the bundled sample scan and passes if the
 * sender and date match it. This checks provider, key, model, scan reading and structured output in one request.
 * For Ollama it first asks whether Ollama runs and the model is installed, so those two problems get their own
 * message without waiting for a model load. Never throws.
 */
export function createConnectionTester(deps: ConnectionTesterDeps): (input: ConnectionTestInput) => Promise<ConnectionTestResult> {
  const expected = deps.expected ?? DEFAULT_SAMPLE_EXPECTATION;
  return async (input) => {
    const saved = deps.settings.getSettings();
    const provider = input.provider ?? saved.provider;
    const typedModel = input.model?.trim();

    let config: AnalyzeOptions['config'];
    if (provider === 'ollama') {
      const model = typedModel || saved.ollamaModel;
      if (deps.ollama) {
        const status = await deps.ollama.status(saved.ollamaUrl);
        if (!status.running) return fail('server_not_running', CONNECTION_TEST_MESSAGES.ollamaNotRunning);
        if (!isModelInstalled(status.models, model)) return fail('model_not_installed', CONNECTION_TEST_MESSAGES.ollamaModelNotInstalled(model));
      }
      config = { provider: 'ollama', baseUrl: saved.ollamaUrl, model };
    } else {
      let apiKey = input.key?.trim();
      if (!apiKey) {
        const stored = await deps.apiKeys.get();
        if (stored.status === 'missing') return fail('invalid_key', CONNECTION_TEST_MESSAGES.missingKey);
        if (stored.status === 'unreadable') return fail('invalid_key', CONNECTION_TEST_MESSAGES.unreadableKey);
        apiKey = stored.value;
      }
      config = { provider: 'openrouter', apiKey, model: typedModel || saved.model };
    }

    let pdf: Buffer;
    try {
      pdf = Buffer.from(await deps.loadSample());
    } catch {
      return fail('provider_error', CONNECTION_TEST_MESSAGES.sampleMissing);
    }

    let result: AnalyzeResult;
    try {
      result = await deps.analyze(pdf, {
        config,
        rules: deps.settings.listRules(),
        timeoutMs: deps.timeoutMs ?? (provider === 'ollama' ? OLLAMA_TEST_TIMEOUT_MS : CONNECTION_TEST_TIMEOUT_MS),
      });
    } catch {
      // `analyze` never throws by contract; treat a broken implementation as a provider problem.
      return fail('provider_error', CONNECTION_TEST_MESSAGES.providerError(undefined, provider));
    }

    if (!result.ok) {
      const { failure } = result;
      switch (failure.kind) {
        case 'invalid_key':
          return fail('invalid_key', CONNECTION_TEST_MESSAGES.invalidKey);
        case 'offline':
          return provider === 'ollama'
            ? fail('server_not_running', CONNECTION_TEST_MESSAGES.ollamaNotRunning)
            : fail('offline', CONNECTION_TEST_MESSAGES.offline);
        case 'timeout':
          return provider === 'ollama' ? fail('offline', CONNECTION_TEST_MESSAGES.ollamaTimeout) : fail('offline', CONNECTION_TEST_MESSAGES.offline);
        case 'password_protected':
          // The bundled sample is never password-protected.
          return fail('provider_error', CONNECTION_TEST_MESSAGES.sampleMissing);
        case 'render_failed':
          return fail('provider_error', CONNECTION_TEST_MESSAGES.renderFailed);
        case 'invalid_result':
          return fail('no_structured_output', CONNECTION_TEST_MESSAGES.noStructuredOutput);
        case 'provider_error':
          // 404: unknown model id (OpenRouter: or no endpoint of it accepts the PDF/image input), or a model Ollama does not have.
          if (failure.statusCode === 404) {
            return provider === 'ollama'
              ? fail('model_not_installed', CONNECTION_TEST_MESSAGES.ollamaModelNotInstalled(config.model))
              : fail('unknown_model', CONNECTION_TEST_MESSAGES.unknownModel);
          }
          return fail('provider_error', CONNECTION_TEST_MESSAGES.providerError(failure.statusCode, provider));
      }
    }

    const { info } = result;
    if (info.date !== expected.date || !senderMatches(expected, info.sender)) {
      return fail('cannot_read_scans', CONNECTION_TEST_MESSAGES.cannotReadScans);
    }
    return { ok: true, message: provider === 'ollama' ? CONNECTION_TEST_MESSAGES.okOllama : CONNECTION_TEST_MESSAGES.ok };
  };
}
