import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(css|tsx?)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}
const tokenPath = join('src', 'styles', 'tokens.css');
const tokens = stripComments(readFileSync(tokenPath, 'utf8'));

const borderProperty = /^(?:border(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?(?:-color)?|outline(?:-color)?)$/;
const inlineBorderProperty = /^(?:border(?:Top|Right|Bottom|Left|Block(?:Start|End)?|Inline(?:Start|End)?)?(?:Color)?|outline(?:Color)?)$/;
function approvedBorder(value: string): boolean {
  if (/^(?:none|transparent|0(?:px)?)(?:\s*!important)?$/.test(value.trim())) return true;
  return /^(?:var\(--c-border(?:-[12])?\)|transparent)$/.test(value
    .replace(/\s*!important\s*$/, '')
    .replace(/var\(--(?:border-width|focus-width)\)/g, '')
    .replace(/\b\d+(?:\.\d+)?px\b|\b(?:solid|dashed|dotted|double)\b/g, '')
    .trim());
}

describe('single-source design contract', () => {
  it('rejects implicit, mixed and noncanonical border colors', () => {
    for (const value of ['1px solid', '1px solid currentColor', 'var(--c-accent-1)', '1px solid #333', 'color-mix(in srgb, var(--c-border-1) 50%, red)']) {
      expect(approvedBorder(value), value).toBe(false);
    }
    for (const value of ['0', '0px', 'none', '1px solid transparent', 'var(--border-width) solid var(--c-border-1)', '2px solid var(--c-border-2)']) {
      expect(approvedBorder(value), value).toBe(true);
    }
  });

  it('defines the approved fixed icon, icon-button and body inset values', () => {
    expect(tokens).toMatch(/--c-icon-1:\s*14px\s*;/);
    expect(tokens).toMatch(/--c-sq-button:\s*24px\s*;/);
    expect(tokens).toMatch(/--c-space-1:\s*8px\s*;/);
    expect(tokens).not.toMatch(/--c-(?:space|gap)-[\w-]+:\s*(?:clamp|min|max|calc)\(/);
  });

  it('keeps palette, typography, control and spacing defaults in tokens.css', () => {
    const violations = sources('src').filter((path) => path.endsWith('.css') && path !== tokenPath).flatMap((path) => {
      const css = stripComments(readFileSync(path, 'utf8'));
      return [...css.matchAll(/(?:^|[;{])\s*(--(?:c-(?:background|text|accent|border|space|gap|icon|sq-button|font)[\w-]*|fs-[\w-]+|lh-[\w-]+|control-height-[\w-]+|radius-[\w-]+))\s*:/g)]
        .map((match) => `${relative('src', path)}: ${match[1]}`);
    });
    expect(violations).toEqual([]);
  });

  it('has no retired token consumers or parallel names', () => {
    const retired = /var\(\s*--(?:space-(?:\d+|fluid-[\w-]+)|icon-size(?:-[\w-]+)?|div-h-\d+|panel-padding|panel-gap|c-accent-(?:left|center|right)-panel|font-fluid-\d+|lh-ratio-\d+|layout-border|left-bg|center-bg|right-bg|border)(?=\s*[,)])/g;
    const violations = sources('src').flatMap((path) => [...stripComments(readFileSync(path, 'utf8')).matchAll(retired)]
      .map((match) => `${relative('src', path)}: ${match[0]}`));
    expect(violations).toEqual([]);
  });

  it('does not make all buttons square; the explicit icon-button role owns both dimensions', () => {
    const index = stripComments(readFileSync('src/index.css', 'utf8'));
    expect(/(?:^|\})\s*button\s*\{[^}]*width:\s*var\(--control-height/.test(index)).toBe(false);
    const controls = stripComments(readFileSync('src/styles/controls.css', 'utf8'));
    expect(controls).toMatch(/\.ui-icon-button\s*\{[^}]*width:\s*var\(--c-sq-button\)/);
    expect(controls).toMatch(/\.ui-icon-button\s*\{[^}]*height:\s*var\(--c-sq-button\)/);
    expect(controls).toMatch(/svg\.lucide[\s\S]*?width:\s*var\(--c-icon-1\)/);
  });

  it('resolves every required variable to a definition or an explicit runtime input', () => {
    const all = sources('src').map((path) => ({ path, text: stripComments(readFileSync(path, 'utf8')) }));
    const definitions = new Set(all.flatMap(({ path, text }) => path.endsWith('.css')
      ? [...text.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)].map((match) => match[1])
      : [...text.matchAll(/['"](--[\w-]+)['"]/g)].map((match) => match[1])));
    const missing = all.flatMap(({ path, text }) => [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
      .filter((match) => !definitions.has(match[1]))
      .map((match) => `${relative('src', path)}: ${match[1]}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps application chrome free of box, text and filter shadows in every theme', () => {
    const violations = sources('src').flatMap((path) => {
      const text = stripComments(readFileSync(path, 'utf8'));
      const shadows = [...text.matchAll(/(?:box-shadow|text-shadow)\s*:\s*([^;}]+)/g)]
        .filter((match) => !/^none(?:\s*!important)?$/.test(match[1].trim()));
      const inline = [...text.matchAll(/(?:boxShadow|textShadow)\s*:\s*['"]([^'"]+)['"]/g)]
        .filter((match) => match[1] !== 'none');
      const filters = [...text.matchAll(/drop-shadow\s*\(|<feDropShadow\b/g)];
      return [...shadows, ...inline, ...filters].map((match) => `${relative('src', path)}: ${match[0]}`);
    });
    expect(violations).toEqual([]);
    expect(tokens).not.toMatch(/--[\w-]*(?:shadow|glow)[\w-]*\s*:/);
  });

  it('uses only the approved border colors in chrome, including focus and inline styles', () => {
    const violations = sources('src').filter((path) => /\.(?:css|tsx)$/.test(path)).flatMap((path) => {
      const file = relative('src', path).replace(/\\/g, '/');
      // Published forms and their authored preview are not application chrome.
      if (file.startsWith('components/forms/embed/')) return [];
      const text = stripComments(readFileSync(path, 'utf8'));
      if (path.endsWith('.css')) {
        return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((rule) => {
          if (file === 'components/forms/builder/builder.css' && /\.forms-builder-form-/.test(rule[1])) return [];
          return [...rule[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/g)]
            .filter((match) => borderProperty.test(match[1]) && !approvedBorder(match[2]) && !/\bCanvasText\b/.test(match[2]))
            .map((match) => `${file}: ${rule[1].trim()}: ${match[1]}: ${match[2]}`);
        });
      }
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const invalid: string[] = [];
      function inspectValue(value: ts.Expression) {
        if (ts.isConditionalExpression(value)) {
          inspectValue(value.whenTrue);
          inspectValue(value.whenFalse);
        } else if (ts.isStringLiteralLike(value) && !approvedBorder(value.text)) {
          invalid.push(`${file}: ${value.text}`);
        }
      }
      function visit(node: ts.Node) {
        if (ts.isPropertyAssignment(node) && inlineBorderProperty.test(node.name.getText(source).replace(/['"]/g, ''))) {
          inspectValue(node.initializer);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      return invalid;
    });
    expect(violations).toEqual([]);
  });

  it('has no decorative gradient or blur effects in application styles', () => {
    const violations = sources('src').filter((path) => path.endsWith('.css')).flatMap((path) => {
      const text = stripComments(readFileSync(path, 'utf8'));
      return [...text.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(|(?:backdrop-)?filter\s*:\s*([^;}]+)/g)]
        .filter((match) => !match[1] || !/^none(?:\s*!important)?$/.test(match[1].trim()))
        .map((match) => `${relative('src', path)}: ${match[0]}`);
    });
    expect(violations).toEqual([]);
  });

  it('preserves compact neutral buttons without shrinking input or row roles', () => {
    const controls = stripComments(readFileSync('src/styles/controls.css', 'utf8'));
    const button = controls.match(/:root \.ui-button\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(button).toContain('height: var(--c-sq-button)');
    expect(button).toContain('gap: var(--c-gap-0)');
    expect(button).toContain('color: var(--c-text-3)');
    expect(controls).toMatch(/\.ui-input\s*\{[^}]*height:\s*var\(--control-height-sm\)/);
    expect(controls).toMatch(/\.ui-list-row\s*\{[^}]*min-height:\s*var\(--control-height-sm\)/);
    expect(controls).toMatch(/\.ui-button--danger\s*\{[^}]*color:\s*var\(--c-danger\)/);
  });

  it('keeps focused fields borderless without removing navigation focus or authored form styling', () => {
    const controls = stripComments(readFileSync('src/styles/controls.css', 'utf8'));
    const rules = [...controls.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const fields = rules.find((rule) => rule[1].includes(':is(input, textarea, select, [contenteditable])') && rule[1].includes(':focus'));
    expect(fields).toBeDefined();
    expect(fields?.[1]).toContain('.forms-embed-root *');
    expect(fields?.[1]).toContain('.forms-builder-form *');
    expect(fields?.[1]).toContain('[contenteditable=\'false\']');
    expect(fields?.[1]).toContain('[type=\'checkbox\']');
    expect(fields?.[1]).toContain('[type=\'radio\']');
    expect(fields?.[2]).toContain('border-color: transparent !important');
    expect(fields?.[2]).toContain('outline: none !important');
    // Preserve dimensions instead of removing the border box on focus.
    expect(fields?.[2]).not.toMatch(/\bborder(?:-width)?:/);
    expect(controls).not.toMatch(/background(?:-color)?:\s*var\(--c-background-0\)/);
    expect(fields?.[2]).not.toMatch(/\bbackground(?:-color)?:/);
    expect(controls).toMatch(/\.ui-list-row:focus-visible\s*\{[^}]*outline:\s*var\(--focus-width\)/);
    expect(controls).toMatch(/\.codex-model-search, \.clients-file-picker\):focus-within\s*\{[^}]*outline:\s*none/);
    expect(controls).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*outline:\s*var\(--focus-width\) solid CanvasText !important/);
  });
});
