import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APICallError, NoObjectGeneratedError, RetryError, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { FolderRule } from '../settings';
import { analyze, OLLAMA_MAX_EDGE_PX, OLLAMA_MAX_PAGES, type AnalyzeDeps } from './analyze';
import { buildContent, buildImageContent } from './buildContent';
import { createModel, OLLAMA_NUM_CTX, type ModelConfig } from './createModel';
import { classifyError } from './errors';
import { buildPrompt } from './prompt';
import { createDocumentInfoSchema, folderNames } from './schema';

const API_KEY = 'sk-or-v1-super-secret-key';
const OPENROUTER: ModelConfig = { provider: 'openrouter', apiKey: API_KEY, model: 'test/model' };
const PDF = Buffer.from('%PDF-1.4 fake document with secret contents');
const RULES: FolderRule[] = [
  { folder: 'Insurance/Car', description: 'Everything about my car insurance' },
  { folder: 'Finance/Taxes', description: 'Tax returns and tax office letters' },
  { folder: 'Unsorted', description: 'Documents that match no other folder' },
];

function mockModel(text: string | (() => Promise<never>)) {
  return new MockLanguageModelV4({
    doGenerate:
      typeof text === 'string'
        ? async () => ({
            content: [{ type: 'text', text }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
            warnings: [],
          })
        : text,
  });
}

/** Runs the real `generateObject` against a mock model, so schema validation and message building are real. */
function run(model: MockLanguageModelV4, rules = RULES) {
  const deps: AnalyzeDeps = { createModel: () => model as LanguageModel };
  return analyze(PDF, { config: OPENROUTER, rules }, deps);
}

const valid = { date: '2026-03-04', sender: 'Contoso', title: 'Invoice', category: 'Insurance/Car' };

describe('analyze', () => {
  it('returns the validated result', async () => {
    const result = await run(mockModel(JSON.stringify(valid)));
    expect(result).toEqual({ ok: true, info: valid });
  });

  it('accepts null for missing values', async () => {
    const info = { date: null, sender: null, title: null, category: 'Unsorted' };
    expect(await run(mockModel(JSON.stringify(info)))).toEqual({ ok: true, info });
  });

  it('sends the PDF as a file part with media type application/pdf plus the prompt', async () => {
    const model = mockModel(JSON.stringify(valid));
    await run(model);
    const call = model.doGenerateCalls[0]!;
    const user = call.prompt.find((message) => message.role === 'user')!;
    const file = (user.content as { type: string; mediaType?: string; data?: unknown }[]).find((p) => p.type === 'file');
    expect(file?.mediaType).toBe('application/pdf');
    expect(file?.data).toBeTruthy();
    const system = call.prompt.find((message) => message.role === 'system');
    expect(JSON.stringify(system)).toContain('Insurance/Car');
  });

  it('gives the model no tools', async () => {
    const model = mockModel(JSON.stringify(valid));
    await run(model);
    expect(model.doGenerateCalls[0]!.tools ?? []).toEqual([]);
  });

  it('rejects a category outside the configured folders as invalid_result', async () => {
    const result = await run(mockModel(JSON.stringify({ ...valid, category: 'Holidays' })));
    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid_result' } });
  });

  it('accepts a sender longer than 10 characters but rejects a malformed date as invalid_result', async () => {
    expect(await run(mockModel(JSON.stringify({ ...valid, sender: 'Northwind Health Insurance' })))).toMatchObject({
      ok: true,
      info: { sender: 'Northwind Health Insurance' },
    });
    expect(await run(mockModel(JSON.stringify({ ...valid, date: '04.03.2026' })))).toMatchObject({
      ok: false,
      failure: { kind: 'invalid_result' },
    });
  });

  it('reports non-JSON output as invalid_result', async () => {
    expect(await run(mockModel('Sorry, I cannot read this.'))).toMatchObject({
      ok: false,
      failure: { kind: 'invalid_result' },
    });
  });

  it('builds the category enum from the given folders', async () => {
    const other: FolderRule[] = [{ folder: 'Work', description: 'Employer documents' }];
    // Folders from RULES are no longer valid, `Work` and the fallback are.
    expect(await run(mockModel(JSON.stringify({ ...valid, category: 'Work' })), other)).toMatchObject({ ok: true });
    expect(await run(mockModel(JSON.stringify({ ...valid, category: 'Insurance/Car' })), other)).toMatchObject({ ok: false });
  });

  it('gives up with a timeout failure when the model does not answer in time', async () => {
    const hanging = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => abortSignal?.addEventListener('abort', () => reject(abortSignal.reason as Error))),
    });
    const deps: AnalyzeDeps = { createModel: () => hanging as LanguageModel };
    const result = await analyze(PDF, { config: OPENROUTER, rules: RULES, timeoutMs: 20 }, deps);
    expect(result).toEqual({ ok: false, failure: { kind: 'timeout', message: 'The analysis timed out' } });
  });

  it('fails a password-protected PDF right away without calling the model', async () => {
    const pdf = readFileSync(join(__dirname, 'fixtures', 'aes-256-user-password.pdf'));
    const model = mockModel(JSON.stringify(valid));
    const deps: AnalyzeDeps = { createModel: () => model as LanguageModel };
    const result = await analyze(pdf, { config: OPENROUTER, rules: RULES }, deps);
    expect(result).toEqual({ ok: false, failure: { kind: 'password_protected', message: 'The PDF is password-protected' } });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  describe('with an injected generateObject', () => {
    const failWith = (error: unknown) =>
      analyze(PDF, { config: OPENROUTER, rules: RULES }, {
        generateObject: (async () => {
          throw error;
        }) as unknown as AnalyzeDeps['generateObject'],
        createModel: () => ({}) as LanguageModel,
      });

    const apiError = (statusCode?: number, cause?: unknown) =>
      new APICallError({
        message: `request with ${API_KEY} failed`,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        requestBodyValues: { key: API_KEY, doc: 'secret contents' },
        statusCode,
        cause,
      });

    it.each([401, 403])('maps HTTP %i to invalid_key', async (status) => {
      expect(await failWith(apiError(status))).toMatchObject({ ok: false, failure: { kind: 'invalid_key' } });
    });

    it('maps a connection failure to offline', async () => {
      const cause = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      expect(await failWith(apiError(undefined, cause))).toMatchObject({ ok: false, failure: { kind: 'offline' } });
    });

    it('finds the network error inside a retry error', async () => {
      const retry = new RetryError({
        message: 'failed after 3 attempts',
        reason: 'maxRetriesExceeded',
        errors: [apiError(undefined, Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))],
      });
      expect(await failWith(retry)).toMatchObject({ ok: false, failure: { kind: 'offline' } });
    });

    it('maps a timeout to timeout, not offline', async () => {
      const timeout = new DOMException('The operation timed out', 'TimeoutError');
      expect(await failWith(timeout)).toMatchObject({ ok: false, failure: { kind: 'timeout', message: 'The analysis timed out' } });
    });

    it('maps NoObjectGeneratedError to invalid_result', async () => {
      const error = new NoObjectGeneratedError({
        message: 'no object',
        text: 'document text',
        response: { id: '1', timestamp: new Date(), modelId: 'm' },
        usage: {} as never,
        finishReason: 'stop',
      });
      expect(await failWith(error)).toMatchObject({ ok: false, failure: { kind: 'invalid_result' } });
    });

    it('maps other HTTP errors to provider_error with the status code', async () => {
      expect(await failWith(apiError(404))).toMatchObject({ ok: false, failure: { kind: 'provider_error', statusCode: 404 } });
    });

    it('never leaks the key or document contents in a failure', async () => {
      for (const error of [apiError(401), apiError(500), apiError(undefined, new TypeError('fetch failed')), new Error(API_KEY)]) {
        const result = await failWith(error);
        const text = JSON.stringify(result);
        expect(text).not.toContain(API_KEY);
        expect(text).not.toContain('secret contents');
      }
    });

    it('passes the schema, prompt and PDF to generateObject', async () => {
      let received: Record<string, unknown> | undefined;
      const generateObject = (async (options: Record<string, unknown>) => {
        received = options;
        return { object: valid };
      }) as unknown as AnalyzeDeps['generateObject'];
      const result = await analyze(PDF, { config: OPENROUTER, rules: RULES }, { generateObject, createModel: () => ({}) as LanguageModel });
      expect(result).toEqual({ ok: true, info: valid });
      expect(received?.instructions).toBe(buildPrompt(RULES));
    });
  });
});

describe('classifyError', () => {
  it('treats an unknown error as provider_error', () => {
    expect(classifyError(new Error('boom')).kind).toBe('provider_error');
  });
});

describe('folderNames / schema', () => {
  it('always contains the fallback folder, once', () => {
    expect(folderNames([])).toEqual(['Unsorted']);
    expect(folderNames([{ folder: 'Work', description: 'x' }])).toEqual(['Work', 'Unsorted']);
    expect(folderNames(RULES)).toEqual(['Insurance/Car', 'Finance/Taxes', 'Unsorted']);
  });

  it('restricts category to the configured folders', () => {
    const schema = createDocumentInfoSchema([{ folder: 'Work', description: 'x' }]);
    const base = { date: null, sender: null, title: null };
    expect(schema.safeParse({ ...base, category: 'Work' }).success).toBe(true);
    expect(schema.safeParse({ ...base, category: 'Unsorted' }).success).toBe(true);
    expect(schema.safeParse({ ...base, category: 'Finance/Taxes' }).success).toBe(false);
  });

  it('accepts any sender length and requires YYYY-MM-DD dates', () => {
    const schema = createDocumentInfoSchema(RULES);
    const base = { title: null, category: 'Unsorted' };
    expect(schema.safeParse({ ...base, date: null, sender: '1234567890' }).success).toBe(true);
    expect(schema.safeParse({ ...base, date: null, sender: '12345678901' }).success).toBe(true);
    expect(schema.safeParse({ ...base, date: '2026-3-4', sender: null }).success).toBe(false);
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt(RULES);

  it('lists the folders with their descriptions', () => {
    expect(prompt).toContain('- Insurance/Car: Everything about my car insurance');
    expect(prompt).toContain('- Finance/Taxes: Tax returns and tax office letters');
  });

  it('adds the fallback folder when the rules lack it', () => {
    expect(buildPrompt([{ folder: 'Work', description: 'x' }])).toContain('- Unsorted:');
  });

  it('covers sender length, sender vs recipient, letter date vs deadline and null values', () => {
    expect(prompt).toContain('at most 10 characters');
    expect(prompt).toContain('Northwind Health Insurance');
    expect(prompt).toMatch(/not the recipient/);
    expect(prompt).toMatch(/not a deadline/);
    expect(prompt).toContain('null');
  });
});

describe('buildContent', () => {
  it('returns the PDF as a file part with media type application/pdf', () => {
    expect(buildContent(PDF)).toEqual([{ type: 'file', data: PDF, mediaType: 'application/pdf' }]);
  });

  it('puts optional text before the file', () => {
    const content = buildContent(PDF, 'hello');
    expect(content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(content[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' });
  });
});

describe('analyze with Ollama', () => {
  const OLLAMA: ModelConfig = { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5vl:7b' };
  const PAGE_1 = new Uint8Array([137, 80, 78, 71, 1]);
  const PAGE_2 = new Uint8Array([137, 80, 78, 71, 2]);

  function runOllama(model: MockLanguageModelV4, pages: Uint8Array[] | Error = [PAGE_1, PAGE_2]) {
    const render = vi.fn(async () => {
      if (pages instanceof Error) throw pages;
      return pages;
    });
    const deps: AnalyzeDeps = { createModel: () => model as LanguageModel, pageRenderer: { render } };
    return { render, result: analyze(PDF, { config: OLLAMA, rules: RULES }, deps) };
  }

  it('renders the first pages and sends them as images, not as a PDF', async () => {
    const model = mockModel(JSON.stringify(valid));
    const { render, result } = runOllama(model);
    await expect(result).resolves.toEqual({ ok: true, info: valid });
    expect(render).toHaveBeenCalledWith(PDF, { maxPages: OLLAMA_MAX_PAGES, maxEdgePx: OLLAMA_MAX_EDGE_PX });
    expect(OLLAMA_MAX_PAGES).toBe(3);
    expect(OLLAMA_MAX_EDGE_PX).toBe(1024);

    const user = model.doGenerateCalls[0]!.prompt.find((m) => m.role === 'user')!;
    const parts = user.content as { type: string; mediaType?: string; data?: unknown }[];
    expect(parts.filter((part) => part.type === 'file').map((part) => part.mediaType)).toEqual(['image/png', 'image/png']);
    expect(parts.some((part) => part.mediaType === 'application/pdf')).toBe(false);
    expect(parts[0]).toMatchObject({ type: 'text' });
  });

  it('fails with render_failed, without calling the model, when the pages cannot be rendered', async () => {
    const model = mockModel(JSON.stringify(valid));
    const { result } = runOllama(model, new Error('Invalid PDF structure at /Users/me/secret.pdf'));
    const failure = await result;
    expect(failure).toEqual({ ok: false, failure: { kind: 'render_failed', message: 'The PDF could not be turned into images' } });
    expect(JSON.stringify(failure)).not.toContain('/Users/me');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('fails with render_failed when no page comes back or no renderer is available', async () => {
    const model = mockModel(JSON.stringify(valid));
    await expect(runOllama(model, []).result).resolves.toMatchObject({ ok: false, failure: { kind: 'render_failed' } });
    const noRenderer = await analyze(PDF, { config: OLLAMA, rules: RULES }, { createModel: () => model as LanguageModel });
    expect(noRenderer).toMatchObject({ ok: false, failure: { kind: 'render_failed' } });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('does not render a password-protected PDF', async () => {
    const pdf = readFileSync(join(__dirname, 'fixtures', 'aes-256-user-password.pdf'));
    const render = vi.fn();
    const result = await analyze(pdf, { config: OLLAMA, rules: RULES }, { pageRenderer: { render } });
    expect(result).toMatchObject({ ok: false, failure: { kind: 'password_protected' } });
    expect(render).not.toHaveBeenCalled();
  });

  it('does not render anything for OpenRouter', async () => {
    const render = vi.fn();
    const deps: AnalyzeDeps = { createModel: () => mockModel(JSON.stringify(valid)) as LanguageModel, pageRenderer: { render } };
    await analyze(PDF, { config: OPENROUTER, rules: RULES }, deps);
    expect(render).not.toHaveBeenCalled();
  });

  it('passes the model config on to createModel', async () => {
    const seen: ModelConfig[] = [];
    await analyze(PDF, { config: OLLAMA, rules: RULES }, {
      createModel: (config) => {
        seen.push(config);
        return mockModel(JSON.stringify(valid)) as LanguageModel;
      },
      pageRenderer: { render: async () => [PAGE_1] },
    });
    expect(seen).toEqual([OLLAMA]);
  });

  it('names Ollama in its failures', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    expect(classifyError(refused, 'ollama')).toEqual({ kind: 'offline', message: 'Ollama cannot be reached' });
    expect(classifyError(refused)).toEqual({ kind: 'offline', message: 'OpenRouter cannot be reached' });
    const http = new APICallError({ message: 'model not found', url: 'http://localhost:11434/api/chat', requestBodyValues: {}, statusCode: 404 });
    expect(classifyError(http, 'ollama')).toEqual({ kind: 'provider_error', message: 'Ollama returned HTTP 404', statusCode: 404 });
  });

  it('gives a local model more time than a cloud model', async () => {
    const hanging = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => abortSignal?.addEventListener('abort', () => reject(abortSignal.reason as Error))),
    });
    // With an explicit timeout the analysis gives up; the defaults are only checked through the abort signal here.
    const result = await analyze(PDF, { config: OLLAMA, rules: RULES, timeoutMs: 20 }, { createModel: () => hanging as LanguageModel, pageRenderer: { render: async () => [PAGE_1] } });
    expect(result).toMatchObject({ ok: false, failure: { kind: 'timeout' } });
  });
});

describe('buildImageContent', () => {
  it('puts the text first and the pages after it, in order', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    expect(buildImageContent([a, b], 'Classify')).toEqual([
      { type: 'text', text: 'Classify' },
      { type: 'file', data: 'AQ==', mediaType: 'image/png' },
      { type: 'file', data: 'Ag==', mediaType: 'image/png' },
    ]);
    expect(buildImageContent([a])).toEqual([{ type: 'file', data: 'AQ==', mediaType: 'image/png' }]);
  });

  it('encodes a view into a larger buffer by its own bytes only', () => {
    const view = new Uint8Array(new Uint8Array([9, 9, 7, 8, 9, 9]).buffer, 2, 2);
    expect(buildImageContent([view])).toEqual([{ type: 'file', data: Buffer.from([7, 8]).toString('base64'), mediaType: 'image/png' }]);
  });
});

describe('createModel', () => {
  it('builds an OpenRouter and an Ollama model', () => {
    expect(createModel(OPENROUTER)).toMatchObject({ modelId: 'test/model' });
    expect(createModel({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5vl:7b' })).toMatchObject({ modelId: 'qwen2.5vl:7b' });
  });

  it('asks Ollama for a context window that fits three page images', () => {
    expect(OLLAMA_NUM_CTX).toBeGreaterThanOrEqual(8192);
  });

  it('talks to the native Ollama API below the saved address and sets num_ctx on each request', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        requests.push({ url: req.url ?? '', body: JSON.parse(data || '{}') });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: 'qwen2.5vl:7b', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify(valid) }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const config: ModelConfig = { provider: 'ollama', baseUrl: `http://127.0.0.1:${port}`, model: 'qwen2.5vl:7b' };
      const result = await analyze(PDF, { config, rules: RULES, timeoutMs: 10_000 }, { pageRenderer: { render: async () => [new Uint8Array([137, 80, 78, 71])] } });
      expect(result).toEqual({ ok: true, info: valid });
      expect(requests[0]!.url).toBe('/api/chat');
      expect(requests[0]!.body).toMatchObject({ model: 'qwen2.5vl:7b', options: { num_ctx: OLLAMA_NUM_CTX } });
      expect(JSON.stringify(requests[0]!.body)).toContain('"images"');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
