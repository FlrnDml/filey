/** What Ollama reports on the saved address (arc42 §6.2). */
export interface OllamaStatus {
  /** Whether a server answered on the address. */
  running: boolean;
  /** Ollama's version, e.g. `0.12.3`; only when it is running. */
  version?: string;
  /** Names of the installed models, e.g. `qwen2.5vl:7b`; empty when it is not running. */
  models: string[];
}

/** One progress update of a model download. `completed` and `total` are bytes of the current layer and may be missing. */
export interface OllamaPullProgress {
  model: string;
  /** Ollama's step text, e.g. `pulling manifest`, `pulling 3a6e…`, `success`. */
  status: string;
  completed?: number;
  total?: number;
}

export type OllamaPullFailure = 'not-running' | 'unknown-model' | 'busy' | 'cancelled' | 'invalid-model' | 'failed';

/** Outcome of a model download. `message` is fixed, user-facing text. */
export type OllamaPullResult = { ok: true } | { ok: false; reason: OllamaPullFailure; message: string };
