import { describe, expect, it } from 'vitest';
import { parseSurfaceHash, surfaceHash, type Surface } from './surfaces';

describe('surfaces', () => {
  it.each<[Surface, string]>([
    [{ kind: 'popover' }, '#popover'],
    [{ kind: 'settings', tab: 'provider' }, '#settings/provider'],
    [{ kind: 'onboarding' }, '#onboarding'],
  ])('round-trips %o', (surface, hash) => {
    expect(surfaceHash(surface)).toBe(hash);
    expect(parseSurfaceHash(hash)).toEqual(surface);
    expect(parseSurfaceHash(hash.slice(1))).toEqual(surface);
  });

  it('opens Settings on the General tab without a tab', () => {
    expect(parseSurfaceHash('#settings')).toEqual({ kind: 'settings', tab: 'general' });
  });

  it.each(['', '#', '#/popover', '#popover/', '#settings/', '#settings/unknown', '#settings/filing/x', '#POPOVER', '#other'])(
    'rejects %j',
    (hash) => {
      expect(parseSurfaceHash(hash)).toBeNull();
    },
  );
});
