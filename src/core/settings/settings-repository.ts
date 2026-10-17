import type { SettingsTable } from '../db';
import { defaultRules, defaultSettings } from './defaults';
import type { FolderRule, Settings } from './types';
import { validateRules, validateRulesOutsideInbox, validateSettings } from './validation';

export interface SettingsRepository {
  /** Stored values merged over the defaults. */
  getSettings(): Settings;
  /** Validates the merged result and persists the changed keys; throws SettingsValidationError and stores nothing if invalid. */
  updateSettings(patch: Partial<Settings>): Settings;
  /** Whether a value was saved for this setting (as opposed to the built-in default). */
  isStored(key: keyof Settings): boolean;
  /** The saved rules, or the default rules while none were saved yet. */
  listRules(): FolderRule[];
  /** Replaces all rules after validating them (the `Unsorted` fallback must stay, no rule may file into the inbox). */
  saveRules(rules: readonly FolderRule[]): FolderRule[];
}

export interface SettingsRepositoryOptions {
  /** Home directory used for the default paths; defaults to the user's home. */
  home?: string;
}

/** Settings key under which the folder rules are stored (a JSON array of `FolderRule`). */
export const FOLDER_RULES_KEY = 'folderRules';

function parseRules(raw: string | undefined): FolderRule[] {
  if (raw === undefined) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((r): r is FolderRule => typeof r?.folder === 'string' && typeof r?.description === 'string')
      .map((r) => ({ folder: r.folder, description: r.description }));
  } catch {
    // Corrupt value: fall back to the default rules.
    return [];
  }
}

/** Values are stored as JSON in the TEXT column of the `settings` table; the folder rules too, under `folderRules`. */
export function createSettingsRepository(
  tables: { settings: SettingsTable },
  { home }: SettingsRepositoryOptions = {},
): SettingsRepository {
  const defaults = defaultSettings(home);
  const keys = Object.keys(defaults) as (keyof Settings)[];

  const getSettings = (): Settings => {
    const stored = tables.settings.all();
    const result: Record<string, unknown> = { ...defaults };
    for (const key of keys) {
      const raw = stored[key];
      if (raw === undefined) continue;
      try {
        const value: unknown = JSON.parse(raw);
        // Ignore a stored value of the wrong type instead of breaking the app.
        if (typeof value === typeof defaults[key]) result[key] = value;
      } catch {
        // Corrupt value: fall back to the default.
      }
    }
    return result as unknown as Settings;
  };

  return {
    getSettings,
    updateSettings(patch) {
      const next: Settings = { ...getSettings() };
      for (const key of keys) {
        if (patch[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = patch[key];
      }
      validateSettings(next);
      for (const key of keys) {
        if (patch[key] !== undefined) tables.settings.set(key, JSON.stringify(next[key]));
      }
      return next;
    },
    isStored: (key) => tables.settings.get(key) !== undefined,
    listRules() {
      const rules = parseRules(tables.settings.get(FOLDER_RULES_KEY));
      return rules.length > 0 ? rules : defaultRules();
    },
    saveRules(rules) {
      validateRules(rules);
      validateRulesOutsideInbox(rules, getSettings());
      const saved = rules.map((r) => ({ folder: r.folder, description: r.description }));
      tables.settings.set(FOLDER_RULES_KEY, JSON.stringify(saved));
      return saved;
    },
  };
}
