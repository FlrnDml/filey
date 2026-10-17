import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readTokens, renderTokensCss, TOKENS_CSS_PATH, type DesignTokens } from '../scripts/build-tokens.mts';

describe('design tokens CSS', () => {
  it('is up to date with docs/design-system/tokens.json (run `npm run tokens`)', () => {
    expect(readFileSync(TOKENS_CSS_PATH, 'utf8')).toBe(renderTokensCss(readTokens()));
  });

  it('defines every colour token for light and dark and resolves references', () => {
    const tokens = readTokens();
    const css = renderTokensCss(tokens);
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    for (const token of tokens.color.tokens) {
      expect(light).toContain(`--${token.name}: `);
      expect(dark).toContain(`--${token.name}: `);
    }
    expect(css).not.toMatch(/\{[a-z-]+\}/);
    const accent = tokens.color.tokens.find((t) => t.name === 'accent')!.value as { light: string; dark: string };
    expect(light).toContain(`--focus-ring: ${accent.light};`);
    expect(dark).toContain(`--focus-ring: ${accent.dark};`);
  });

  it('emits type styles as variables and utility classes', () => {
    const css = renderTokensCss(readTokens());
    expect(css).toContain('--type-body: 400 15px/22px var(--font-sans);');
    expect(css).toContain('--type-display-tracking: -0.02em;');
    expect(css).toMatch(/\.type-mono \{\n {2}font: var\(--type-mono\);/);
  });

  it('rejects unknown references', () => {
    const tokens: DesignTokens = {
      ...readTokens(),
      color: { tokens: [{ name: 'focus-ring', value: '{missing}' }] },
    };
    expect(() => renderTokensCss(tokens)).toThrow('Unknown token reference: {missing}');
  });
});
