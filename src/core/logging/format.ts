import type { LogLevel } from '../ports';

/** Longest message a log line keeps; longer ones are cut, so no large blob (e.g. a model answer) ends up in the log. */
export const MAX_MESSAGE_LENGTH = 2000;

export const REDACTED = '[redacted]';

/**
 * Secret-looking tokens: OpenRouter / OpenAI style keys (`sk-…`, `sk-or-v1-…`) and bearer tokens.
 * The code never logs the key on purpose (arc42 §8 "Logging"); this is the safety net for error texts.
 */
const API_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{6,}/g;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi;

/**
 * Makes a message safe for the log file: removes secret-looking tokens, keeps it on one line (no forged
 * log lines from file names or error texts) and limits its length.
 */
export function sanitizeLogMessage(message: string): string {
  let text = message.replace(API_KEY_PATTERN, REDACTED).replace(BEARER_PATTERN, `$1${REDACTED}`);
  // Control characters (newlines included) would start a new, forged line.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  if (text.length > MAX_MESSAGE_LENGTH) text = `${text.slice(0, MAX_MESSAGE_LENGTH)}… (truncated)`;
  return text;
}

/** One log line without the trailing newline: `2026-10-15T10:00:00.000Z INFO  Import: …`. */
export function formatLogLine(time: Date, level: LogLevel, message: string): string {
  return `${time.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Whether a message of `level` is written; `debug` only with "Debug logging" on. */
export function isLevelEnabled(level: LogLevel, debug: boolean): boolean {
  return LEVEL_ORDER[level] >= (debug ? LEVEL_ORDER.debug : LEVEL_ORDER.info);
}
