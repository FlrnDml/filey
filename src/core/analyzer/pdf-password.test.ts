import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsPassword } from './pdf-password';

/** Generated with pypdf: one blank page, encrypted with the named algorithm. */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.pdf`));
const ALGORITHMS = ['rc4-40', 'rc4-128', 'aes-128', 'aes-256-r5', 'aes-256'];

describe('needsPassword', () => {
  it('is false for an unencrypted PDF', () => {
    expect(needsPassword(fixture('plain'))).toBe(false);
  });

  it.each(ALGORITHMS)('is true for a PDF with a user password (%s)', (algorithm) => {
    expect(needsPassword(fixture(`${algorithm}-user-password`))).toBe(true);
  });

  it.each(ALGORITHMS)('is false for a PDF with only an owner password (%s)', (algorithm) => {
    expect(needsPassword(fixture(`${algorithm}-owner-only`))).toBe(false);
  });

  it('reads the encryption dictionary with literal strings and an inline reference in the trailer', () => {
    // Same file as rc4-40-user-password, with /O and /U rewritten as literal strings (escapes included).
    const pdf = fixture('rc4-40-user-password').toString('latin1');
    const literal = (hex: string) =>
      `(${Array.from(Buffer.from(hex, 'hex'), (b) => (b < 0x20 || b > 0x7e || b === 0x28 || b === 0x29 || b === 0x5c ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('')})`;
    const rewritten = pdf.replace(/\/(O|U) <([0-9a-f]+)>/g, (_m, key: string, hex: string) => `/${key} ${literal(hex)}`);
    expect(rewritten).not.toBe(pdf);
    expect(needsPassword(Buffer.from(rewritten, 'latin1'))).toBe(true);
  });

  it('treats a non-standard security handler as needing a password', () => {
    const pdf = fixture('rc4-40-owner-only').toString('latin1').replace('/Filter /Standard', '/Filter /Adobe.PubSec');
    expect(needsPassword(Buffer.from(pdf, 'latin1'))).toBe(true);
  });

  it('is false for input it cannot parse', () => {
    expect(needsPassword(Buffer.from('%PDF-1.4 trailer << /Encrypt 9 0 R >>'))).toBe(false);
    expect(needsPassword(Buffer.from('not a pdf /Encrypt <<'))).toBe(false);
    expect(needsPassword(Buffer.alloc(0))).toBe(false);
  });
});
