import { createCipheriv, createHash } from 'node:crypto';

/**
 * Whether the PDF can only be opened with a password, so no model can read it. PDFs that are encrypted with an
 * empty user password (only an owner password restricting printing or copying, common for bank statements) open
 * without one and count as readable. Anything this check does not understand counts as readable too: the model
 * gets the file and the analysis timeout is the backstop.
 */
export function needsPassword(pdf: Buffer): boolean {
  if (!pdf.includes('/Encrypt')) return false;
  try {
    const text = pdf.toString('latin1');
    const encrypt = encryptDictionary(text);
    if (!encrypt) return false;
    // Certificate (public key) security handlers always need something the user has to supply.
    if (encrypt.Filter instanceof PdfName && encrypt.Filter.name !== 'Standard') return true;
    return !opensWithEmptyPassword(encrypt);
  } catch {
    return false;
  }
}

// --- A minimal reader for the few PDF objects this check needs ---------------------------------------------

class PdfName {
  constructor(readonly name: string) {}
}

class PdfRef {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}

type PdfValue = number | boolean | null | Buffer | PdfName | PdfRef | PdfValue[] | PdfDict;
interface PdfDict {
  [key: string]: PdfValue;
}

const WHITESPACE = /[\0\t\n\f\r ]/;
const DELIMITER = /[\0\t\n\f\r ()<>[\]{}/%]/;

function skipSpace(s: string, i: number): number {
  while (i < s.length) {
    if (WHITESPACE.test(s[i]!)) i++;
    else if (s[i] === '%') while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    else break;
  }
  return i;
}

function readToken(s: string, i: number): [string, number] {
  let end = i;
  while (end < s.length && !DELIMITER.test(s[end]!)) end++;
  return [s.slice(i, end), end];
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

function readLiteralString(s: string, i: number): [Buffer, number] {
  let out = '';
  let depth = 1;
  i++; // (
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\') {
      const n = s[i + 1]!;
      if (n in ESCAPES) {
        out += ESCAPES[n];
        i += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        i += 1 + oct.length;
      } else if (n === '\r') {
        i += s[i + 2] === '\n' ? 3 : 2;
      } else if (n === '\n') {
        i += 2;
      } else {
        out += n;
        i += 2;
      }
      continue;
    }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return [Buffer.from(out, 'latin1'), i + 1];
    out += c;
    i++;
  }
  throw new Error('unterminated string');
}

function readValue(s: string, start: number): [PdfValue, number] {
  let i = skipSpace(s, start);
  const c = s[i];
  if (c === '<' && s[i + 1] === '<') {
    const dict: PdfDict = {};
    i += 2;
    for (;;) {
      i = skipSpace(s, i);
      if (s[i] === '>' && s[i + 1] === '>') return [dict, i + 2];
      if (s[i] !== '/') throw new Error('expected a name');
      const [key, afterKey] = readToken(s, i + 1);
      const [value, afterValue] = readValue(s, afterKey);
      dict[key] = value;
      i = afterValue;
    }
  }
  if (c === '<') {
    const end = s.indexOf('>', i);
    if (end < 0) throw new Error('unterminated hex string');
    let hex = s.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
    if (hex.length % 2) hex += '0';
    return [Buffer.from(hex, 'hex'), end + 1];
  }
  if (c === '(') return readLiteralString(s, i);
  if (c === '[') {
    const items: PdfValue[] = [];
    i++;
    for (;;) {
      i = skipSpace(s, i);
      if (s[i] === ']') return [items, i + 1];
      const [value, next] = readValue(s, i);
      items.push(value);
      i = next;
    }
  }
  if (c === '/') {
    const [name, end] = readToken(s, i + 1);
    return [new PdfName(name), end];
  }
  const [token, end] = readToken(s, i);
  if (token === 'true' || token === 'false') return [token === 'true', end];
  if (token === 'null') return [null, end];
  if (token === '' || Number.isNaN(Number(token))) throw new Error(`unexpected token at ${i}`);
  // An indirect reference: "12 0 R".
  const ref = /^[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+R(?![^\0\t\n\f\r ()<>[\]{}/%])/.exec(s.slice(end, end + 32));
  if (/^\d+$/.test(token) && ref) return [new PdfRef(Number(token), Number(ref[1])), end + ref[0].length];
  return [Number(token), end];
}

/** The body of the last definition of object `num gen` (later incremental updates win). */
function readObject(s: string, ref: PdfRef): PdfValue {
  const pattern = new RegExp(`(?<![0-9])${ref.num}[\\0\\t\\n\\f\\r ]+${ref.gen}[\\0\\t\\n\\f\\r ]+obj\\b`, 'g');
  let last: RegExpExecArray | null = null;
  for (let m = pattern.exec(s); m; m = pattern.exec(s)) last = m;
  if (!last) throw new Error('object not found');
  return readValue(s, last.index + last[0].length)[0];
}

/** The last trailer (or cross-reference stream) dictionary that carries `/Encrypt`, read as a dictionary. */
function trailerWithEncrypt(s: string): PdfDict | undefined {
  const pattern = /\/Encrypt(?![^\0\t\n\f\r ()<>[\]{}/%])/g;
  let found: PdfDict | undefined;
  for (let m = pattern.exec(s); m; m = pattern.exec(s)) {
    // Walk back to the "<<" that opens the dictionary holding this key, then read the whole dictionary.
    let depth = 0;
    for (let i = m.index - 1; i > 0; i--) {
      if (s[i] === '>' && s[i - 1] === '>') {
        depth++;
        i--;
      } else if (s[i] === '<' && s[i - 1] === '<') {
        i--;
        if (depth-- === 0) {
          try {
            const [dict] = readValue(s, i);
            if (dict && typeof dict === 'object' && !Array.isArray(dict) && 'Encrypt' in dict) found = dict as PdfDict;
          } catch {
            // Not a dictionary we can read (e.g. inside a binary stream); ignore this occurrence.
          }
          break;
        }
      }
    }
  }
  return found;
}

interface EncryptInfo extends PdfDict {
  /** The first element of the trailer's file identifier (needed by revisions 2 to 4). */
  __id: Buffer;
}

function encryptDictionary(s: string): EncryptInfo | undefined {
  const trailer = trailerWithEncrypt(s);
  if (!trailer) return undefined;
  const value = trailer.Encrypt instanceof PdfRef ? readObject(s, trailer.Encrypt) : trailer.Encrypt;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value) || value instanceof PdfName || value instanceof PdfRef) {
    return undefined;
  }
  const id = Array.isArray(trailer.ID) && Buffer.isBuffer(trailer.ID[0]) ? trailer.ID[0] : Buffer.alloc(0);
  return { ...value, __id: id };
}

// --- Standard security handler (ISO 32000-2, 7.6.4) ---------------------------------------------------------

const PADDING = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

function rc4(key: Buffer, data: Buffer): Buffer {
  const S = Array.from({ length: 256 }, (_, k) => k);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xff;
    [S[i], S[j]] = [S[j]!, S[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]!) & 0xff;
    [S[i], S[j]] = [S[j]!, S[i]!];
    out[n] = data[n]! ^ S[(S[i]! + S[j]!) & 0xff]!;
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest();
const num = (value: PdfValue | undefined, fallback: number) => (typeof value === 'number' ? value : fallback);
const bytes = (value: PdfValue | undefined) => (Buffer.isBuffer(value) ? value : undefined);

function opensWithEmptyPassword(encrypt: EncryptInfo): boolean {
  const revision = num(encrypt.R, 0);
  const owner = bytes(encrypt.O);
  const user = bytes(encrypt.U);
  if (revision < 2 || revision > 6 || !owner || !user) return true; // Unknown layout: let the model try.

  if (revision >= 5) {
    const salt = user.subarray(32, 40);
    const hash = revision === 5 ? createHash('sha256').update(salt).digest() : hardenedHash(salt);
    return hash.equals(user.subarray(0, 32));
  }

  // Algorithm 2: the file key for the empty password.
  const p = Buffer.alloc(4);
  p.writeInt32LE(num(encrypt.P, 0) | 0);
  const length = revision === 2 ? 5 : Math.floor(num(encrypt.Length, 40) / 8);
  const parts = [PADDING, owner.subarray(0, 32), p, encrypt.__id];
  if (revision >= 4 && encrypt.EncryptMetadata === false) parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  let key = md5(...parts);
  if (revision >= 3) for (let k = 0; k < 50; k++) key = md5(key.subarray(0, length));
  key = key.subarray(0, length);

  if (revision === 2) return rc4(key, PADDING).equals(user.subarray(0, 32));
  // Algorithm 5 (revisions 3 and 4): only the first 16 bytes of /U are defined.
  let check = rc4(key, md5(PADDING, encrypt.__id));
  for (let k = 1; k <= 19; k++) check = rc4(Buffer.from(key.map((b) => b ^ k)), check);
  return check.equals(user.subarray(0, 16));
}

/** Algorithm 2.B (revision 6) for the empty password and no extra user data. */
function hardenedHash(salt: Buffer): Buffer {
  let k = createHash('sha256').update(salt).digest();
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => k));
    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([cipher.update(k1), cipher.final()]);
    let mod = 0;
    for (let b = 0; b < 16; b++) mod += e[b]!;
    k = createHash(['sha256', 'sha384', 'sha512'][mod % 3]!).update(e).digest();
    if (round >= 63 && e[e.length - 1]! <= round - 31) break;
  }
  return k.subarray(0, 32);
}
