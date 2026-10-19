import { db, type TabsDB } from '../services/db';

/** One-way retirement only: CSS is the sole design-token authority. */
export async function retireLegacyThemeTokens(database: TabsDB = db): Promise<void> {
  const legacyValue = await database.transaction('rw', database.settings, async () => {
    const legacy = await database.settings.get('themeTokens');
    if (!legacy) return undefined;
    // add (not put) ensures no recovery record can be overwritten.
    await database.settings.add({
      key: `legacy.themeTokens.v1.${crypto.randomUUID()}`,
      value: legacy.value,
    });
    await database.settings.delete('themeTokens');
    return legacy.value;
  });

  // Clear only custom properties actually represented in the retired payload,
  // after the archival transaction commits. Never apply archived values.
  if (legacyValue === undefined || typeof document === 'undefined') return;
  let parsed: unknown;
  try { parsed = typeof legacyValue === 'string' ? JSON.parse(legacyValue) : legacyValue; } catch { return; }
  if (!parsed || typeof parsed !== 'object' || !('tokens' in parsed)) return;
  const tokens = parsed.tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return;
  for (const [name, value] of Object.entries(tokens)) {
    if (name.startsWith('--') && typeof value === 'string'
      && document.documentElement.style.getPropertyValue(name).trim() === value.trim()) {
      document.documentElement.style.removeProperty(name);
    }
  }
}