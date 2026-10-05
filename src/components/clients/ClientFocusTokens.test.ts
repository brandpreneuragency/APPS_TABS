import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/clients/clients.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function resolvesToDefaultAccent(value: string): boolean {
  return value.includes('var(--c-accent-1)') && /--c-accent-1\s*:\s*#[\da-f]{6}/i.test(tokens);
}

describe('Clients focus visibility', () => {
  it('uses the existing default accent when the optional panel accent is absent', () => {
    const panelFocus = css.match(/\.clients-workspace-content:focus-visible\s*\{([^}]+)\}/)?.[1] ?? '';
    const categoryFocus = css.match(/\.clients-category-tab:focus-visible\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(resolvesToDefaultAccent(panelFocus)).toBe(true);
    expect(resolvesToDefaultAccent(categoryFocus)).toBe(true);
  });
});
