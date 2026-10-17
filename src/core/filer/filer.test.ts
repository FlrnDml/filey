import { describe, expect, it } from 'vitest';
import type { FileSystem } from '../ports';
import { fileDocument, renderPath, MAX_SEGMENT_BYTES } from './index';

const TEMPLATE = '{category}/{date}_{sender}_{title}.pdf';
const NOW = new Date(2026, 9, 15, 12, 0, 0);

class FakeFs implements FileSystem {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  crossVolume = false;
  failRename: (Error & { code?: string }) | undefined;
  onRename: (() => void) | undefined;

  add(path: string, content = 'pdf') {
    this.files.set(path, new TextEncoder().encode(content));
  }
  async readFile(p: string) {
    const f = this.files.get(p);
    if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return f;
  }
  async writeFile(p: string, data: Uint8Array | string) {
    this.files.set(p, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
  async rename(from: string, to: string) {
    this.onRename?.();
    if (this.failRename) throw this.failRename;
    if (this.crossVolume) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    const f = await this.readFile(from);
    this.files.delete(from);
    this.files.set(to, f);
  }
  async exists(p: string) {
    return this.files.has(p) || this.dirs.has(p);
  }
  async readDir() {
    return [];
  }
  async mkdir(p: string) {
    this.dirs.add(p);
  }
  async remove(p: string) {
    await this.readFile(p);
    this.files.delete(p);
  }
}

const info = { date: '2026-10-15', sender: 'Northwind', title: 'Invoice', category: 'Health/Health insurance' };

describe('renderPath', () => {
  it('renders the default template', () => {
    expect(renderPath(TEMPLATE, info, NOW)).toBe('Health/Health insurance/2026-10-15_Northwind_Invoice.pdf');
  });

  it('uses fallbacks for missing values', () => {
    expect(renderPath(TEMPLATE, {}, NOW)).toBe('Unsorted/2026-10-15_Unknown_Untitled.pdf');
    expect(renderPath(TEMPLATE, { date: null, sender: null, title: null, category: null }, new Date(2027, 0, 5))).toBe(
      'Unsorted/2027-01-05_Unknown_Untitled.pdf',
    );
  });

  it('uses fallbacks for values that are empty after sanitizing', () => {
    expect(renderPath(TEMPLATE, { ...info, sender: '  ??  ', title: '***', category: '/../' }, NOW)).toBe(
      'Unsorted/2026-10-15_Unknown_Untitled.pdf',
    );
  });

  it('falls back to today for a malformed date', () => {
    expect(renderPath(TEMPLATE, { ...info, date: '15.10.2026' }, NOW)).toContain('/2026-10-15_');
  });

  it('cuts the sender to 10 characters', () => {
    expect(renderPath(TEMPLATE, { ...info, sender: 'Northwind Health Insurance' }, NOW)).toBe(
      'Health/Health insurance/2026-10-15_Northwind_Invoice.pdf',
    );
    expect(renderPath(TEMPLATE, { ...info, sender: '1234567890' }, NOW)).toContain('_1234567890_');
    expect(renderPath(TEMPLATE, { ...info, sender: '12345678901' }, NOW)).toContain('_1234567890_');
  });

  it('does not split emoji when cutting the sender', () => {
    expect(renderPath(TEMPLATE, { ...info, sender: '😀'.repeat(12) }, NOW)).toContain(`_${'😀'.repeat(10)}_`);
  });

  it('cuts an NFD sender after NFC normalization and trims whitespace left by the cut', () => {
    expect(renderPath(TEMPLATE, { ...info, sender: 'Müller Bäcker'.normalize('NFD') }, NOW)).toContain('_Müller Bäc_');
    expect(renderPath(TEMPLATE, { ...info, sender: 'Müller AG Bank'.normalize('NFD') }, NOW)).toContain('_Müller AG_');
  });

  it('normalizes NFD input to NFC', () => {
    const nfd = 'Müller Bäcker'.normalize('NFD');
    expect(nfd).not.toBe('Müller Bäcker');
    const out = renderPath(TEMPLATE, { ...info, title: nfd, category: 'Finänzen'.normalize('NFD') }, NOW);
    expect(out).toBe('Finänzen/2026-10-15_Northwind_Müller Bäcker.pdf');
  });

  it('replaces / and : in sender and title, removes other illegal characters', () => {
    expect(renderPath(TEMPLATE, { ...info, sender: 'A/B', title: 'Re: 10/2026 "Offer"? <x>|*' }, NOW)).toBe(
      'Health/Health insurance/2026-10-15_A-B_Re- 10-2026 Offer x.pdf',
    );
  });

  it('keeps / as folder separator only in the category', () => {
    expect(renderPath('{category}/{title}.pdf', { ...info, category: 'A/B:C/D', title: 'x/y' }, NOW)).toBe('A/B-C/D/x-y.pdf');
  });

  it('collapses whitespace and control characters', () => {
    expect(renderPath(TEMPLATE, { ...info, title: ' a \n\t b\u0000c ' }, NOW)).toContain('_a b c.pdf');
  });

  it('neutralizes path traversal through category and title', () => {
    for (const evil of ['../../etc', '..', '/etc/passwd', '..\\..\\x', 'a/../../b', '.', './.hidden']) {
      const out = renderPath(TEMPLATE, { ...info, category: evil, title: evil }, NOW);
      expect(out.split('/')).not.toContain('..');
      expect(out.split('/')).not.toContain('.');
      expect(out.startsWith('/')).toBe(false);
      expect(out).not.toContain('\\');
    }
    expect(renderPath('{category}/{title}.pdf', { ...info, category: '../../etc', title: '../x' }, NOW)).toBe('etc/-x.pdf');
  });

  it('does not produce hidden files', () => {
    expect(renderPath(TEMPLATE, { ...info, title: '.hidden' }, NOW)).toContain('_Northwind_hidden.pdf');
  });

  it('limits long segments by bytes and keeps the extension', () => {
    const out = renderPath(TEMPLATE, { ...info, title: 'ä'.repeat(500), category: 'K'.repeat(500) }, NOW);
    const [folder = '', file = ''] = out.split('/');
    expect(new TextEncoder().encode(folder).length).toBeLessThanOrEqual(MAX_SEGMENT_BYTES);
    expect(new TextEncoder().encode(file).length).toBeLessThanOrEqual(MAX_SEGMENT_BYTES);
    expect(file.endsWith('.pdf')).toBe(true);
    expect(file.startsWith('2026-10-15_Northwind_ä')).toBe(true);
  });

  it('supports other templates and leaves unknown placeholders alone', () => {
    expect(renderPath('{date} {sender}.pdf', info, NOW)).toBe('2026-10-15 Northwind.pdf');
    expect(renderPath('{title}-{foo}.pdf', info, NOW)).toBe('Invoice-{foo}.pdf');
  });

  it('never returns an empty path', () => {
    expect(renderPath('', info, NOW)).toBe('2026-10-15_Northwind_Invoice.pdf');
  });
});

describe('fileDocument', () => {
  const root = '/target';
  const rel = 'Health/Health insurance/2026-10-15_Northwind_Invoice.pdf';

  it('creates folders, moves the file and removes the source', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf', 'data');
    const res = await fileDocument('/inbox/scan.pdf', root, rel, fs);
    expect(res).toEqual({ status: 'filed', path: `/target/${rel}` });
    expect(fs.dirs.has('/target/Health/Health insurance')).toBe(true);
    expect(fs.files.has('/inbox/scan.pdf')).toBe(false);
    expect(new TextDecoder().decode(fs.files.get(`/target/${rel}`))).toBe('data');
  });

  it('resolves collisions with _2, then _3, without overwriting', async () => {
    const fs = new FakeFs();
    fs.add(`/target/${rel}`, 'old');
    fs.add('/inbox/a.pdf', 'a');
    fs.add('/inbox/b.pdf', 'b');
    const a = await fileDocument('/inbox/a.pdf', root, rel, fs);
    const b = await fileDocument('/inbox/b.pdf', root, rel, fs);
    expect(a).toEqual({ status: 'filed', path: '/target/Health/Health insurance/2026-10-15_Northwind_Invoice_2.pdf' });
    expect(b).toEqual({ status: 'filed', path: '/target/Health/Health insurance/2026-10-15_Northwind_Invoice_3.pdf' });
    expect(new TextDecoder().decode(fs.files.get(`/target/${rel}`))).toBe('old');
  });

  it('reports a vanished source (before the move)', async () => {
    const fs = new FakeFs();
    expect(await fileDocument('/inbox/gone.pdf', root, rel, fs)).toEqual({ status: 'vanished' });
    expect(fs.dirs.size).toBe(0);
  });

  it('reports a source that vanishes during the move', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf');
    fs.onRename = () => fs.files.delete('/inbox/scan.pdf');
    expect(await fileDocument('/inbox/scan.pdf', root, rel, fs)).toEqual({ status: 'vanished' });
  });

  it('rejects other move failures and leaves the source untouched', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf');
    fs.failRename = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    await expect(fileDocument('/inbox/scan.pdf', root, rel, fs)).rejects.toThrow('EACCES');
    expect(fs.files.has('/inbox/scan.pdf')).toBe(true);
  });

  it('falls back to copy, verify and delete across volumes', async () => {
    const fs = new FakeFs();
    fs.crossVolume = true;
    fs.add('/inbox/scan.pdf', 'data');
    const res = await fileDocument('/inbox/scan.pdf', root, rel, fs);
    expect(res).toEqual({ status: 'filed', path: `/target/${rel}` });
    expect(fs.files.has('/inbox/scan.pdf')).toBe(false);
    expect(new TextDecoder().decode(fs.files.get(`/target/${rel}`))).toBe('data');
  });

  it('keeps the source and removes the copy if verification fails', async () => {
    const fs = new FakeFs();
    fs.crossVolume = true;
    fs.add('/inbox/scan.pdf', 'data');
    fs.writeFile = async (p) => {
      fs.files.set(p, new TextEncoder().encode('corrupt'));
    };
    await expect(fileDocument('/inbox/scan.pdf', root, rel, fs)).rejects.toThrow('could not be verified');
    expect(fs.files.has('/inbox/scan.pdf')).toBe(true);
    expect(fs.files.has(`/target/${rel}`)).toBe(false);
  });

  it('refuses to file directly into the inbox', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf');
    await expect(fileDocument('/inbox/scan.pdf', '/inbox', 'x.pdf', fs, { inboxPath: '/inbox/' })).rejects.toThrow('inbox');
    expect(fs.files.has('/inbox/scan.pdf')).toBe(true);
  });

  it('allows a target tree below the inbox', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf');
    const res = await fileDocument('/inbox/scan.pdf', '/inbox', 'Sub/x.pdf', fs, { inboxPath: '/inbox' });
    expect(res).toEqual({ status: 'filed', path: '/inbox/Sub/x.pdf' });
  });

  it('refuses a relative path that escapes the target root', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf');
    await expect(fileDocument('/inbox/scan.pdf', root, '../evil.pdf', fs)).rejects.toThrow('escapes');
    expect(fs.files.has('/inbox/scan.pdf')).toBe(true);
  });

  it('works end to end with renderPath', async () => {
    const fs = new FakeFs();
    fs.add('/inbox/scan.pdf');
    const relPath = renderPath(TEMPLATE, { ...info, category: '../../x' }, NOW);
    const res = await fileDocument('/inbox/scan.pdf', root, relPath, fs);
    expect(res).toEqual({ status: 'filed', path: '/target/x/2026-10-15_Northwind_Invoice.pdf' });
  });
});
