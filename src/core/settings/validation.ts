import { join, posix, resolve } from 'node:path';
import { FALLBACK_FOLDER, NAMING_PLACEHOLDERS, PROVIDERS, type FolderRule, type Settings, type SettingsErrorField } from './types';

/** Thrown for invalid settings or rules; the message is meant to be shown to the user. */
export class SettingsValidationError extends Error {
  constructor(
    message: string,
    /** The setting the message is about, so the UI can show it next to that field. */
    readonly field?: SettingsErrorField,
    /** For `field: 'rules'`: position of the offending rule, if one rule is to blame. */
    readonly ruleIndex?: number,
  ) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

export function validateNamingTemplate(template: string): void {
  if (template.trim() === '') throw new SettingsValidationError('The naming template must not be empty.', 'namingTemplate');
  for (const [, name = ''] of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!(NAMING_PLACEHOLDERS as readonly string[]).includes(name)) {
      throw new SettingsValidationError(
        `Unknown placeholder {${name}} in the naming template. Allowed: ${NAMING_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`,
        'namingTemplate',
      );
    }
  }
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, ''))) {
    throw new SettingsValidationError('The naming template has an unbalanced curly brace.', 'namingTemplate');
  }
}

/** Hosts that mean "this Mac": documents sent to Ollama must not leave it (arc42 §8 "AI provider"). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Ollama model names such as `qwen2.5vl:7b` or `library/gemma3:4b`. */
export const OLLAMA_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

/** Throws unless `value` is an `http(s)` address of this Mac, without credentials, path, query or fragment. Returns it without a trailing slash. */
export function validateOllamaUrl(value: string): string {
  const fail = (): never => {
    throw new SettingsValidationError('The Ollama address must point to this Mac, e.g. http://localhost:11434.', 'ollamaUrl');
  };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return fail();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail();
  if (!LOCAL_HOSTS.has(url.hostname)) fail();
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') fail();
  return url.origin;
}

export function validateSettings(settings: Settings): void {
  if (!(PROVIDERS as readonly string[]).includes(settings.provider)) {
    throw new SettingsValidationError(`Unsupported provider "${settings.provider}".`, 'provider');
  }
  if (settings.model.trim() === '') throw new SettingsValidationError('The model must not be empty.', 'model');
  if (!OLLAMA_MODEL_PATTERN.test(settings.ollamaModel)) {
    throw new SettingsValidationError('Enter an Ollama model name such as qwen2.5vl:7b.', 'ollamaModel');
  }
  validateOllamaUrl(settings.ollamaUrl);
  if (settings.inboxPath.trim() === '') throw new SettingsValidationError('The inbox folder must not be empty.', 'inboxPath');
  if (settings.targetPath.trim() === '') throw new SettingsValidationError('The target folder must not be empty.', 'targetPath');
  // Loop protection: the inbox is watched without subfolders, so only the inbox itself is forbidden as target.
  if (resolve(settings.inboxPath) === resolve(settings.targetPath)) {
    throw new SettingsValidationError('The target folder must not be the inbox folder, otherwise filed documents would be imported again.', 'targetPath');
  }
  validateNamingTemplate(settings.namingTemplate);
}

export function validateRules(rules: readonly FolderRule[]): void {
  const seen = new Set<string>();
  rules.forEach(({ folder, description }, index) => {
    const fail = (message: string): never => {
      throw new SettingsValidationError(message, 'rules', index);
    };
    if (folder.trim() === '') fail('A folder name must not be empty.');
    if (description.trim() === '') fail(`The folder "${folder}" needs a description.`);
    // Folder names become paths below the target folder, so they must stay inside it.
    if (folder.includes('\\') || posix.isAbsolute(folder) || folder.split('/').some((part) => part.trim() === '' || part === '.' || part === '..')) {
      fail(`Invalid folder name "${folder}": use relative names like "Insurance/Car".`);
    }
    const key = folder.toLowerCase();
    if (seen.has(key)) fail(`The folder "${folder}" is defined twice.`);
    seen.add(key);
  });
  if (!rules.some((rule) => rule.folder === FALLBACK_FOLDER)) {
    throw new SettingsValidationError(`The fallback folder "${FALLBACK_FOLDER}" cannot be removed.`, 'rules');
  }
}

/**
 * The inbox may be a folder inside the target (the default is `Filey/Inbox` next to the filed documents). A rule
 * that files into that very folder would put documents back into the inbox, where they are imported again.
 */
export function validateRulesOutsideInbox(rules: readonly FolderRule[], { inboxPath, targetPath }: Pick<Settings, 'inboxPath' | 'targetPath'>): void {
  // APFS is case-insensitive by default, so "inbox" and "Inbox" are the same folder.
  const inbox = resolve(inboxPath).toLowerCase();
  const index = rules.findIndex((rule) => resolve(join(targetPath, rule.folder)).toLowerCase() === inbox);
  if (index >= 0) {
    throw new SettingsValidationError(`The folder "${rules[index]?.folder}" is the inbox folder: filed documents would be imported again. Choose another name.`, 'rules', index);
  }
}
