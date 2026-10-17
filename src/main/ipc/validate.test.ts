import { describe, expect, it } from 'vitest';
import {
  expectAbsolutePath,
  expectArity,
  expectArray,
  expectBoolean,
  expectInteger,
  expectNoArgs,
  expectObject,
  expectOneOf,
  expectString,
  IpcValidationError,
} from './validate';

const SECRET = 'sk-or-SECRET';

describe('IPC validation helpers', () => {
  it('checks the number of arguments', () => {
    expect(expectNoArgs([])).toEqual([]);
    expect(() => expectNoArgs([1])).toThrow(IpcValidationError);
    expect(() => expectArity([], 1)).toThrow();
    expect(() => expectArity([1, 2], 0, 1)).toThrow();
    expect(() => expectArity([1], 0, 1)).not.toThrow();
  });

  it('checks strings: type, emptiness, length and NUL bytes', () => {
    expect(expectString('a', 'x', { max: 1 })).toBe('a');
    expect(expectString('', 'x', { max: 1, allowEmpty: true })).toBe('');
    expect(() => expectString(' ', 'x', { max: 5 })).toThrow(/must not be empty/);
    expect(() => expectString('ab', 'x', { max: 1 })).toThrow(/too long/);
    expect(() => expectString('a\0b', 'x', { max: 5 })).toThrow(/NUL/);
    expect(() => expectString(1, 'x', { max: 5 })).toThrow(/must be a string/);
  });

  it('checks booleans, integers and enums', () => {
    expect(expectBoolean(false, 'b')).toBe(false);
    expect(() => expectBoolean(0, 'b')).toThrow();
    expect(expectInteger(3, 'n', { min: 1, max: 3 })).toBe(3);
    for (const bad of [0, 4, 1.5, Number.NaN, Infinity, '2']) expect(() => expectInteger(bad, 'n', { min: 1, max: 3 })).toThrow();
    expect(expectOneOf('a', 'k', ['a', 'b'])).toBe('a');
    expect(() => expectOneOf('c', 'k', ['a', 'b'])).toThrow();
  });

  it('accepts only plain objects with known keys', () => {
    expect(expectObject({ a: 1 }, 'o', ['a'])).toEqual({ a: 1 });
    expect(expectObject(Object.create(null) as object, 'o', ['a'])).toEqual({});
    expect(() => expectObject({ b: 1 }, 'o', ['a'])).toThrow(/unknown property/);
    expect(() => expectObject([], 'o', ['a'])).toThrow();
    expect(() => expectObject(null, 'o', ['a'])).toThrow();
    expect(() => expectObject(new Map(), 'o', ['a'])).toThrow(/plain object/);
  });

  it('checks arrays and absolute paths', () => {
    expect(expectArray([1], 'a', { max: 1 })).toEqual([1]);
    expect(() => expectArray([1, 2], 'a', { max: 1 })).toThrow();
    expect(() => expectArray('x', 'a', { max: 1 })).toThrow();
    expect(expectAbsolutePath('/Users/u/Inbox/../Scans/', 'p')).toBe('/Users/u/Scans');
    expect(() => expectAbsolutePath('Inbox', 'p')).toThrow(/absolute/);
    expect(() => expectAbsolutePath('/' + 'a'.repeat(2000), 'p')).toThrow(/too long/);
  });

  it('never puts the value into the message', () => {
    const messages: string[] = [];
    for (const fn of [
      () => expectString(SECRET, 'key', { max: 3 }),
      () => expectOneOf(SECRET, 'kind', ['a']),
      () => expectObject({ [SECRET]: 1 }, 'o', ['a']),
      () => expectAbsolutePath(SECRET, 'p'),
    ]) {
      try {
        fn();
      } catch (err) {
        messages.push((err as Error).message);
      }
    }
    expect(messages).toHaveLength(4);
    expect(messages.join('\n')).not.toContain(SECRET);
  });
});
