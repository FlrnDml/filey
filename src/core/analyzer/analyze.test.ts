import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APICallError, NoObjectGeneratedError, RetryError, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { FolderRule } from '../settings';
import { analyze, type AnalyzeDeps } from './analyze';
import { buildContent } from './buildContent';
import { classifyError } from './errors';
import { buildPrompt } from './prompt';
import { createDocumentInfoSchema, folderNames } from './schema';

const API_KEY = 'sk-or-v1-super-secret-key';
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
  return analyze(PDF, { apiKey: API_KEY, model: 'test/model', rules }, deps);
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
    const result = await analyze(PDF, { apiKey: API_KEY, model: 'test/model', rules: RULES, timeoutMs: 20 }, deps);
    expect(result).toEqual({ ok: false, failure: { kind: 'timeout', message: 'The analysis timed out' } });
  });

  it('fails a password-protected PDF right away without calling the model', async () => {
    const pdf = readFileSync(join(__dirname, 'fixtures', 'aes-256-user-password.pdf'));
    const model = mockModel(JSON.stringify(valid));
    const deps: AnalyzeDeps = { createModel: () => model as LanguageModel };
    const result = await analyze(pdf, { apiKey: API_KEY, model: 'test/model', rules: RULES }, deps);
    expect(result).toEqual({ ok: false, failure: { kind: 'password_protected', message: 'The PDF is password-protected' } });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  describe('with an injected generateObject', () => {
    const failWith = (error: unknown) =>
      analyze(PDF, { apiKey: API_KEY, model: 'm', rules: RULES }, {
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
      const result = await analyze(PDF, { apiKey: API_KEY, model: 'm', rules: RULES }, { generateObject, createModel: () => ({}) as LanguageModel });
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
