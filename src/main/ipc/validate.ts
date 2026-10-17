/**
 * Argument checks for IPC handlers. The renderer is untrusted, so every handler turns its raw
 * arguments into typed values with these helpers or throws `IpcValidationError`.
 * Messages name the argument but never include its value (they are logged).
 */
import * as path from 'node:path';

export class IpcValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

const fail = (message: string): never => {
  throw new IpcValidationError(message);
};

/** Throws unless there are between `min` and `max` arguments. */
export function expectArity(args: unknown[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    fail(min === max ? `Expected ${min} argument(s), got ${args.length}` : `Expected ${min} to ${max} arguments, got ${args.length}`);
  }
}

/** Throws unless `args` is empty. Use as `validate` for methods without parameters. */
export function expectNoArgs(args: unknown[]): [] {
  if (args.length !== 0) fail(`Expected no arguments, got ${args.length}`);
  return [];
}

export interface StringOptions {
  /** Maximum length in UTF-16 code units. */
  max: number;
  /** Default false. */
  allowEmpty?: boolean;
}

export function expectString(value: unknown, name: string, { max, allowEmpty = false }: StringOptions): string {
  if (typeof value !== 'string') return fail(`${name} must be a string`);
  if (!allowEmpty && value.trim() === '') return fail(`${name} must not be empty`);
  if (value.length > max) return fail(`${name} is too long`);
  if (value.includes('\0')) return fail(`${name} must not contain NUL characters`);
  return value;
}

export function expectBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') return fail(`${name} must be a boolean`);
  return value;
}

export function expectInteger(value: unknown, name: string, { min, max }: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fail(`${name} must be an integer`);
  if (value < min || value > max) return fail(`${name} must be between ${min} and ${max}`);
  return value;
}

export function expectOneOf<T extends string>(value: unknown, name: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) return fail(`${name} must be one of ${options.join(', ')}`);
  return value as T;
}

/** A plain object (no class instance, no array) whose keys are all in `allowed`. */
export function expectObject<K extends string>(value: unknown, name: string, allowed: readonly K[]): Partial<Record<K, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(`${name} must be an object`);
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return fail(`${name} must be a plain object`);
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) fail(`${name} has an unknown property`);
  }
  return value as Partial<Record<K, unknown>>;
}

export function expectArray(value: unknown, name: string, { max }: { max: number }): unknown[] {
  if (!Array.isArray(value)) return fail(`${name} must be an array`);
  if (value.length > max) return fail(`${name} has too many entries`);
  return value;
}

/** Longest path we accept from the renderer (macOS PATH_MAX is 1024 bytes). */
export const MAX_PATH_LENGTH = 1024;

/** An absolute path, returned normalized (no `.`/`..` segments, no trailing separator). */
export function expectAbsolutePath(value: unknown, name: string): string {
  const raw = expectString(value, name, { max: MAX_PATH_LENGTH });
  if (!path.isAbsolute(raw)) return fail(`${name} must be an absolute path`);
  return path.resolve(raw);
}
