import { describe, expect, it, vi } from 'vitest';
import { createOllamaClient, OLLAMA_MESSAGES } from './client';
import { isModelInstalled } from './models';
import type { OllamaPullProgress } from './types';

const BASE = 'http://localhost:11434';
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

/** A streaming `/api/pull` answer made of the given lines (objects are sent as one JSON line each). */
function ndjson(lines: (object | string)[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  // Split inside a line, so the parser must buffer across chunks.
  const middle = Math.floor(text.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, middle)));
      controller.enqueue(encoder.encode(text.slice(middle)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, now = () => 0) {
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  return { fetchFn, client: createOllamaClient({ fetch: fetchFn as unknown as typeof fetch, now }) };
}

const refused = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));

describe('isModelInstalled', () => {
  it('treats a name without tag as :latest and ignores surrounding spaces', () => {
    expect(isModelInstalled(['qwen2.5vl:7b'], ' qwen2.5vl:7b ')).toBe(true);
    expect(isModelInstalled(['gemma3:latest'], 'gemma3')).toBe(true);
    expect(isModelInstalled(['gemma3'], 'gemma3:latest')).toBe(true);
    expect(isModelInstalled(['gemma3:4b'], 'gemma3')).toBe(false);
    expect(isModelInstalled([], 'gemma3')).toBe(false);
  });
});

describe('status', () => {
  it('reports the version and the installed models', async () => {
    const { client: c, fetchFn } = client((url) =>
      url.endsWith('/api/version') ? json({ version: '0.12.3' }) : json({ models: [{ name: 'qwen2.5vl:7b' }, { name: 'gemma3:4b' }, { nope: 1 }] }),
    );
    await expect(c.status(BASE)).resolves.toEqual({ running: true, version: '0.12.3', models: ['qwen2.5vl:7b', 'gemma3:4b'] });
    expect(fetchFn.mock.calls.map((call) => String(call[0]))).toEqual([`${BASE}/api/version`, `${BASE}/api/tags`]);
  });

  it('says it is not running when nothing answers', async () => {
    const { client: c } = client(refused);
    await expect(c.status(BASE)).resolves.toEqual({ running: false, models: [] });
  });

  it('is still running when only the model list fails', async () => {
    const { client: c } = client((url) => (url.endsWith('/api/version') ? json({ version: '1.0.0' }) : new Response('x', { status: 500 })));
    await expect(c.status(BASE)).resolves.toEqual({ running: true, version: '1.0.0', models: [] });
  });

  it('gives each request a short timeout', async () => {
    const { client: c, fetchFn } = client(() => json({ version: '1' }));
    await c.status(BASE);
    expect(fetchFn.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('isReachable', () => {
  it('is true when the version answers and false otherwise, never rejecting', async () => {
    await expect(client(() => json({ version: '1' })).client.isReachable(BASE)).resolves.toBe(true);
    await expect(client(refused).client.isReachable(BASE)).resolves.toBe(false);
    await expect(client(() => new Response('', { status: 500 })).client.isReachable(BASE)).resolves.toBe(false);
  });
});

describe('pull', () => {
  const run = (c: ReturnType<typeof client>['client'], signal?: AbortSignal) => {
    const seen: OllamaPullProgress[] = [];
    return c.pull(BASE, 'qwen2.5vl:7b', (p) => seen.push(p), signal).then((result) => ({ result, seen }));
  };

  it('posts the model with streaming and reports progress until success', async () => {
    const { client: c, fetchFn } = client(() =>
      ndjson([{ status: 'pulling manifest' }, { status: 'pulling abc', total: 100, completed: 40 }, { status: 'verifying sha256 digest' }, { status: 'success' }]),
    );
    const { result, seen } = await run(c);
    expect(result).toEqual({ ok: true });
    expect(seen.map((p) => p.status)).toEqual(['pulling manifest', 'pulling abc', 'verifying sha256 digest', 'success']);
    expect(seen[1]).toEqual({ model: 'qwen2.5vl:7b', status: 'pulling abc', total: 100, completed: 40 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/api/pull`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'qwen2.5vl:7b', stream: true });
  });

  it('throttles updates of the same step but always reports a new step', async () => {
    const lines = [
      { status: 'pulling abc', total: 100, completed: 1 },
      { status: 'pulling abc', total: 100, completed: 2 },
      { status: 'pulling abc', total: 100, completed: 3 },
      { status: 'success' },
    ];
    const { client: c } = client(() => ndjson(lines), () => 0);
    const { seen } = await run(c);
    // All four arrive at the same millisecond: the first of the step and the new step `success` get through.
    expect(seen.map((p) => p.completed ?? p.status)).toEqual([1, 'success']);
  });

  it('ignores lines that are not JSON', async () => {
    const { client: c } = client(() => ndjson(['not json', { status: 'success' }]));
    await expect(run(c)).resolves.toMatchObject({ result: { ok: true } });
  });

  it('maps an unknown model to a clear message', async () => {
    const lines = [{ error: 'pull model manifest: file does not exist' }];
    await expect(run(client(() => ndjson(lines)).client)).resolves.toMatchObject({
      result: { ok: false, reason: 'unknown-model', message: OLLAMA_MESSAGES.unknownModel },
    });
    await expect(run(client(() => new Response('{"error":"x"}', { status: 404 })).client)).resolves.toMatchObject({ result: { ok: false, reason: 'unknown-model' } });
  });

  it('never puts the server text into a failure message', async () => {
    const { client: c } = client(() => ndjson([{ error: 'disk full at /Users/me/secret' }]));
    const { result } = await run(c);
    expect(result).toEqual({ ok: false, reason: 'failed', message: OLLAMA_MESSAGES.failed });
  });

  it('fails when the stream ends without success', async () => {
    const { client: c } = client(() => ndjson([{ status: 'pulling manifest' }]));
    await expect(run(c)).resolves.toMatchObject({ result: { ok: false, reason: 'failed' } });
  });

  it('reports a server that is not running', async () => {
    await expect(run(client(refused).client)).resolves.toMatchObject({ result: { ok: false, reason: 'not-running', message: OLLAMA_MESSAGES.notRunning } });
  });

  it('reports a cancelled download', async () => {
    const controller = new AbortController();
    const { client: c } = client((_url, init) => {
      controller.abort();
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError', signal: init?.signal }));
    });
    await expect(run(c, controller.signal)).resolves.toMatchObject({ result: { ok: false, reason: 'cancelled', message: OLLAMA_MESSAGES.cancelled } });
  });
});
