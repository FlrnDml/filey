import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '../db';
import { defaultSettings } from './defaults';
import { createSettingsRepository } from './settings-repository';
import { SettingsValidationError, validateOllamaUrl, validateSettings } from './validation';

const repo = () => createSettingsRepository(openMigratedDatabase(':memory:'), { home: '/home/u' });

describe('Ollama defaults', () => {
  it('start with OpenRouter, the standard local address and the recommended model', () => {
    expect(defaultSettings('/home/u')).toMatchObject({ provider: 'openrouter', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5vl:7b' });
  });
});

describe('validateOllamaUrl', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['  http://127.0.0.1:11500  ', 'http://127.0.0.1:11500'],
    ['http://[::1]:11434', 'http://[::1]:11434'],
    ['https://localhost:8443', 'https://localhost:8443'],
    ['HTTP://LOCALHOST:11434', 'http://localhost:11434'],
  ])('accepts %s', (input, expected) => {
    expect(validateOllamaUrl(input)).toBe(expected);
  });

  it.each([
    'http://192.168.1.20:11434',
    'http://my-server.local:11434',
    'http://example.com',
    'http://localhost.evil.com:11434',
    'http://user:pass@localhost:11434',
    'http://localhost:11434/api',
    'http://localhost:11434/?x=1',
    'http://localhost:11434/#top',
    'ftp://localhost',
    'file:///etc/passwd',
    'localhost:11434',
    'not a url',
    '',
  ])('rejects %s with a message for the address field', (input) => {
    expect(() => validateOllamaUrl(input)).toThrow(SettingsValidationError);
    try {
      validateOllamaUrl(input);
    } catch (error) {
      expect((error as SettingsValidationError).field).toBe('ollamaUrl');
    }
  });
});

describe('validateSettings for Ollama', () => {
  const base = defaultSettings('/home/u');

  it.each(['qwen2.5vl:7b', 'gemma3', 'library/gemma3:4b', 'hf.co/user/model-GGUF:Q4_K_M'])('accepts the model %s', (ollamaModel) => {
    expect(() => validateSettings({ ...base, ollamaModel })).not.toThrow();
  });

  it.each(['', '  ', 'two words', 'a;b', 'x\ny', 'x'.repeat(201)])('rejects the model %j', (ollamaModel) => {
    expect(() => validateSettings({ ...base, ollamaModel })).toThrow(expect.objectContaining({ field: 'ollamaModel' }));
  });

  it('accepts both providers and rejects others', () => {
    expect(() => validateSettings({ ...base, provider: 'ollama' })).not.toThrow();
    expect(() => validateSettings({ ...base, provider: 'lmstudio' as never })).toThrow(expect.objectContaining({ field: 'provider' }));
  });
});

describe('settings repository', () => {
  it('stores the provider and Ollama settings, each provider keeping its own model', () => {
    const r = repo();
    r.updateSettings({ provider: 'ollama', ollamaModel: 'gemma3:4b' });
    r.updateSettings({ model: 'openai/gpt-4o' });
    expect(r.getSettings()).toMatchObject({ provider: 'ollama', ollamaModel: 'gemma3:4b', model: 'openai/gpt-4o' });
    r.updateSettings({ provider: 'openrouter' });
    expect(r.getSettings()).toMatchObject({ provider: 'openrouter', ollamaModel: 'gemma3:4b', model: 'openai/gpt-4o' });
  });

  it('saves the address without a trailing slash', () => {
    const r = repo();
    expect(r.updateSettings({ ollamaUrl: 'http://localhost:11500/' }).ollamaUrl).toBe('http://localhost:11500');
    expect(r.getSettings().ollamaUrl).toBe('http://localhost:11500');
  });

  it('stores nothing when the address points elsewhere', () => {
    const r = repo();
    expect(() => r.updateSettings({ ollamaUrl: 'http://192.168.0.5:11434', provider: 'ollama' })).toThrow(SettingsValidationError);
    expect(r.getSettings()).toMatchObject({ provider: 'openrouter', ollamaUrl: 'http://localhost:11434' });
    expect(r.isStored('ollamaUrl')).toBe(false);
  });

  it('keeps existing installations on OpenRouter: the new settings fall back to their defaults', () => {
    const r = repo();
    r.updateSettings({ model: 'x/y' });
    expect(r.isStored('provider')).toBe(false);
    expect(r.getSettings()).toMatchObject({ provider: 'openrouter', ollamaModel: 'qwen2.5vl:7b' });
  });
});
