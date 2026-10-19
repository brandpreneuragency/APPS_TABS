import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../services/db';
import { useUIStore } from './uiStore';

beforeEach(async () => {
  await db.settings.clear();
  useUIStore.setState(useUIStore.getInitialState());
  document.documentElement.removeAttribute('data-theme');
});

describe('optional named theme', () => {
  it('persists Purple Neon and restores it through UI settings hydration', async () => {
    await useUIStore.getState().setTheme('purple-neon');
    expect((await db.settings.get('theme'))?.value).toBe('purple-neon');
    document.documentElement.removeAttribute('data-theme');
    useUIStore.setState(useUIStore.getInitialState());
    await useUIStore.getState().loadUISettings();
    expect(useUIStore.getState().theme).toBe('purple-neon');
    expect(document.documentElement.dataset.theme).toBe('purple-neon');
  });

  it('keeps default opt-in and removes all scoped styling on return', async () => {
    await useUIStore.getState().loadUISettings();
    expect(useUIStore.getState().theme).toBe('default');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    await useUIStore.getState().setTheme('purple-neon');
    await useUIStore.getState().setTheme('default');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect((await db.settings.get('theme'))?.value).toBe('default');
  });

  it('retains legacy fallback without deleting custom token overrides', async () => {
    const tokens = JSON.stringify({ version: 1, tokens: { '--c-text-1': '#eeeeee' } });
    await db.settings.bulkPut([{ key: 'theme', value: 'cyberpunk' }, { key: 'themeTokens', value: tokens }]);
    await useUIStore.getState().loadUISettings();
    expect(useUIStore.getState().theme).toBe('default');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    await useUIStore.getState().setTheme('purple-neon');
    expect((await db.settings.get('themeTokens'))?.value).toBe(tokens);
  });
});
