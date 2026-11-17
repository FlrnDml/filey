import { describe, expect, it, vi } from 'vitest';
import type { OllamaClient } from './client';
import { createOllamaService } from './service';
import type { OllamaPullResult } from './types';

function setup(pull: OllamaClient['pull'] = async () => ({ ok: true })) {
  const client: OllamaClient = {
    status: vi.fn(async () => ({ running: true, models: ['qwen2.5vl:7b'] })),
    isReachable: vi.fn(async () => true),
    pull: vi.fn(pull),
  };
  const logs: string[] = [];
  const progress = vi.fn();
  let url = 'http://localhost:11434';
  const service = createOllamaService({ client, getBaseUrl: () => url, onProgress: progress, logger: { log: (_l, m) => logs.push(m) } });
  return { service, client, logs, progress, setUrl: (next: string) => (url = next) };
}

describe('ollama service', () => {
  it('asks the saved address for the status, reading it on every call', async () => {
    const t = setup();
    await t.service.status();
    t.setUrl('http://127.0.0.1:11500');
    await t.service.status();
    expect(vi.mocked(t.client.status).mock.calls.map((c) => c[0])).toEqual(['http://localhost:11434', 'http://127.0.0.1:11500']);
  });

  it('downloads a model and passes progress on', async () => {
    const t = setup(async (_url, model, onProgress) => {
      onProgress({ model, status: 'pulling x', completed: 1, total: 2 });
      return { ok: true };
    });
    await expect(t.service.pull('qwen2.5vl:7b')).resolves.toEqual({ ok: true });
    expect(t.progress).toHaveBeenCalledWith({ model: 'qwen2.5vl:7b', status: 'pulling x', completed: 1, total: 2 });
    expect(t.logs).toEqual(['Ollama: downloading qwen2.5vl:7b', 'Ollama: download of qwen2.5vl:7b finished']);
  });

  it.each(['', '  ', 'bad name', 'a;b', '../x y', 'x'.repeat(201)])('refuses the model name %j without calling Ollama', async (name) => {
    const t = setup();
    await expect(t.service.pull(name)).resolves.toMatchObject({ ok: false, reason: 'invalid-model' });
    expect(t.client.pull).not.toHaveBeenCalled();
  });

  it('runs one download at a time and allows the next one afterwards', async () => {
    let finish: (result: OllamaPullResult) => void = () => undefined;
    const t = setup(() => new Promise((resolve) => (finish = resolve)));
    const first = t.service.pull('gemma3:4b');
    await expect(t.service.pull('qwen2.5vl:7b')).resolves.toMatchObject({ ok: false, reason: 'busy' });
    finish({ ok: true });
    await first;
    const second = t.service.pull('qwen2.5vl:7b');
    finish({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('cancels the running download through the abort signal', async () => {
    const t = setup(
      (_url, _model, _progress, signal) =>
        new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled', message: 'The download was cancelled.' }))),
    );
    const pull = t.service.pull('qwen2.5vl:7b');
    t.service.cancelPull();
    await expect(pull).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    // Cancelling with nothing running does nothing.
    expect(() => t.service.cancelPull()).not.toThrow();
  });
});
