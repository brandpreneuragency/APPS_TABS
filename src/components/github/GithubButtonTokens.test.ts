import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
const css = read('src/components/github/github.css');
const tokens = read('src/styles/tokens.css');
const controls = read('src/styles/controls.css');
const workspace = read('src/components/github/GithubWorkspace.tsx');
const navigation = read('src/components/github/GithubRepositoryNavigation.tsx');

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

describe('GitHub shared control contract', () => {
  it('uses app typography without a feature-wide button reset', () => {
    const typography = rule(css, '.github-mode,\n.github-repository-navigation,\n.github-ai-notice');
    expect(typography).toMatch(/font-family:\s*var\(--c-font-1\)/);
    expect(typography).toMatch(/font-size:\s*var\(--fs-sm\)/);
    expect(typography).toMatch(/line-height:\s*var\(--lh-sm\)/);
    expect(css).not.toContain(':where(button)');
  });

  it('uses canonical tokens and shared primary actions rather than optional panel accents', () => {
    expect(tokens).toMatch(/--c-accent-1\s*:\s*#[\da-f]{6}/i);
    expect(workspace).toContain('ui-button ui-button--primary github-primary-button');
    expect(controls).toMatch(/\.ui-button--primary/);
    expect(controls).toContain('var(--c-accent-2)');
    expect(css).not.toMatch(/--(?:c-accent-[\w-]+-panel|space-\d|font-fluid|div-h-|icon-size|control-height-xs)/);
  });

  it('separates icon-only controls from text actions and repository rows', () => {
    for (const source of [workspace, navigation]) {
      expect(source).toContain('ui-icon-button github-tab-close');
      expect(source).not.toMatch(/\bsize=\{\d+\}/);
    }
    expect(navigation).toContain('ui-list-row github-repo-option');
    expect(workspace).toContain('ui-list-row github-file-tree-entry');
    expect(workspace).toContain('ui-button github-secondary-button');
    expect(controls).toContain('var(--c-sq-button)');
    expect(tokens).toMatch(/--c-icon-1\s*:\s*14px/);
    expect(tokens).toMatch(/--c-sq-button\s*:\s*24px/);
  });

  it('leaves control sizing and interaction states with the shared roles', () => {
    for (const selector of ['.github-tab-close', '.github-icon-button', '.github-primary-button', '.github-secondary-button', '.github-danger-button']) {
      const local = rule(css, selector);
      expect(local).not.toMatch(/(?:^|;)\s*(?:width|height|min-height|padding|color|background|border-color)\s*:/);
      expect(css).not.toContain(`${selector}:hover`);
      expect(css).not.toContain(`${selector}:disabled`);
    }
    expect(controls).toContain(':focus-visible');
    expect(controls).toContain(':disabled');
  });

  it('assigns standard container roles to content insets', () => {
    expect(workspace).toContain('ui-panel-body github-changes-scroll');
    expect(workspace).toContain('ui-card github-connection-card');
    expect(workspace).toContain('ui-toolbar github-panel-heading');
    expect(navigation).toContain('ui-panel-body github-repository-navigation-scroll');
  });
});
