import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyzeFailure, AnalyzeOptions, AnalyzeResult, DocumentInfo } from '../analyzer';
import type { ApiKeyResult } from '../api-key';
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
    expect(options).toMatchObject({ apiKey: STORED_KEY, model: 'google/gemini-2.5-flash', rules: defaultRules() });
    expect(options.timeoutMs).toBeGreaterThan(0);
  });

  it('prefers the typed key and model over the saved ones', async () => {
    const t = setup({ ok: true, info: MATCH }, { status: 'missing' });
    await t.test({ key: '  sk-or-typed  ', model: ' openai/gpt-4o ' });
    expect(t.analyze.mock.calls[0]![1]).toMatchObject({ apiKey: 'sk-or-typed', model: 'openai/gpt-4o' });
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

describe('sender comparison', () => {
  it('normalises like the Filer and accepts alternatives', () => {
    expect(normalizeSender('Gesundheitskasse Musterland')).toBe('gesundheit');
    expect(senderMatches({ sender: 'Northwind', senderAlternatives: ['Northwind Health Insurance'] }, 'Northwind Health Insurance')).toBe(true);
    expect(senderMatches({ sender: 'Northwind' }, null)).toBe(false);
  });
});
