/**
 * Generates `THIRD_PARTY_LICENSES.md`: the licenses of the open-source packages that end up in the app.
 *
 *   npm run licenses              write the file
 *   npm run licenses -- --check   exit 1 if the committed file is out of date
 *
 * It follows the `dependencies` of `package.json` (and theirs, recursively) through `node_modules`, so build
 * and test tools are not listed. Electron itself is a dev dependency (Forge packages it) and has a fixed section.
 * The file is shipped inside the app (`extraResource` in `forge.config.mts`); run this script before a release
 * and whenever runtime dependencies change.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const THIRD_PARTY_LICENSES_PATH = join(ROOT, 'THIRD_PARTY_LICENSES.md');

/** Dual-licensed packages: the option Filey uses. */
const LICENSE_CHOICES: Readonly<Record<string, string>> = {
  'json-schema': 'BSD-3-Clause',
};

interface PackageJson {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  repository?: string | { url?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PackageLicense {
  name: string;
  version: string;
  license: string;
  repository: string | null;
  text: string;
  /** The package declares its license but ships no license file; `text` is the standard text from another package with the same license. */
  textFromSibling: boolean;
  notice: string | null;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim();

/** Finds `node_modules/<name>` the way Node does: in the package's own `node_modules`, then upwards. */
function findPackageDir(fromDir: string, name: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === parse(dir).root) return null;
  }
}

function licenseOf(pkg: PackageJson): string {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (pkg.licenses?.length) return pkg.licenses.map((l) => l.type ?? 'UNKNOWN').join(' OR ');
  return 'UNKNOWN';
}

function repositoryOf(pkg: PackageJson): string | null {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!raw) return null;
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/');
  return /^https?:\/\//.test(url) ? url : /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : null;
}

const readFirstMatch = (dir: string, pattern: RegExp): string | null => {
  const file = readdirSync(dir).find((entry) => pattern.test(entry));
  return file ? normalize(readFileSync(join(dir, file), 'utf8')) : null;
};

/** Every package the app needs at runtime, sorted by name and version. Throws if a license text is missing. */
export function collectRuntimePackages(root = ROOT): PackageLicense[] {
  const found = new Map<string, Omit<PackageLicense, 'text' | 'textFromSibling'> & { text: string | null }>();
  const visit = (dir: string, pkg: PackageJson) => {
    const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})];
    for (const dep of deps) {
      const depDir = findPackageDir(dir, dep);
      if (!depDir) {
        if (pkg.optionalDependencies && dep in pkg.optionalDependencies) continue; // not installed on this platform
        throw new Error(`Dependency ${dep} of ${pkg.name} is not installed. Run npm ci.`);
      }
      const depPkg = readJson(join(depDir, 'package.json'));
      const key = `${depPkg.name}@${depPkg.version}`;
      if (found.has(key)) continue;
      found.set(key, {
        name: depPkg.name,
        version: depPkg.version,
        license: licenseOf(depPkg),
        repository: repositoryOf(depPkg),
        text: readFirstMatch(depDir, /^(licen[cs]e|copying)(\..*)?$/i),
        notice: readFirstMatch(depDir, /^notice(\..*)?$/i),
      });
      visit(depDir, depPkg);
    }
  };
  visit(root, readJson(join(root, 'package.json')));

  const all = [...found.values()];
  const packages = all.map((p): PackageLicense => {
    if (p.text) return { ...p, text: p.text, textFromSibling: false };
    const sameLicense = all.filter((o) => o.text && o.license === p.license);
    const sibling = sameLicense.find((o) => o.repository !== null && o.repository === p.repository) ?? sameLicense[0];
    if (!sibling?.text) throw new Error(`${p.name}@${p.version} has no license file and no other package with the license ${p.license} to take it from.`);
    return { ...p, text: sibling.text, textFromSibling: true };
  });
  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** A fence that is longer than any run of backticks in `text`. */
const fenced = (text: string) => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
};

const licenseLabel = (p: PackageLicense) => {
  const choice = LICENSE_CHOICES[p.name];
  const label = choice ? `${p.license}, used under ${choice}` : p.license;
  return p.textFromSibling ? `${label} (see note)` : label;
};

export function renderThirdPartyLicenses(packages: readonly PackageLicense[], electronVersion: string): string {
  const groups = new Map<string, PackageLicense[]>();
  for (const p of packages) groups.set(p.text, [...(groups.get(p.text) ?? []), p]);

  const lines: string[] = [
    '# Third-party licenses',
    '',
    'Filey itself is released under the MIT License (see `LICENSE`). The app includes the open-source components below,',
    'each under its own license. This file is generated by `npm run licenses`; do not edit it by hand.',
    '',
    '## Electron and Chromium',
    '',
    `Filey runs on [Electron](https://www.electronjs.org) ${electronVersion} (MIT License, Copyright (c) Electron contributors and GitHub Inc.).`,
    'Electron bundles Chromium, Node.js and further components under their own licenses. The notices for Chromium and its',
    'dependencies are published with every Electron release as `LICENSES.chromium.html`.',
    'See <https://github.com/electron/electron/blob/main/LICENSE>.',
    '',
    '## npm packages',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...packages.map((p) => `| ${p.name} | ${p.version} | ${licenseLabel(p)} |`),
  ];
  const siblings = packages.filter((p) => p.textFromSibling);
  if (siblings.length > 0) {
    lines.push(
      '',
      `Note: ${siblings.map((p) => p.name).join(', ')} declare${siblings.length === 1 ? 's' : ''} ${siblings.length === 1 ? 'its' : 'their'} license in \`package.json\` but ${siblings.length === 1 ? 'does' : 'do'} not ship a license file; the standard text of that license, as shipped by other packages, is shown below.`,
    );
  }
  lines.push('', '## License texts');

  for (const [text, members] of groups) {
    lines.push('', members.map((p) => `**${p.name}@${p.version}**`).join(', '), '');
    const repos = members.filter((p) => p.repository).map((p) => `${p.name}: <${p.repository}>`);
    if (repos.length > 0) lines.push(repos.join('  \n'), '');
    lines.push(fenced(text));
  }

  const notices = packages.filter((p) => p.notice);
  if (notices.length > 0) {
    lines.push('', '## Notices', '');
    for (const p of notices) lines.push(`**${p.name}@${p.version}**`, '', fenced(p.notice!), '');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function buildThirdPartyLicenses(root = ROOT): string {
  const electron = readJson(join(root, 'package.json')).devDependencies?.electron ?? 'unknown';
  return renderThirdPartyLicenses(collectRuntimePackages(root), electron);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const content = buildThirdPartyLicenses();
  if (process.argv.includes('--check')) {
    const current = existsSync(THIRD_PARTY_LICENSES_PATH) ? readFileSync(THIRD_PARTY_LICENSES_PATH, 'utf8') : '';
    if (current !== content) {
      console.error('THIRD_PARTY_LICENSES.md is out of date. Run `npm run licenses`.');
      process.exit(1);
    }
    console.log('THIRD_PARTY_LICENSES.md is up to date.');
  } else {
    writeFileSync(THIRD_PARTY_LICENSES_PATH, content);
    console.log(`Wrote ${THIRD_PARTY_LICENSES_PATH}`);
  }
}
