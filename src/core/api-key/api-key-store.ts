import type { SecretStore } from '../ports';

/** Name under which the OpenRouter key lives in the `SecretStore`. */
export const API_KEY_SECRET_NAME = 'openrouter-api-key';

/** Result of reading the key. Only main-process code may see `value`; see `ApiKeyStatus` for what may leave it. */
export type ApiKeyResult =
  | { status: 'ok'; value: string }
  | { status: 'missing' }
  /** A key was stored but cannot be decrypted (arc42 §6.6, §11 risk 6): pause imports and ask the user again. */
  | { status: 'unreadable' };

/** Safe to expose to the renderer or to other modules: never contains the key. */
export type ApiKeyStatus = 'set' | 'missing' | 'unreadable';

/** Thrown by `set`. The message is fixed text and never contains the key. */
export class ApiKeyError extends Error {
  constructor(readonly reason: 'empty' | 'storage-unavailable') {
    super(reason === 'empty' ? 'The API key must not be empty' : 'The API key could not be stored securely');
    this.name = 'ApiKeyError';
  }
}

export interface ApiKeyStore {
  /** Reads the key. Never throws: a stored key that cannot be read is reported as `unreadable`. */
  get(): Promise<ApiKeyResult>;
  /** Stores the trimmed key encrypted. Throws `ApiKeyError` for an empty key or unavailable encryption. */
  set(value: string): Promise<void>;
  /** Removes the key, including an unreadable one. */
  clear(): Promise<void>;
  /** Current state without exposing the key. */
  status(): Promise<ApiKeyStatus>;
  /** Called after `set`/`clear` with the new status, so imports can resume or pause. Returns an unsubscribe function. */
  onStatusChange(listener: (status: ApiKeyStatus) => void): () => void;
}

/** Wraps a `SecretStore` (encrypted at rest) with the API key semantics (arc42 §6.6, §8 "Secrets"). */
export function createApiKeyStore(secrets: SecretStore): ApiKeyStore {
  const listeners = new Set<(status: ApiKeyStatus) => void>();
  const notify = (status: ApiKeyStatus) => listeners.forEach((listener) => listener(status));

  const get = async (): Promise<ApiKeyResult> => {
    try {
      const value = await secrets.get(API_KEY_SECRET_NAME);
      if (value === undefined) return { status: 'missing' };
      // An empty decrypted value is as useless as one that cannot be decrypted.
      return value.trim() === '' ? { status: 'unreadable' } : { status: 'ok', value };
    } catch {
      // Deliberately drop the original error: it may carry details of the secret store.
      return { status: 'unreadable' };
    }
  };

  return {
    get,
    async set(value) {
      const key = value.trim();
      if (key === '') throw new ApiKeyError('empty');
      try {
        await secrets.set(API_KEY_SECRET_NAME, key);
      } catch {
        throw new ApiKeyError('storage-unavailable');
      }
      notify('set');
    },
    async clear() {
      await secrets.delete(API_KEY_SECRET_NAME);
      notify('missing');
    },
    async status() {
      const result = await get();
      return result.status === 'ok' ? 'set' : result.status;
    },
    onStatusChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** In-memory `SecretStore` for tests. Stores values as given (no encryption). */
export class InMemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}
