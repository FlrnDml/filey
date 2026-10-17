import { describe, expect, it } from 'vitest';
import { API_KEY_SECRET_NAME, ApiKeyError, createApiKeyStore, InMemorySecretStore } from '.';

const KEY = 'sk-or-v1-super-secret';

/** Simulates safeStorage failing to decrypt, or encryption being unavailable. Errors embed the secret on purpose. */
class FailingSecretStore extends InMemorySecretStore {
  failGet = false;
  failSet = false;
  override async get(key: string) {
    if (this.failGet) throw new Error(`cannot decrypt ${this.values.get(key)}`);
    return super.get(key);
  }
  override async set(key: string, value: string) {
    if (this.failSet) throw new Error(`encryption unavailable for ${value}`);
    return super.set(key, value);
  }
}

describe('ApiKeyStore', () => {
  it('reports missing when nothing is stored', async () => {
    const store = createApiKeyStore(new InMemorySecretStore());
    expect(await store.get()).toEqual({ status: 'missing' });
    expect(await store.status()).toBe('missing');
  });

  it('stores the trimmed key and returns it', async () => {
    const secrets = new InMemorySecretStore();
    const store = createApiKeyStore(secrets);
    await store.set(`  ${KEY}\n`);
    expect(secrets.values.get(API_KEY_SECRET_NAME)).toBe(KEY);
    expect(await store.get()).toEqual({ status: 'ok', value: KEY });
    expect(await store.status()).toBe('set');
  });

  it('rejects empty and whitespace-only keys without touching the store', async () => {
    const secrets = new InMemorySecretStore();
    const store = createApiKeyStore(secrets);
    for (const value of ['', '   ', '\n\t']) {
      await expect(store.set(value)).rejects.toMatchObject({ reason: 'empty' });
    }
    expect(secrets.values.size).toBe(0);
  });

  it('reports unreadable when the stored key cannot be decrypted', async () => {
    const secrets = new FailingSecretStore();
    secrets.values.set(API_KEY_SECRET_NAME, 'blob');
    secrets.failGet = true;
    const store = createApiKeyStore(secrets);
    expect(await store.get()).toEqual({ status: 'unreadable' });
    expect(await store.status()).toBe('unreadable');
  });

  it('reports unreadable for an empty decrypted value', async () => {
    const secrets = new InMemorySecretStore();
    secrets.values.set(API_KEY_SECRET_NAME, '  ');
    expect(await createApiKeyStore(secrets).get()).toEqual({ status: 'unreadable' });
  });

  it('recovers from unreadable by saving a new key', async () => {
    const secrets = new FailingSecretStore();
    secrets.values.set(API_KEY_SECRET_NAME, 'blob');
    secrets.failGet = true;
    const store = createApiKeyStore(secrets);
    expect((await store.get()).status).toBe('unreadable');
    secrets.failGet = false;
    await store.set(KEY);
    expect(await store.get()).toEqual({ status: 'ok', value: KEY });
  });

  it('clear removes the key', async () => {
    const secrets = new InMemorySecretStore();
    const store = createApiKeyStore(secrets);
    await store.set(KEY);
    await store.clear();
    expect(await store.get()).toEqual({ status: 'missing' });
    expect(secrets.values.size).toBe(0);
  });

  it('notifies listeners about status changes until they unsubscribe', async () => {
    const store = createApiKeyStore(new InMemorySecretStore());
    const seen: string[] = [];
    const unsubscribe = store.onStatusChange((status) => seen.push(status));
    await store.set(KEY);
    await store.clear();
    unsubscribe();
    await store.set(KEY);
    expect(seen).toEqual(['set', 'missing']);
  });

  it('never leaks the key through errors or results', async () => {
    const failingSet = new FailingSecretStore();
    failingSet.failSet = true;
    const error = (await createApiKeyStore(failingSet)
      .set(KEY)
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ApiKeyError);
    expect(error).toMatchObject({ reason: 'storage-unavailable' });
    expect(error.message).not.toContain(KEY);
    expect(error.stack).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(error.cause).toBeUndefined();

    const failingGet = new FailingSecretStore();
    failingGet.values.set(API_KEY_SECRET_NAME, KEY);
    failingGet.failGet = true;
    expect(JSON.stringify(await createApiKeyStore(failingGet).get())).not.toContain(KEY);
  });
});
