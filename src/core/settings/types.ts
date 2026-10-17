/** One folder rule: which kind of document belongs in `folder` (relative to the target folder). */
export interface FolderRule {
  folder: string;
  description: string;
}

export interface Settings {
  /** Only OpenRouter for now; kept as a setting so further providers can be added later (arc42 §8 "AI provider"). */
  provider: 'openrouter';
  model: string;
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

export const PROVIDERS = ['openrouter'] as const;
export const NAMING_PLACEHOLDERS = ['category', 'date', 'sender', 'title'] as const;

/** Default model, see arc42 §6.2. Kept here (no Node imports) so the renderer can show it. */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';
export const DEFAULT_NAMING_TEMPLATE = '{category}/{date}_{sender}_{title}.pdf';

/** Fallback folder for documents that match no rule; it can never be removed. */
export const FALLBACK_FOLDER = 'Unsorted';
