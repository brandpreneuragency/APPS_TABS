import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import {
  loadProviderModelVisibility,
  providerModelVisibilitySettingKey,
  setAllProviderModelsVisible,
  setProviderModelVisible,
  visibleProviderModels,
} from './modelVisibility';

const models = [{ id: 'fast' }, { id: 'balanced' }, { id: 'precise' }];
const providerKeys = ['codexModelVisibility', 'grokModelVisibility', 'commandCodeModelVisibility', 'openCodeModelVisibility'];

afterEach(async () => { await db.settings.bulkDelete(providerKeys); });

describe('provider model visibility', () => {
  it('uses stable, separate setting keys and retains the Codex key', () => {
    expect(providerModelVisibilitySettingKey('codex')).toBe('codexModelVisibility');
    expect(providerModelVisibilitySettingKey('grok')).toBe('grokModelVisibility');
    expect(providerModelVisibilitySettingKey('commandCode')).toBe('commandCodeModelVisibility');
    expect(providerModelVisibilitySettingKey('openCode')).toBe('openCodeModelVisibility');
  });

  it('defaults safely when settings are absent or malformed', async () => {
    expect(await loadProviderModelVisibility('grok')).toEqual({ allHidden: false, hiddenModelIds: [] });
    await db.settings.put({ key: 'grokModelVisibility', value: { allHidden: 'yes', hiddenModelIds: ['fast', 7, 'fast'] } });
    expect(await loadProviderModelVisibility('grok')).toEqual({ allHidden: false, hiddenModelIds: ['fast'] });
  });

  it('keeps each provider visibility independent', async () => {
    await setProviderModelVisible('grok', 'fast', false, models.map((model) => model.id));
    await setProviderModelVisible('openCode', 'balanced', false, models.map((model) => model.id));
    expect((await loadProviderModelVisibility('grok')).hiddenModelIds).toEqual(['fast']);
    expect((await loadProviderModelVisibility('openCode')).hiddenModelIds).toEqual(['balanced']);
  });

  it('hides every discovered model until one is restored', async () => {
    await setAllProviderModelsVisible('commandCode', false);
    let visibility = await loadProviderModelVisibility('commandCode');
    expect(visibleProviderModels([...models, { id: 'new' }], visibility)).toEqual([]);

    await setProviderModelVisible('commandCode', 'balanced', true, models.map((model) => model.id));
    visibility = await loadProviderModelVisibility('commandCode');
    expect(visibleProviderModels(models, visibility).map((model) => model.id)).toEqual(['balanced']);
  });

  it('turns a provider back on for every model', async () => {
    await setAllProviderModelsVisible('openCode', false);
    await setAllProviderModelsVisible('openCode', true);
    expect(await loadProviderModelVisibility('openCode')).toEqual({ allHidden: false, hiddenModelIds: [] });
  });
});
