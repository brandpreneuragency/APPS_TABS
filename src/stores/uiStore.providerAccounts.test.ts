import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectActiveWorkspaceMode, selectIsContextPanelAvailable, useUIStore } from './uiStore';
import { mergeContextPanelOpenByMode } from './uiLayoutState';

vi.mock('../services/db', () => ({ db: { settings: { put: vi.fn().mockResolvedValue(undefined) } } }));
beforeEach(() => useUIStore.setState(useUIStore.getInitialState()));

describe('provider accounts workspace boundary', () => {
  it('enters its own mode without changing remembered task scope or the assistant selection', () => {
    useUIStore.setState({ taskMode: true, activeTaskPage: 'calendar', activeTaskId: 'task-a',
      primaryWrapperOpen: false, sidebarTab: 'chat', assistantWrapperOpen: true });
    useUIStore.getState().setActiveView('providerAccounts');
    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('providerAccounts');
    expect(selectIsContextPanelAvailable(useUIStore.getState())).toBe(false);
    expect(useUIStore.getState()).toMatchObject({ taskMode: false, githubMode: false, crmMode: false,
      primaryWrapperOpen: true, activeTaskPage: 'calendar', activeTaskId: 'task-a', sidebarTab: 'chat', assistantWrapperOpen: true });
    useUIStore.getState().setTaskMode(true);
    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('tasks');
    expect(useUIStore.getState().activeTaskPage).toBe('calendar');
  });

  it('defaults the new optional panel state without dropping existing saved settings', () => {
    const merged = mergeContextPanelOpenByMode({ tasks: false, notes: true });
    expect(merged).toMatchObject({ tasks: false, notes: true, providerAccounts: false });
  });
});
