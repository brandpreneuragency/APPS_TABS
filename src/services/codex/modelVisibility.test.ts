import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { CodexModel } from './types';
import { loadCodexModelVisibility, setAllCodexModelsVisible, setCodexModelVisible, visibleCodexModels } from './modelVisibility';

const models: CodexModel[] = [
  { id: 'astra', displayName: 'Astra', isDefault: true, reasoningEfforts: [] },
  { id: 'sol', displayName: 'Sol', isDefault: false, reasoningEfforts: [] },
  { id: 'luna', displayName: 'Luna', isDefault: false, reasoningEfforts: [] },
];

afterEach(async () => { await db.settings.delete('codexModelVisibility'); });

describe('Codex model visibility', () => {
  it('defaults safely when the saved value is absent or invalid', async () => {
    expect(await loadCodexModelVisibility()).toEqual({ allHidden: false, hiddenModelIds: [] });
    await db.settings.put({ key: 'codexModelVisibility', value: { hiddenModelIds: ['astra', 4] } });
    expect(await loadCodexModelVisibility()).toEqual({ allHidden: false, hiddenModelIds: ['astra'] });
  });

  it('hides individual models and restores them', async () => {
    await setCodexModelVisible('sol', false, models.map((model) => model.id));
    let visibility = await loadCodexModelVisibility();
    expect(visibleCodexModels(models, visibility).map((model) => model.id)).toEqual(['astra', 'luna']);
    await setCodexModelVisible('sol', true, models.map((model) => model.id));
    visibility = await loadCodexModelVisibility();
    expect(visibleCodexModels(models, visibility).map((model) => model.id)).toEqual(['astra', 'sol', 'luna']);
  });

  it('hides all models, including models discovered later, until a model is restored', async () => {
    await setAllCodexModelsVisible(false);
    const visibility = await loadCodexModelVisibility();
    expect(visibleCodexModels([...models, { ...models[0], id: 'new' }], visibility)).toEqual([]);
    await setCodexModelVisible('sol', true, models.map((model) => model.id));
    const restored = await loadCodexModelVisibility();
    expect(visibleCodexModels(models, restored).map((model) => model.id)).toEqual(['sol']);
  });

  it('turns the provider back on for every model', async () => {
    await setAllCodexModelsVisible(false);
    await setAllCodexModelsVisible(true);
    expect(await loadCodexModelVisibility()).toEqual({ allHidden: false, hiddenModelIds: [] });
  });
});
