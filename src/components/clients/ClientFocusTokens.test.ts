import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/clients/clients.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const controls = readFileSync(resolve(process.cwd(), 'src/styles/controls.css'), 'utf8');

function hasApprovedFocusOutline(value: string): boolean {
  const resolved = value.replace(/var\(--focus-width\)/g, tokens.match(/--focus-width:\s*([^;]+)/)?.[1] ?? '');
  return /outline:\s*2px solid var\(--c-border-2\)/.test(resolved) && /--c-border-2\s*:\s*#[\da-f]{3,6}/i.test(tokens);
}

describe('Clients focus visibility', () => {
  it('keeps panel and shared navigation focus visible in the approved border palette', () => {
    const panelFocus = css.match(/\.clients-workspace-content:focus-visible\s*\{([^}]+)\}/)?.[1] ?? '';
    const categoryFocus = controls.match(/\.ui-list-row:focus-visible\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(hasApprovedFocusOutline(panelFocus)).toBe(true);
    expect(hasApprovedFocusOutline(categoryFocus)).toBe(true);
  });
});
