// Source contract checks complement (but do not replace) visual acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/purpleNeon.css', 'utf8');
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g);

describe('Purple Neon CSS isolation', () => {
  it('scopes every style rule to the opt-in root attribute', () => {
    const selectors = [...rules].map((rule) => rule[1].trim());
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      expect(selector.startsWith(":root[data-theme='purple-neon']")).toBe(true);
    }
  });

  it('leaves geometry, font sizes and semantic status tokens alone', () => {
    expect(css).not.toMatch(/(?:^|[;{])\s*(?:width|height|min-width|min-height|padding|margin|gap|display|position|font-size|grid-template-columns)\s*:/m);
    expect(css).not.toMatch(/--(?:control-height|fs-|c-space-|c-danger|c-success|c-warning|c-info|c-red|c-green|c-yellow)[\w-]*\s*:/);
    expect(tokens).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(css).toContain('var(--neon-panel-surface)');
    expect(css).not.toMatch(/--[\w-]+\s*:/);
    expect(css).toContain('forced-colors: active');
  });
});
