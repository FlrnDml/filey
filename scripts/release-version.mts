/**
 * Version numbers for the GitHub release workflows (`.github/workflows/prerelease.yml` and `release.yml`).
 * The git tags are the only version history: `package.json` has no `version`, CI stamps it into the build (not committed).
 * See arc42 §8 "Versioning".
 *
 *   node scripts/release-version.mts prerelease           next pre-release, e.g. 0.1.1-prerelease.3
 *   node scripts/release-version.mts release <bump>       next release (patch, minor or major), e.g. 0.2.0
 *
 * Releases are tags `vX.Y.Z`, pre-releases `vX.Y.Z-prerelease.N` where X.Y.Z is the next patch after the last release.
 * Without any release tag, the first release is 0.0.1, whatever the bump.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Bump = 'patch' | 'minor' | 'major';
type Triple = [number, number, number];

const FIRST_RELEASE: Triple = [0, 0, 1];
const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-prerelease\.(\d+))?$/;

const parse = (tag: string) => {
  const match = TAG.exec(tag);
  if (!match) return undefined;
  const [, major, minor, patch, pre] = match;
  return { triple: [Number(major), Number(minor), Number(patch)] as Triple, pre: pre === undefined ? undefined : Number(pre) };
};

const compare = (a: Triple, b: Triple) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const format = (t: Triple) => t.join('.');

function bumped([major, minor, patch]: Triple, bump: Bump): Triple {
  if (bump === 'major') return [major + 1, 0, 0];
  if (bump === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

/** The highest `vX.Y.Z` tag, ignoring pre-releases. */
function lastRelease(tags: string[]): Triple | undefined {
  return tags
    .map(parse)
    .filter((t) => t !== undefined && t.pre === undefined)
    .map((t) => t!.triple)
    .sort(compare)
    .at(-1);
}

/** The version of the next release; without any release tag it is the first release, 0.0.1. */
export function nextReleaseVersion(tags: string[], bump: Bump): string {
  const last = lastRelease(tags);
  return format(last ? bumped(last, bump) : FIRST_RELEASE);
}

/** The next pre-release of the next patch version: `<next patch>-prerelease.<highest existing number + 1>`. */
export function nextPrereleaseVersion(tags: string[]): string {
  const base = nextReleaseVersion(tags, 'patch');
  const numbers = tags
    .map(parse)
    .filter((t) => t?.pre !== undefined && format(t.triple) === base)
    .map((t) => t!.pre!);
  return `${base}-prerelease.${Math.max(0, ...numbers) + 1}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, argument] = process.argv.slice(2);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const tags = () => execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  if (command === 'prerelease') {
    console.log(nextPrereleaseVersion(tags()));
  } else if (command === 'release' && (argument === 'patch' || argument === 'minor' || argument === 'major')) {
    console.log(nextReleaseVersion(tags(), argument));
  } else {
    console.error('Usage: release-version.mts prerelease | release <patch|minor|major>');
    process.exit(1);
  }
}
