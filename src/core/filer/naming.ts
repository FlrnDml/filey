/** Turns analyzer output into a safe relative target path (arc42 §5.2, §8 "File names"). Pure, no I/O. */
import { FALLBACK_FOLDER } from '../settings/types';

/** What the Analyzer returns (arc42 §5.2); every value may be missing. */
export interface DocumentInfo {
  /** `YYYY-MM-DD` */
  date?: string | null;
  sender?: string | null;
  title?: string | null;
  /** Folder name; `/` separates nested folders, e.g. `Health/Health insurance`. */
  category?: string | null;
}

export const MAX_SENDER_LENGTH = 10;
/** APFS allows 255 UTF-8 bytes per name; keep headroom for a collision suffix such as `_12`. */
export const MAX_SEGMENT_BYTES = 200;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const SEPARATORS = /[/\\:]/g;
const ILLEGAL = /[*?"<>|]/g;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Cuts to at most `max` characters (code points, so no surrogate pair is split). */
function truncateChars(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

function truncateBytes(value: string, max: number): string {
  let out = '';
  for (const ch of value) {
    if (byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Models sometimes return HTML-escaped text (`R&#xF6;ntgen` for `Röntgen`). Decodes numeric and the common named
 * entities once, so the characters end up as intended. Runs before the path sanitizing below, so a decoded `/`,
 * `..` or `<` is still neutralized. Unknown or invalid entities stay as they are.
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]+));/gi, (match, hex?: string, dec?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const codePoint = hex ? parseInt(hex, 16) : parseInt(dec ?? '', 10);
    const isValid = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
    return isValid ? String.fromCodePoint(codePoint) : match;
  });
}

/** Sanitizes one value for use inside a single path segment. Returns '' if nothing usable is left. */
export function sanitizeValue(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? '')
    .normalize('NFC')
    .replace(SEPARATORS, '-')
    .replace(CONTROL_CHARS, ' ')
    .replace(ILLEGAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // no hidden files, no `.` / `..`
    .trim();
}

/** Sanitizes a category: `/` stays as folder separator, every segment is cleaned on its own. */
function sanitizeCategory(category: string | null | undefined): string {
  const segments = (category ?? '')
    .normalize('NFC')
    .replace(/\\/g, '/')
    .split('/')
    .map(sanitizeValue)
    .filter((s) => s !== '');
  return segments.length > 0 ? segments.join('/') : FALLBACK_FOLDER;
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Shortens a segment to the byte limit and keeps a file extension such as `.pdf` intact. */
function limitSegment(segment: string, isFile: boolean): string {
  if (byteLength(segment) <= MAX_SEGMENT_BYTES) return segment;
  const dot = segment.lastIndexOf('.');
  const ext = isFile && dot > 0 && segment.length - dot <= 10 ? segment.slice(dot) : '';
  const stem = truncateBytes(segment.slice(0, segment.length - ext.length), MAX_SEGMENT_BYTES - byteLength(ext)).trim();
  return stem + ext;
}

/**
 * Fills the naming template (e.g. `{category}/{date}_{sender}_{title}.pdf`) and returns a sanitized path
 * relative to the target root, with `/` separators. Missing values use fallbacks: today's date (from `now`),
 * `Unknown`, `Untitled`, `Unsorted`. The result never contains `.`/`..` segments, so it cannot escape the root.
 */
export function renderPath(template: string, info: DocumentInfo, now: Date): string {
  const date = info.date && ISO_DATE.test(info.date.trim()) ? info.date.trim() : localDate(now);
  const sender = truncateChars(sanitizeValue(info.sender), MAX_SENDER_LENGTH).trim() || 'Unknown';
  const title = sanitizeValue(info.title) || 'Untitled';
  const values: Record<string, string> = { category: sanitizeCategory(info.category), date, sender, title };

  const filled = template.normalize('NFC').replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
  const segments = filled
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(CONTROL_CHARS, ' ').replace(ILLEGAL, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  if (segments.length === 0) return `${values.date}_${values.sender}_${values.title}.pdf`;
  return segments.map((s, i) => limitSegment(s, i === segments.length - 1)).join('/');
}
