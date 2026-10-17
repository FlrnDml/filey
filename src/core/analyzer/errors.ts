import { APICallError, JSONParseError, NoObjectGeneratedError, RetryError, TypeValidationError } from 'ai';

/**
 * Why an analysis failed. Messages are fixed text: they never contain the API key,
 * document contents or the provider's raw error.
 */
export type AnalyzeFailure =
  /** The model answered, but not with a valid result. The import fails and the file stays in the inbox. */
  | { kind: 'invalid_result'; message: string }
  /** The PDF can only be opened with a password, so no model can read it. Checked before anything is sent. */
  | { kind: 'password_protected'; message: string }
  /** OpenRouter rejected the key (HTTP 401/403). */
  | { kind: 'invalid_key'; message: string }
  /** OpenRouter could not be reached. Not a failure: the import is queued (arc42 §6.7). */
  | { kind: 'offline'; message: string }
  /**
   * No answer within the timeout. The import service queues it like `offline` when the Mac has no connection and
   * fails it otherwise, so a document the model cannot handle does not stay in "Analyzing…" forever.
   */
  | { kind: 'timeout'; message: string }
  /** Any other provider error, e.g. unknown model (404), no credits (402) or rate limit (429). */
  | { kind: 'provider_error'; message: string; statusCode?: number };

export type AnalyzeFailureKind = AnalyzeFailure['kind'];

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Walks `cause` and wrapped retry errors, so the original network error is found. */
function* chain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = RetryError.isInstance(current) ? current.lastError : (current as { cause?: unknown }).cause;
  }
}

function isNetworkError(error: unknown): boolean {
  for (const e of chain(error)) {
    const { name, code, message } = e as { name?: unknown; code?: unknown; message?: unknown };
    if (name === 'AbortError') return true;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
    // `fetch` rejects with a bare `TypeError: fetch failed` when there is no connection.
    if (e instanceof TypeError && typeof message === 'string' && /fetch failed|network/i.test(message)) return true;
  }
  return false;
}

/** Maps anything thrown by `generateObject` to a typed failure. */
export function classifyError(error: unknown): AnalyzeFailure {
  for (const e of chain(error)) {
    if (APICallError.isInstance(e) && e.statusCode !== undefined) {
      if (e.statusCode === 401 || e.statusCode === 403) {
        return { kind: 'invalid_key', message: 'OpenRouter rejected the API key' };
      }
      return { kind: 'provider_error', message: `OpenRouter returned HTTP ${e.statusCode}`, statusCode: e.statusCode };
    }
  }
  for (const e of chain(error)) {
    if ((e as { name?: unknown }).name === 'TimeoutError') return { kind: 'timeout', message: 'The analysis timed out' };
  }
  if (isNetworkError(error)) return { kind: 'offline', message: 'OpenRouter cannot be reached' };
  for (const e of chain(error)) {
    if (NoObjectGeneratedError.isInstance(e) || TypeValidationError.isInstance(e) || JSONParseError.isInstance(e)) {
      return { kind: 'invalid_result', message: 'The model did not return a valid result' };
    }
  }
  return { kind: 'provider_error', message: 'The analysis failed unexpectedly' };
}
