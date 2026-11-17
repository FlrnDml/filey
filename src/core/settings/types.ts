/** One folder rule: which kind of document belongs in `folder` (relative to the target folder). */
export interface FolderRule {
  folder: string;
  description: string;
}

export interface Settings {
  /** Where the AI runs: OpenRouter (cloud, own API key) or Ollama on this Mac (arc42 §8 "AI provider"). */
  provider: 'openrouter' | 'ollama';
  /** OpenRouter model id. Each provider keeps its own model, so switching back and forth loses nothing. */
  model: string;
  /** Address of the local Ollama server; the host must be this Mac (`validateOllamaUrl`). */
  ollamaUrl: string;
  /** Ollama model name, e.g. `qwen2.5vl:7b`. */
  ollamaModel: string;
  /** Watched folder (without subfolders). */
  inboxPath: string;
  /** Root folder the documents are filed into. */
  targetPath: string;
  /** Naming template, e.g. `{category}/{date}_{sender}_{title}.pdf`. */
  namingTemplate: string;
  autostart: boolean;
  debugLogging: boolean;
  onboardingCompleted: boolean;
}

/** What a `SettingsValidationError` points at: one setting, or the folder rules. */
export type SettingsErrorField = keyof Settings | 'rules';

export const PROVIDERS = ['openrouter', 'ollama'] as const;
export const NAMING_PLACEHOLDERS = ['category', 'date', 'sender', 'title'] as const;

/** Default model, see arc42 §6.2. Kept here (no Node imports) so the renderer can show it. */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';
/** Ollama's default address and the recommended vision model for a 16 GB Apple Silicon Mac (arc42 §8 "AI provider"). */
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5vl:7b';
export const DEFAULT_NAMING_TEMPLATE = '{category}/{date}_{sender}_{title}.pdf';

/** Fallback folder for documents that match no rule; it can never be removed. */
export const FALLBACK_FOLDER = 'Unsorted';

/** Limits main accepts for folder rules from the renderer (`settings.saveRules`). */
export const RULE_LIMITS = { rules: 200, folder: 255, description: 2000 } as const;
