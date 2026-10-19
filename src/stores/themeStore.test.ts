import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabsDB } from '../services/db';
import { retireLegacyThemeTokens } from './themeStore';

let database: TabsDB;
beforeEach(() => {
  database = new TabsDB(`theme-retirement-test-${crypto.randomUUID()}`);
  document.documentElement.removeAttribute('style');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.delete();
  document.documentElement.removeAttribute('style');
});

describe('legacy theme token retirement', () => {
  it('preserves a live layout value that no longer matches the retired override', async () => {
    const value = { tokens: { '--sidebar-width': '36px', '--c-space-1': '19px' } };
    await database.settings.put({ key: 'themeTokens', value });
    document.documentElement.style.setProperty('--sidebar-width', '180px');
    document.documentElement.style.setProperty('--c-space-1', '19px');
    await retireLegacyThemeTokens(database);
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('180px');
    expect(document.documentElement.style.getPropertyValue('--c-space-1')).toBe('');
    expect((await database.settings.toArray())[0].value).toEqual(value);
  });

  it('rolls back the archive and preserves inline values when retirement fails', async () => {
    const value = JSON.stringify({ tokens: { '--c-space-1': '19px' } });
    await database.settings.put({ key: 'themeTokens', value });
    document.documentElement.style.setProperty('--c-space-1', '19px');
    vi.spyOn(database.settings, 'delete').mockRejectedValueOnce(new Error('interrupted'));
    await expect(retireLegacyThemeTokens(database)).rejects.toThrow('interrupted');
    expect(await database.settings.toArray()).toEqual([{ key: 'themeTokens', value }]);
    expect(document.documentElement.style.getPropertyValue('--c-space-1')).toBe('19px');
  });

  it('preserves malformed payload bytes without clearing unrelated styles', async () => {
    const value = '{not valid json';
    await database.settings.put({ key: 'themeTokens', value });
    document.documentElement.style.setProperty('--c-space-1', '19px');
    await retireLegacyThemeTokens(database);
    const rows = await database.settings.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(value);
    expect(rows[0].key).toMatch(/^legacy\.themeTokens\.v1\./);
    expect(document.documentElement.style.getPropertyValue('--c-space-1')).toBe('19px');
  });

  it('serializes concurrent callers and retains earlier archives across a later legacy write', async () => {
    await database.settings.put({ key: 'themeTokens', value: 'first' });
    await Promise.all([retireLegacyThemeTokens(database), retireLegacyThemeTokens(database)]);
    expect(await database.settings.count()).toBe(1);
    await database.settings.put({ key: 'themeTokens', value: 'second' });
    await retireLegacyThemeTokens(database);
    expect((await database.settings.toArray()).map((row) => row.value).sort()).toEqual(['first', 'second']);
  });

  it('does not remove ordinary CSS properties or non-string payload entries', async () => {
    await database.settings.put({ key: 'themeTokens', value: JSON.stringify({ tokens: { color: 'red', '--keep': 4 } }) });
    document.documentElement.style.color = 'red';
    document.documentElement.style.setProperty('--keep', '4');
    await retireLegacyThemeTokens(database);
    expect(document.documentElement.style.color).toBe('red');
    expect(document.documentElement.style.getPropertyValue('--keep')).toBe('4');
  });

  it('archives exact bytes once, removes only legacy inline properties, and preserves general settings', async () => {
    const value = ' { "version": 1, "tokens": { "--c-space-1": "19px", "--c-text-1": "#abcdef" } } ';
    await database.settings.bulkPut([
      { key: 'themeTokens', value },
      { key: 'theme', value: 'purple-neon' },
      { key: 'fontSize', value: '18' },
    ]);
    document.documentElement.style.setProperty('--c-space-1', '19px');
    document.documentElement.style.setProperty('--unrelated', 'keep');
    await retireLegacyThemeTokens(database);
    await retireLegacyThemeTokens(database);
    const rows = await database.settings.toArray();
    const archives = rows.filter((row) => row.key.startsWith('legacy.themeTokens.v1.'));
    expect(archives).toHaveLength(1);
    expect(archives[0].value).toBe(value);
    expect(await database.settings.get('themeTokens')).toBeUndefined();
    expect(await database.settings.get('theme')).toEqual({ key: 'theme', value: 'purple-neon' });
    expect(await database.settings.get('fontSize')).toEqual({ key: 'fontSize', value: '18' });
    expect(document.documentElement.style.getPropertyValue('--c-space-1')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--unrelated')).toBe('keep');
    expect(document.documentElement.style.getPropertyValue('--c-text-1')).toBe('');
  });
});
