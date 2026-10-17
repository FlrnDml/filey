import { describe, expect, it } from 'vitest';
import { isAppPage, isSameDocument, SECURE_WEB_PREFERENCES, surfaceUrl } from './window';

describe('SECURE_WEB_PREFERENCES', () => {
  it('isolates the renderer from Node', () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  });
});

const dev = 'http://localhost:3000/main_window';
const prod = 'file:///Applications/Filey.app/Contents/Resources/app.asar/.webpack/renderer/main_window/index.html';

describe('isSameDocument', () => {
  it('accepts the entry page, also with a hash or query', () => {
    expect(isSameDocument(dev, [dev])).toBe(true);
    expect(isSameDocument(`${dev}#/settings`, [dev])).toBe(true);
    expect(isSameDocument(`${prod}?tab=filing`, [prod])).toBe(true);
  });

  it('rejects other pages, hosts and invalid URLs', () => {
    expect(isSameDocument('http://localhost:3001/main_window', [dev])).toBe(false);
    expect(isSameDocument('https://example.com/main_window', [dev])).toBe(false);
    expect(isSameDocument('file:///tmp/evil.html', [prod])).toBe(false);
    expect(isSameDocument('not a url', [dev])).toBe(false);
  });
});

describe('isAppPage', () => {
  it.each([dev, prod])('accepts every surface of %s', (entry) => {
    for (const hash of ['#popover', '#settings', '#settings/general', '#settings/provider', '#settings/filing', '#onboarding']) {
      expect(isAppPage(`${entry}${hash}`, entry)).toBe(true);
    }
  });

  it('builds URLs it accepts', () => {
    expect(surfaceUrl(prod, { kind: 'settings', tab: 'filing' })).toBe(`${prod}#settings/filing`);
    expect(isAppPage(surfaceUrl(dev, { kind: 'popover' }), dev)).toBe(true);
  });

  it.each([
    dev,
    `${dev}#`,
    `${dev}#other`,
    `${dev}#settings/admin`,
    `${dev}?x=1#popover`,
    `${dev}/#popover`,
    'http://localhost:3001/main_window#popover',
    'file:///tmp/evil.html#popover',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAppPage(url, dev)).toBe(false);
  });
});
