/**
 * "Check names" (arc42 §5.4): whether a file name follows the file-name part of the naming template. Pure.
 */
import { MAX_SENDER_LENGTH } from '../filer/naming';

/** The part of the naming template after the last `/`: the file name. `{category}` before it is not checked. */
export function fileNameTemplate(template: string): string {
  const parts = template.normalize('NFC').replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? template;
}

const PLACEHOLDER_PATTERNS: Record<string, string> = {
  date: '\\d{4}-\\d{2}-\\d{2}',
  sender: `[^/]{1,${MAX_SENDER_LENGTH}}`,
  title: '[^/]+',
  category: '[^/]+',
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a matcher for file names made from the naming template: `{date}` is `YYYY-MM-DD`, `{sender}` 1 to 10
 * characters, `{title}` any text; a collision suffix (`_2`) before the extension is allowed. Case-insensitive like APFS.
 */
export function createNameMatcher(template: string): (fileName: string) => boolean {
  const fileTemplate = fileNameTemplate(template);
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(fileTemplate)?.[0] ?? '';
  const stem = fileTemplate.slice(0, fileTemplate.length - ext.length);
  const body = stem
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name === undefined ? escape(part) : (PLACEHOLDER_PATTERNS[name] ?? escape(part));
    })
    .join('');
  const pattern = new RegExp(`^${body}(?:_\\d+)?${escape(ext)}$`, 'iu');
  return (fileName) => pattern.test(fileName.normalize('NFC'));
}

/** Only PDFs are checked and renamed. */
export const isPdfName = (fileName: string) => /\.pdf$/i.test(fileName);
