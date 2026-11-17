import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyzeFailure, AnalyzeOptions, AnalyzeResult, DocumentInfo } from '../analyzer';
import type { ApiKeyResult } from '../api-key';
import type { OllamaStatus } from '../ollama';
import { defaultRules, defaultSettings } from '../settings';
import { CONNECTION_TEST_MESSAGES, createConnectionTester, DEFAULT_SAMPLE_EXPECTATION, normalizeSender, senderMatches } from '.';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SAMPLE = new TextEncoder().encode('SAMPLE-PDF');
const STORED_KEY = 'sk-or-stored-SECRET';
const MATCH: DocumentInfo = { date: '2026-03-12', sender: 'Nordlicht Krankenkasse', title: 'Beitragsbescheinigung', category: 'Health/Health insurance' };

function setup(result: AnalyzeResult | (() => Promise<AnalyzeResult>), key: ApiKeyResult = { status: 'ok', value: STORED_KEY }) {
  const analyze = vi.fn<(pdf: Buffer, options: AnalyzeOptions) => Promise<AnalyzeResult>>(async () => (typeof result === 'function' ? result() : result));
  const loadSample = vi.fn(async () => SAMPLE);
  const settings = { getSettings: () => defaultSettings('/home/u'), listRules: () => defaultRules() };
  const test = createConnectionTester({ analyze, loadSample, apiKeys: { get: async () => key }, settings });
  return { test, analyze, loadSample };
}

const failure = (f: AnalyzeFailure): AnalyzeResult => ({ ok: false, failure: f });

describe('bundled sample scan', () => {
  it('ships a PDF and matching expected values', () => {
    expect(readFileSync(join(root, 'assets', 'sample-scan.pdf')).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(JSON.parse(readFileSync(join(root, 'assets', 'sample-scan.expected.json'), 'utf8'))).toEqual(DEFAULT_SAMPLE_EXPECTATION);
    expect(DEFAULT_SAMPLE_EXPECTATION).toMatchObject({ date: '2026-03-12', sender: 'Nordlicht' });
  });
});

describe('connection test', () => {
  it('passes when sender and date match, using the stored key, saved model and rules', async () => {
    const t = setup({ ok: true, info: MATCH });
    await expect(t.test({})).resolves.toEqual({ ok: true, message: CONNECTION_TEST_MESSAGES.ok });
    const [pdf, options] = t.analyze.mock.calls[0]!;
    expect(pdf.equals(Buffer.from(SAMPLE))).toBe(true);
    expect(options).toMatchObject({ config: { provider: 'openrouter', apiKey: STORED_KEY, model: 'google/gemini-2.5-flash' }, rules: defaultRules() });
    expect(options.timeoutMs).toBeGreaterThan(0);
  });

  it('prefers the typed key and model over the saved ones', async () => {
    const t = setup({ ok: true, info: MATCH }, { status: 'missing' });
    await t.test({ key: '  sk-or-typed  ', model: ' openai/gpt-4o ' });
    expect(t.analyze.mock.calls[0]![1].config).toMatchObject({ apiKey: 'sk-or-typed', model: 'openai/gpt-4o' });
  });

  it('accepts sender alternatives and the shortened sender', async () => {
    for (const sender of ['Nordlicht', 'NK', 'nordlicht krankenkasse']) {
      await expect(setup({ ok: true, info: { ...MATCH, sender } }).test({})).resolves.toMatchObject({ ok: true });
    }
  });

  it.each([
    ['a wrong date', { ...MATCH, date: '2026-12-03' }],
    ['no date', { ...MATCH, date: null }],
    ['a wrong sender', { ...MATCH, sender: 'Max Mustermann' }],
  ])('reports cannot_read_scans for %s', async (_name, info) => {
    await expect(setup({ ok: true, info }).test({})).resolves.toEqual({
      ok: false,
      reason: 'cannot_read_scans',
      message: CONNECTION_TEST_MESSAGES.cannotReadScans,
    });
  });

  it.each([
    [{ kind: 'invalid_key', message: 'x' }, 'invalid_key'],
    [{ kind: 'offline', message: 'x' }, 'offline'],
    [{ kind: 'timeout', message: 'x' }, 'offline'],
    [{ kind: 'invalid_result', message: 'x' }, 'no_structured_output'],
    [{ kind: 'provider_error', message: 'x', statusCode: 404 }, 'unknown_model'],
    [{ kind: 'provider_error', message: 'x', statusCode: 402 }, 'provider_error'],
    [{ kind: 'provider_error', message: 'x' }, 'provider_error'],
  ] as const)('maps analyzer failure %o to %s', async (f, reason) => {
    const result = await setup(failure(f)).test({});
    expect(result).toMatchObject({ ok: false, reason });
    expect(result.message).not.toBe('x');
  });

  it('names the HTTP status of other provider errors', async () => {
    const result = await setup(failure({ kind: 'provider_error', message: 'x', statusCode: 402 })).test({});
    expect(result.message).toContain('HTTP 402');
  });

  it('reports a missing or unreadable stored key without calling the model', async () => {
    for (const [status, message] of [
      ['missing', CONNECTION_TEST_MESSAGES.missingKey],
      ['unreadable', CONNECTION_TEST_MESSAGES.unreadableKey],
    ] as const) {
      const t = setup({ ok: true, info: MATCH }, { status });
      await expect(t.test({ key: '   ' })).resolves.toEqual({ ok: false, reason: 'invalid_key', message });
      expect(t.analyze).not.toHaveBeenCalled();
    }
  });

  it('never throws, and never puts the key into the result', async () => {
    const t = setup(async () => {
      throw new Error(`boom ${STORED_KEY}`);
    });
    const result = await t.test({});
    expect(result).toMatchObject({ ok: false, reason: 'provider_error' });
    expect(JSON.stringify(result)).not.toContain(STORED_KEY);
  });

  it('reports a missing sample scan', async () => {
    const test = createConnectionTester({
      analyze: vi.fn(),
      loadSample: async () => {
        throw new Error('ENOENT');
      },
      apiKeys: { get: async () => ({ status: 'ok', value: STORED_KEY }) },
      settings: { getSettings: () => defaultSettings('/home/u'), listRules: () => defaultRules() },
    });
    await expect(test({})).resolves.toEqual({ ok: false, reason: 'provider_error', message: CONNECTION_TEST_MESSAGES.sampleMissing });
  });
});

describe('connection test with Ollama', () => {
  const RUNNING: OllamaStatus = { running: true, version: '0.12.3', models: ['qwen2.5vl:7b'] };

  function setupOllama(result: AnalyzeResult, status: OllamaStatus = RUNNING) {
    const analyze = vi.fn<(pdf: Buffer, options: AnalyzeOptions) => Promise<AnalyzeResult>>(async () => result);
    const get = vi.fn(async () => ({ status: 'missing' }) as ApiKeyResult);
    const test = createConnectionTester({
      analyze,
      loadSample: async () => SAMPLE,
      apiKeys: { get },
      settings: { getSettings: () => ({ ...defaultSettings('/home/u'), provider: 'ollama' as const }), listRules: () => defaultRules() },
      ollama: { status: async () => status },
    });
    return { test, analyze, get };
  }

  it('passes without a key, using the saved address and model, and says it can read scans', async () => {
    const t = setupOllama({ ok: true, info: MATCH });
    await expect(t.test({})).resolves.toEqual({ ok: true, message: CONNECTION_TEST_MESSAGES.okOllama });
    expect(t.analyze.mock.calls[0]![1].config).toEqual({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5vl:7b' });
    expect(t.analyze.mock.calls[0]![1].timeoutMs).toBeGreaterThan(60_000);
    expect(t.get).not.toHaveBeenCalled();
  });

  it('uses the typed model and the provider typed into the settings before they are saved', async () => {
    const analyze = vi.fn<(pdf: Buffer, options: AnalyzeOptions) => Promise<AnalyzeResult>>(async () => ({ ok: true, info: MATCH }));
    const test = createConnectionTester({
      analyze,
      loadSample: async () => SAMPLE,
      apiKeys: { get: async () => ({ status: 'missing' }) },
      settings: { getSettings: () => defaultSettings('/home/u'), listRules: () => defaultRules() },
      ollama: { status: async () => ({ running: true, models: ['gemma3:4b'] }) },
    });
    await expect(test({ provider: 'ollama', model: ' gemma3:4b ' })).resolves.toMatchObject({ ok: true });
    expect(analyze.mock.calls[0]![1].config).toMatchObject({ provider: 'ollama', model: 'gemma3:4b' });
  });

  it('says Ollama is not running without analyzing anything', async () => {
    const t = setupOllama({ ok: true, info: MATCH }, { running: false, models: [] });
    await expect(t.test({})).resolves.toEqual({ ok: false, reason: 'server_not_running', message: CONNECTION_TEST_MESSAGES.ollamaNotRunning });
    expect(t.analyze).not.toHaveBeenCalled();
  });

  it('says the model is not installed, also when only the :latest tag differs', async () => {
    const t = setupOllama({ ok: true, info: MATCH }, { running: true, models: ['gemma3:4b'] });
    await expect(t.test({})).resolves.toEqual({ ok: false, reason: 'model_not_installed', message: CONNECTION_TEST_MESSAGES.ollamaModelNotInstalled('qwen2.5vl:7b') });
    expect(t.analyze).not.toHaveBeenCalled();
    const latest = setupOllama({ ok: true, info: MATCH }, { running: true, models: ['qwen2.5vl:latest'] });
    await expect(latest.test({ model: 'qwen2.5vl' })).resolves.toMatchObject({ ok: true });
  });

  it.each([
    [{ kind: 'offline', message: 'x' }, 'server_not_running', CONNECTION_TEST_MESSAGES.ollamaNotRunning],
    [{ kind: 'timeout', message: 'x' }, 'offline', CONNECTION_TEST_MESSAGES.ollamaTimeout],
    [{ kind: 'render_failed', message: 'x' }, 'provider_error', CONNECTION_TEST_MESSAGES.renderFailed],
    [{ kind: 'invalid_result', message: 'x' }, 'no_structured_output', CONNECTION_TEST_MESSAGES.noStructuredOutput],
    [{ kind: 'provider_error', message: 'x', statusCode: 404 }, 'model_not_installed', CONNECTION_TEST_MESSAGES.ollamaModelNotInstalled('qwen2.5vl:7b')],
    [{ kind: 'provider_error', message: 'x', statusCode: 500 }, 'provider_error', CONNECTION_TEST_MESSAGES.providerError(500, 'ollama')],
  ] as const)('maps analyzer failure %o to %s', async (f, reason, message) => {
    await expect(setupOllama(failure(f)).test({})).resolves.toEqual({ ok: false, reason, message });
  });

  it('reports a model that cannot read the sample scan', async () => {
    const t = setupOllama({ ok: true, info: { ...MATCH, sender: 'Max Mustermann' } });
    await expect(t.test({})).resolves.toMatchObject({ ok: false, reason: 'cannot_read_scans' });
  });
});

describe('sender comparison', () => {
  it('normalises like the Filer and accepts alternatives', () => {
    expect(normalizeSender('Gesundheitskasse Musterland')).toBe('gesundheit');
    expect(senderMatches({ sender: 'Northwind', senderAlternatives: ['Northwind Health Insurance'] }, 'Northwind Health Insurance')).toBe(true);
    expect(senderMatches({ sender: 'Northwind' }, null)).toBe(false);
  });
});
