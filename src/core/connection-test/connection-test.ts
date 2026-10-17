import type { AnalyzeOptions, AnalyzeResult } from '../analyzer';
import type { ApiKeyStore } from '../api-key';
import type { SettingsRepository } from '../settings';
import sampleExpected from '../../../assets/sample-scan.expected.json';
import { senderMatches, type SenderExpectation } from './match';

/** Why "Test connection" failed (arc42 §6.2). */
export type ConnectionTestReason =
  | 'invalid_key'
  | 'unknown_model'
  | 'cannot_read_scans'
  | 'no_structured_output'
  | 'offline'
  | 'provider_error';

/** Result of "Test connection". `message` is fixed, user-facing text: never the key, the provider's raw error or document text. */
export type ConnectionTestResult = { ok: true; message: string } | { ok: false; reason: ConnectionTestReason; message: string };

export interface ConnectionTestInput {
  /** Key typed into the settings but not saved yet; defaults to the stored key. */
  key?: string;
  /** Model typed into the settings but not saved yet; defaults to the saved model. */
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
  /** Defaults to `assets/sample-scan.expected.json`. */
  expected?: SampleExpectation;
  /** Default 60 seconds; running into it counts as `offline`. */
  timeoutMs?: number;
}

export const DEFAULT_SAMPLE_EXPECTATION: SampleExpectation = sampleExpected;

const CONNECTION_TEST_TIMEOUT_MS = 60_000;

export const CONNECTION_TEST_MESSAGES = {
  ok: 'Connected · model can read PDFs',
  missingKey: 'Enter your OpenRouter API key first.',
  unreadableKey: 'The saved API key cannot be read any more. Paste it again.',
  invalidKey: 'OpenRouter rejected the API key. Check that you copied the whole key.',
  unknownModel: 'OpenRouter does not know this model, or offers no version of it that accepts PDFs or images. Check the model name.',
  cannotReadScans: 'The model answered, but did not read the sample scan correctly. Choose a model that can read scanned documents.',
  noStructuredOutput: 'The model did not return a structured result. Choose a model that supports structured output.',
  offline: 'OpenRouter cannot be reached. Check your internet connection and try again.',
  providerError: (status?: number) =>
    status === undefined ? 'OpenRouter reported an error. Try again later.' : `OpenRouter reported an error (HTTP ${status}). Try again later.`,
  sampleMissing: 'The sample scan that ships with Filey could not be read. Reinstall Filey.',
} as const;

const fail = (reason: ConnectionTestReason, message: string): ConnectionTestResult => ({ ok: false, reason, message });

/**
 * "Test connection" (arc42 §6.2): runs the real analysis on the bundled sample scan and passes if the
 * sender and date match it. This checks key, model, scan reading and structured output in one request.
 * Never throws.
 */
export function createConnectionTester(deps: ConnectionTesterDeps): (input: ConnectionTestInput) => Promise<ConnectionTestResult> {
  const expected = deps.expected ?? DEFAULT_SAMPLE_EXPECTATION;
  return async (input) => {
    let apiKey = input.key?.trim();
    if (!apiKey) {
      const stored = await deps.apiKeys.get();
      if (stored.status === 'missing') return fail('invalid_key', CONNECTION_TEST_MESSAGES.missingKey);
      if (stored.status === 'unreadable') return fail('invalid_key', CONNECTION_TEST_MESSAGES.unreadableKey);
      apiKey = stored.value;
    }
    const model = input.model?.trim() || deps.settings.getSettings().model;

    let pdf: Buffer;
    try {
      pdf = Buffer.from(await deps.loadSample());
    } catch {
      return fail('provider_error', CONNECTION_TEST_MESSAGES.sampleMissing);
    }

    let result: AnalyzeResult;
    try {
      result = await deps.analyze(pdf, {
        apiKey,
        model,
        rules: deps.settings.listRules(),
        timeoutMs: deps.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS,
      });
    } catch {
      // `analyze` never throws by contract; treat a broken implementation as a provider problem.
      return fail('provider_error', CONNECTION_TEST_MESSAGES.providerError());
    }

    if (!result.ok) {
      const { failure } = result;
      switch (failure.kind) {
        case 'invalid_key':
          return fail('invalid_key', CONNECTION_TEST_MESSAGES.invalidKey);
        case 'offline':
        case 'timeout':
          return fail('offline', CONNECTION_TEST_MESSAGES.offline);
        case 'password_protected':
          // The bundled sample is never password-protected.
          return fail('provider_error', CONNECTION_TEST_MESSAGES.sampleMissing);
        case 'invalid_result':
          return fail('no_structured_output', CONNECTION_TEST_MESSAGES.noStructuredOutput);
        case 'provider_error':
          // 404: unknown model id, or no endpoint of it accepts the PDF/image input.
          return failure.statusCode === 404
            ? fail('unknown_model', CONNECTION_TEST_MESSAGES.unknownModel)
            : fail('provider_error', CONNECTION_TEST_MESSAGES.providerError(failure.statusCode));
      }
    }

    const { info } = result;
    if (info.date !== expected.date || !senderMatches(expected, info.sender)) {
      return fail('cannot_read_scans', CONNECTION_TEST_MESSAGES.cannotReadScans);
    }
    return { ok: true, message: CONNECTION_TEST_MESSAGES.ok };
  };
}
