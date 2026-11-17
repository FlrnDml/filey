import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { ModelConfig } from './createModel';
import { describeFolders, MAX_SUGGESTED_DESCRIPTION } from './describe-folders';
import { resolveModelConfig } from './model-config';

const CONFIG: ModelConfig = { provider: 'openrouter', apiKey: 'sk-or-secret', model: 'test/model' };

function mockModel(answer: unknown) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

describe('describeFolders', () => {
  const folders = [
    { folder: 'Health/Health insurance', sampleFileNames: ['2025-01-02_Northwind_Invoice.pdf'] },
    { folder: 'Taxes', sampleFileNames: [] },
  ];

  it('sends only folder paths and file names and keeps answers for the requested folders', async () => {
    const { model, prompts } = mockModel({
      folders: [
        { folder: 'Health/Health insurance', description: '  Letters and invoices\nfrom Northwind. ' },
        { folder: 'Taxes', description: 'x'.repeat(400) },
        { folder: 'Invented', description: 'Not asked for' },
        { folder: 'Taxes', description: 'Second answer' },
        { folder: 'Health', description: '' },
      ],
    });
    const result = await describeFolders(folders, CONFIG, { createModel: () => model as LanguageModel });
    expect(result).toEqual({
      ok: true,
      rules: [
        { folder: 'Health/Health insurance', description: 'Letters and invoices from Northwind.' },
        { folder: 'Taxes', description: 'x'.repeat(MAX_SUGGESTED_DESCRIPTION) },
      ],
    });
    const sent = JSON.stringify(prompts);
    expect(sent).toContain('2025-01-02_Northwind_Invoice.pdf');
    expect(sent).not.toContain('"type":"file"');
    expect(sent).not.toContain('sk-or-secret');
  });

  it('returns a typed failure instead of throwing', async () => {
    const { model } = mockModel({ wrong: true });
    const result = await describeFolders(folders, CONFIG, { createModel: () => model as LanguageModel });
    expect(result).toEqual({ ok: false, failure: { kind: 'invalid_result', message: 'The model did not return a valid result' } });
  });
});

describe('resolveModelConfig', () => {
  const settings = { provider: 'openrouter' as const, model: 'm', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5vl:7b' };

  it('uses the key for OpenRouter and none for Ollama', async () => {
    await expect(resolveModelConfig(settings, { get: async () => ({ status: 'ok', value: 'k' }) })).resolves.toEqual({
      ok: true,
      config: { provider: 'openrouter', apiKey: 'k', model: 'm' },
    });
    await expect(resolveModelConfig({ ...settings, provider: 'ollama' }, { get: async () => ({ status: 'missing' }) })).resolves.toEqual({
      ok: true,
      config: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5vl:7b' },
    });
  });

  it('says why without a usable key', async () => {
    await expect(resolveModelConfig(settings, { get: async () => ({ status: 'missing' }) })).resolves.toMatchObject({ ok: false, reason: 'missing-key' });
    await expect(resolveModelConfig(settings, { get: async () => ({ status: 'unreadable' }) })).resolves.toMatchObject({ ok: false, reason: 'unreadable-key' });
  });
});
