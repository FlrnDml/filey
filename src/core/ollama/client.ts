import type { OllamaPullProgress, OllamaPullResult, OllamaStatus } from './types';

/** The few calls Filey makes to Ollama's native API (arc42 §8 "AI provider"). Only for model management and reachability. */
export interface OllamaClient {
  status(baseUrl: string): Promise<OllamaStatus>;
  /** Whether the server answers `GET /api/version` in time. Never rejects. */
  isReachable(baseUrl: string): Promise<boolean>;
  /** Downloads a model (`POST /api/pull`) and reports progress. Never rejects; cancel with `signal`. */
  pull(baseUrl: string, model: string, onProgress: (progress: OllamaPullProgress) => void, signal?: AbortSignal): Promise<OllamaPullResult>;
}

export interface OllamaClientDeps {
  /** The global `fetch` in the main process; injected so tests need no server. */
  fetch: typeof fetch;
  /** Milliseconds, for throttling progress updates. Defaults to `Date.now`. */
  now?: () => number;
}

/** How long Ollama gets to answer a status or reachability request. */
export const OLLAMA_REQUEST_TIMEOUT_MS = 2_000;
/** Progress updates of the same step are passed on at most this often. */
export const PROGRESS_INTERVAL_MS = 250;

export const OLLAMA_MESSAGES = {
  notRunning: 'Ollama is not running. Start Ollama and try again.',
  unknownModel: 'Ollama does not know this model. Check the model name.',
  cancelled: 'The download was cancelled.',
  failed: 'The model could not be downloaded. Check your internet connection and the free disk space.',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function createOllamaClient({ fetch: fetchFn, now = Date.now }: OllamaClientDeps): OllamaClient {
  async function status(baseUrl: string): Promise<OllamaStatus> {
    let version: unknown;
    try {
      const body = await getJson(fetchFn, `${baseUrl}/api/version`);
      version = isRecord(body) ? body.version : undefined;
    } catch {
      return { running: false, models: [] };
    }
    let models: string[] = [];
    try {
      const tags = await getJson(fetchFn, `${baseUrl}/api/tags`);
      if (isRecord(tags) && Array.isArray(tags.models)) {
        models = tags.models.flatMap((m) => (isRecord(m) && typeof m.name === 'string' ? [m.name] : []));
      }
    } catch {
      // Running, but the model list is unavailable: show it as empty instead of claiming Ollama is down.
    }
    return { running: true, ...(typeof version === 'string' ? { version } : {}), models };
  }

  return {
    status,

    async isReachable(baseUrl) {
      try {
        await getJson(fetchFn, `${baseUrl}/api/version`);
        return true;
      } catch {
        return false;
      }
    },

    async pull(baseUrl, model, onProgress, signal) {
      let lastStatus = '';
      let lastEmit = Number.NEGATIVE_INFINITY;
      const emit = (progress: OllamaPullProgress) => {
        const time = now();
        // A new step is always reported; updates within one step are throttled.
        if (progress.status === lastStatus && time - lastEmit < PROGRESS_INTERVAL_MS) return;
        lastStatus = progress.status;
        lastEmit = time;
        onProgress(progress);
      };
      try {
        const response = await fetchFn(`${baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: true }),
          ...(signal ? { signal } : {}),
        });
        if (!response.ok || !response.body) {
          // Ollama answers 4xx/5xx with `{error}` for names it cannot resolve.
          const unknown = response.status === 404 || response.status === 400;
          return unknown
            ? { ok: false, reason: 'unknown-model', message: OLLAMA_MESSAGES.unknownModel }
            : { ok: false, reason: 'failed', message: OLLAMA_MESSAGES.failed };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let succeeded = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line === '') continue;
            let message: unknown;
            try {
              message = JSON.parse(line);
            } catch {
              continue; // not a progress line
            }
            if (!isRecord(message)) continue;
            if (typeof message.error === 'string') {
              const unknown = /file does not exist|not found|invalid model|pull model manifest/i.test(message.error);
              return unknown
                ? { ok: false, reason: 'unknown-model', message: OLLAMA_MESSAGES.unknownModel }
                : { ok: false, reason: 'failed', message: OLLAMA_MESSAGES.failed };
            }
            if (typeof message.status !== 'string') continue;
            if (message.status === 'success') succeeded = true;
            emit({
              model,
              status: message.status,
              ...(typeof message.completed === 'number' ? { completed: message.completed } : {}),
              ...(typeof message.total === 'number' ? { total: message.total } : {}),
            });
          }
        }
        return succeeded ? { ok: true } : { ok: false, reason: 'failed', message: OLLAMA_MESSAGES.failed };
      } catch (error) {
        if (signal?.aborted) return { ok: false, reason: 'cancelled', message: OLLAMA_MESSAGES.cancelled };
        // `fetch` rejects with `TypeError: fetch failed` when nothing listens on the address.
        if (error instanceof TypeError) return { ok: false, reason: 'not-running', message: OLLAMA_MESSAGES.notRunning };
        return { ok: false, reason: 'failed', message: OLLAMA_MESSAGES.failed };
      }
    },
  };
}
