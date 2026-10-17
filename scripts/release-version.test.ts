import { describe, expect, it } from 'vitest';
import { nextPrereleaseVersion, nextReleaseVersion } from './release-version.mts';

describe('nextReleaseVersion', () => {
  it('is 0.0.1 without a release tag, whatever the bump', () => {
    expect(nextReleaseVersion([], 'patch')).toBe('0.0.1');
    expect(nextReleaseVersion([], 'minor')).toBe('0.0.1');
    expect(nextReleaseVersion([], 'major')).toBe('0.0.1');
    expect(nextReleaseVersion(['v0.0.1-prerelease.4', 'not-a-version'], 'minor')).toBe('0.0.1');
  });

  it('bumps the highest release tag', () => {
    const tags = ['v0.1.0', 'v0.9.0', 'v0.10.0', 'v0.10.1-prerelease.2'];
    expect(nextReleaseVersion(tags, 'patch')).toBe('0.10.1');
    expect(nextReleaseVersion(tags, 'minor')).toBe('0.11.0');
    expect(nextReleaseVersion(tags, 'major')).toBe('1.0.0');
  });
});

describe('nextPrereleaseVersion', () => {
  it('numbers the pre-releases of the first release from 1', () => {
    expect(nextPrereleaseVersion([])).toBe('0.0.1-prerelease.1');
  });

  it('uses the next patch after the last release and counts on from the highest number', () => {
    const tags = ['v0.1.0', 'v0.1.1-prerelease.2', 'v0.1.1-prerelease.3', 'v0.1.2-prerelease.9'];
    expect(nextPrereleaseVersion(tags)).toBe('0.1.1-prerelease.4');
  });

  it('starts again at 1 for the next patch once a version is released', () => {
    expect(nextPrereleaseVersion(['v0.1.0', 'v0.1.0-prerelease.3', 'v0.1.1-prerelease.1'])).toBe('0.1.1-prerelease.2');
    expect(nextPrereleaseVersion(['v0.1.0', 'v0.1.0-prerelease.3'])).toBe('0.1.1-prerelease.1');
  });
});
