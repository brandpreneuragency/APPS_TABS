// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../services/db';
import { useAIStore } from './aiStore';

describe('assistant personas and instructions', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    useAIStore.setState({ agents: [], activeAgentId: 'default_agent', systemInstructions: '', isLoaded: false });
  });

  it('loads a preserved persona and keeps its ordinary preference in Dexie', async () => {
    await db.agents.add({ id: 'writer', name: 'Writer', avatarUrl: '',
      systemPrompt: 'Be precise', isDefault: false });
    await db.settings.bulkPut([
      { key: 'activeAgentId', value: 'writer' },
      { key: 'systemInstructions', value: 'Follow local style' },
    ]);
    await useAIStore.getState().loadAISettings();
    expect(useAIStore.getState().getActiveAgent().id).toBe('writer');
    expect(useAIStore.getState().systemInstructions).toBe('Follow local style');
    await useAIStore.getState().saveSystemInstructions('Updated style');
    expect((await db.settings.get('systemInstructions'))?.value).toBe('Updated style');
    expect(await db.providerConfigs.count()).toBe(0);
  });
});
