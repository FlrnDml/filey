import { describe, expect, it } from 'vitest';
import { MAX_PAGE_BYTES, parseResponse } from './protocol';

const page = (size = 10) => new Uint8Array(size).fill(1);

describe('parseResponse', () => {
  it('accepts pages up to the allowed number', () => {
    expect(parseResponse({ id: 3, pages: [page(), page()] }, 3)).toEqual({ id: 3, pages: [page(), page()] });
    expect(parseResponse({ id: 3, pages: [] }, 3)).toEqual({ id: 3, pages: [] });
  });

  it('passes an error on, shortened, without trusting its type further', () => {
    expect(parseResponse({ id: 1, error: 'x'.repeat(500) }, 3)).toEqual({ id: 1, error: 'x'.repeat(200) });
  });

  it.each([
    ['null', null],
    ['a string', 'pages'],
    ['no id', { pages: [] }],
    ['a fractional id', { id: 1.5, pages: [] }],
    ['a string id', { id: '1', pages: [] }],
    ['no pages', { id: 1 }],
    ['pages that are not an array', { id: 1, pages: 'x' }],
    ['too many pages', { id: 1, pages: [page(), page(), page(), page()] }],
    ['a page that is not bytes', { id: 1, pages: ['abc'] }],
    ['an empty page', { id: 1, pages: [new Uint8Array(0)] }],
    ['an oversized page', { id: 1, pages: [{ byteLength: MAX_PAGE_BYTES + 1 }] }],
  ])('rejects %s', (_name, value) => {
    expect(parseResponse(value, 3)).toBeUndefined();
  });

  it('rejects an oversized real page', () => {
    expect(parseResponse({ id: 1, pages: [new Uint8Array(MAX_PAGE_BYTES + 1)] }, 3)).toBeUndefined();
  });
});
