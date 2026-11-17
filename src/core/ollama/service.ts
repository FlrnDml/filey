import type { OllamaClient } from './client';
import type { OllamaPullProgress, OllamaPullResult, OllamaStatus } from './types';
import { OLLAMA_MODEL_PATTERN } from '../settings/validation';
import type { Logger } from '../ports';

export interface OllamaServiceDeps {
  client: OllamaClient;
  /** The saved address (`Settings.ollamaUrl`), read on every call so a change takes effect right away. */
  getBaseUrl(): string;
  /** Called with every progress update (feeds `ollama:pull-progress`). */
  onProgress(progress: OllamaPullProgress): void;
  logger: Logger;
}

export interface OllamaService {
  status(): Promise<OllamaStatus>;
  /** Downloads a model. Only one download runs at a time; a second one resolves with `busy`. */
  pull(model: string): Promise<OllamaPullResult>;
  /** Cancels the running download, if any. */
  cancelPull(): void;
}

/** Model management for the settings and onboarding screens (arc42 §6.2). */
export function createOllamaService({ client, getBaseUrl, onProgress, logger }: OllamaServiceDeps): OllamaService {
  let running: AbortController | undefined;

  return {
    status: () => client.status(getBaseUrl()),

    async pull(model) {
      if (!OLLAMA_MODEL_PATTERN.test(model)) {
        return { ok: false, reason: 'invalid-model', message: 'Enter an Ollama model name such as qwen2.5vl:7b.' };
      }
      if (running) return { ok: false, reason: 'busy', message: 'A model is already being downloaded.' };
      const controller = new AbortController();
      running = controller;
      logger.log('info', `Ollama: downloading ${model}`);
      try {
        const result = await client.pull(getBaseUrl(), model, onProgress, controller.signal);
        logger.log(result.ok ? 'info' : 'warn', `Ollama: download of ${model} ${result.ok ? 'finished' : `ended (${result.reason})`}`);
        return result;
      } finally {
        running = undefined;
      }
    },

    cancelPull() {
      running?.abort();
    },
  };
}
