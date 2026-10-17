import { describe, expect, it } from 'vitest';
import {
  collectRuntimePackages,
  renderThirdPartyLicenses,
  type PackageLicense,
} from '../scripts/build-third-party-licenses.mts';

/** Licenses that can be shipped in a closed-source or MIT-licensed binary with only an attribution notice. */
const PERMISSIVE = new Set(['MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0']);

const pkg = (fields: Partial<PackageLicense>): PackageLicense => ({
  name: 'example',
  version: '1.0.0',
  license: 'MIT',
  repository: null,
  text: 'MIT License\n\nCopyright (c) Example',
  textFromSibling: false,
  notice: null,
  ...fields,
});

describe('third-party licenses', () => {
  it('only allows permissive licenses in the runtime dependencies', () => {
    const packages = collectRuntimePackages();
    expect(packages.map((p) => p.name)).toEqual(expect.arrayContaining(['react', 'zod', 'ai', 'drizzle-orm']));
    expect(packages.map((p) => p.name)).not.toContain('electron');
    const rejected = packages.filter((p) => !p.license.split(/[\s()]+|\bOR\b|\bAND\b/).some((id) => PERMISSIVE.has(id)));
    expect(rejected.map((p) => `${p.name}@${p.version}: ${p.license}`)).toEqual([]);
  });

  it('lists every package and prints a shared license text once', () => {
    const shared = 'Apache License\nVersion 2.0';
    const md = renderThirdPartyLicenses(
      [pkg({ name: 'a', license: 'Apache-2.0', text: shared }), pkg({ name: 'b', license: 'Apache-2.0', text: shared }), pkg({ name: 'c' })],
      '1.2.3',
    );
    expect(md).toContain('Electron](https://www.electronjs.org) 1.2.3');
    expect(md).toContain('| a | 1.0.0 | Apache-2.0 |');
    expect(md).toContain('| c | 1.0.0 | MIT |');
    expect(md.split('Apache License\nVersion 2.0')).toHaveLength(2);
    expect(md.endsWith('\n')).toBe(true);
  });

  it('flags a package that ships no license file and a notice that must travel along', () => {
    const md = renderThirdPartyLicenses([pkg({ name: 'x', textFromSibling: true, notice: 'Copyright X' })], '1');
    expect(md).toContain('| x | 1.0.0 | MIT (see note) |');
    expect(md).toContain('does not ship a license file');
    expect(md).toContain('## Notices');
    expect(md).toContain('Copyright X');
  });
});
