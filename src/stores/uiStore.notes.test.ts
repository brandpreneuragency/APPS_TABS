import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectActiveWorkspaceMode, selectIsContextPanelAvailable, useUIStore } from './uiStore';

vi.mock('../services/db', () => ({ db: { settings: { put: vi.fn().mockResolvedValue(undefined) } } }));
beforeEach(() => useUIStore.setState(useUIStore.getInitialState()));

describe('Notes workspace routing', () => {
  it('enters independent Notes from Calendar without changing its remembered view or scope', () => {
    useUIStore.setState({ taskMode: true, activeTaskPage: 'calendar', primaryWrapperOpen: false });
    useUIStore.getState().setActiveView('notes');
    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('notes');
    expect(selectIsContextPanelAvailable(useUIStore.getState())).toBe(false);
    expect(useUIStore.getState()).toMatchObject({
      taskMode: false, githubMode: false, crmMode: false, activeTaskPage: 'calendar', primaryWrapperOpen: true,
    });
    useUIStore.getState().setTaskMode(true);
    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('tasks');
    expect(useUIStore.getState().activeTaskPage).toBe('calendar');
  });

  it('leaves Notes for documents, settings and GitHub', () => {
    for (const enter of [
      () => useUIStore.getState().setActiveView('document'),
      () => useUIStore.getState().openSettings(),
      () => useUIStore.getState().setGithubMode(true),
    ]) {
      useUIStore.getState().setActiveView('notes');
      enter();
      expect(selectActiveWorkspaceMode(useUIStore.getState())).not.toBe('notes');
    }
  });
});
