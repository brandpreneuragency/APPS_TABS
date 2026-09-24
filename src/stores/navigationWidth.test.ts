import { describe, expect, it } from 'vitest';
import { clampNavigationWidth } from './uiLayoutState';

describe('navigation rail width', () => {
  it('keeps dragging and restored widths within 120 to 320 pixels', () => {
    expect(clampNavigationWidth(40)).toBe(120);
    expect(clampNavigationWidth(480)).toBe(320);
    expect(clampNavigationWidth(245)).toBe(245);
  });

  it('recovers unusable saved widths', () => {
    expect(clampNavigationWidth(Number.NaN)).toBe(180);
    expect(clampNavigationWidth(Number.POSITIVE_INFINITY)).toBe(180);
  });
});
