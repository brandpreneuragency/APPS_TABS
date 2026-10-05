import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterClients } from './navigation';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';

vi.mock('../../services/db', () => ({
  db: { settings: { put: vi.fn().mockResolvedValue(undefined) } },
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../stores/crmStore', () => ({
  useCrmStore: { getState: () => ({ setLeadsCenterView: vi.fn() }) },
}));

const draftValue = { title: 'Working note', bodyText: 'Keep this edit', kind: 'note' as const, occurredAt: 1_000, contactId: null };

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState());
  useTaskStore.setState(useTaskStore.getInitialState());
  useClientDetailsStore.setState({ category: 'overview', drafts: {}, saveStates: {} });
});
afterEach(() => {
  useUIStore.setState(useUIStore.getInitialState());
  useTaskStore.setState(useTaskStore.getInitialState());
  useClientDetailsStore.setState({ category: 'overview', drafts: {}, saveStates: {} });
});

describe('enterClients', () => {
  it('retains the selected client, clears project scope, opens Clients, and starts at Overview', () => {
    useUIStore.setState({ activeCRMPage: 'projects', crmMode: true, contextPanelOpenByMode: {
      documents: true, tasks: true, crm: false, forms: true, settings: true,
    } });
    useTaskStore.setState({ selectedClientId: 'brand-a', selectedProjectId: 'project-a' });
    useClientDetailsStore.getState().setCategory('notes');
    const draft = useClientDetailsStore.getState().startEdit({
      kind: 'note', clientId: 'brand-a', recordId: 'note-a', baseRevision: null, value: draftValue,
    });
    useClientDetailsStore.getState().markSaving(draft.id, draft.editSessionId, draft.generation);

    enterClients();

    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'brand-a', selectedProjectId: null });
    expect(useUIStore.getState()).toMatchObject({ activeCRMPage: 'clients', crmMode: true });
    expect(useUIStore.getState().contextPanelOpenByMode.crm).toBe(true);
    expect(useClientDetailsStore.getState().category).toBe('overview');
    expect(useClientDetailsStore.getState().drafts[draft.id]).toEqual(draft);
    expect(useClientDetailsStore.getState().saveStates[draft.id]).toMatchObject({ status: 'saving' });
    expect('selectedClientId' in useClientDetailsStore.getState()).toBe(false);
  });

  it('does not reset category or edit state when Clients is already active', () => {
    useUIStore.setState({ activeCRMPage: 'clients', crmMode: true });
    useTaskStore.setState({ selectedClientId: 'brand-a', selectedProjectId: 'project-a' });
    useClientDetailsStore.getState().setCategory('notes');
    const draft = useClientDetailsStore.getState().startEdit({
      kind: 'note', clientId: 'brand-a', recordId: 'note-b', baseRevision: null, value: draftValue,
    });
    useClientDetailsStore.getState().markSaving(draft.id, draft.editSessionId, draft.generation);

    enterClients();

    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'brand-a', selectedProjectId: null });
    expect(useClientDetailsStore.getState().category).toBe('notes');
    expect(useClientDetailsStore.getState().drafts[draft.id]).toEqual(draft);
    expect(useClientDetailsStore.getState().saveStates[draft.id]).toMatchObject({ status: 'saving' });
  });
});
