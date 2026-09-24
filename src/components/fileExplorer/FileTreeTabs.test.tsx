import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../services/db';
import { openFolderDialog, readDir } from '../../services/fs-adapter';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { FileTreeTabs } from './FileTreeTabs';

vi.mock('../../services/db', () => ({
  db: {
    settings: { get: vi.fn(), put: vi.fn().mockResolvedValue(undefined) },
    workspaces: { put: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('../../services/fs-adapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/fs-adapter')>(),
  isNativeFsAvailable: () => true,
  openFolderDialog: vi.fn(),
  readDir: vi.fn(),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  vi.mocked(readDir).mockResolvedValue([]);
  vi.mocked(openFolderDialog).mockResolvedValue('C:/Other');
});
afterEach(cleanup);

describe('workspace folder control', () => {
  it('replaces the default for only the selected workspace and retains the default for new tabs', async () => {
    useWorkspaceStore.setState({ defaultFolderPath: 'C:/Default' });
    const first = await useWorkspaceStore.getState().createWorkspace();
    const second = await useWorkspaceStore.getState().createWorkspace();
    render(<FileTreeTabs />);

    fireEvent.click(screen.getByRole('button', { name: 'explorer.changeFolder' }));
    await waitFor(() => expect(screen.getByText('C:/Other')).toBeInTheDocument());
    const state = useWorkspaceStore.getState();
    expect(state.workspaces.find((workspace) => workspace.id === first.id)?.connectedFolders[0].path).toBe('C:/Default');
    expect(state.workspaces.find((workspace) => workspace.id === second.id)?.connectedFolders[0].path).toBe('C:/Other');
    expect(state.defaultFolderPath).toBe('C:/Default');
    expect(db.workspaces.put).toHaveBeenCalledWith(expect.objectContaining({
      id: second.id, connectedFolders: [{ id: '0', path: 'C:/Other' }],
    }));
    await act(async () => {
      const third = await useWorkspaceStore.getState().createWorkspace();
      expect(third.connectedFolders[0].path).toBe('C:/Default');
    });
  });

  it('names empty tabs consecutively as Doc N', async () => {
    const first = await useWorkspaceStore.getState().createWorkspace();
    const second = await useWorkspaceStore.getState().createWorkspace();
    const third = await useWorkspaceStore.getState().createWorkspace();

    expect([first.name, second.name, third.name]).toEqual(['Doc 1', 'Doc 2', 'Doc 3']);
  });

  it.each(['cancel', 'failure'])('keeps the old folder on picker %s', async (outcome) => {
    useWorkspaceStore.setState({ defaultFolderPath: 'C:/Default' });
    const workspace = await useWorkspaceStore.getState().createWorkspace();
    if (outcome === 'cancel') vi.mocked(openFolderDialog).mockResolvedValue(null);
    else vi.mocked(readDir).mockRejectedValueOnce(new Error('Cannot read folder'));

    await useWorkspaceStore.getState().connectFolderInWorkspace(workspace.id, undefined, { replaceExisting: true });
    expect(useWorkspaceStore.getState().getActiveConnectedFolders()[0].path).toBe('C:/Default');
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.connectedFolders[0].path).toBe('C:/Default');
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it('keeps automatic connection from replacing an existing folder', async () => {
    useWorkspaceStore.setState({ defaultFolderPath: 'C:/Default' });
    const workspace = await useWorkspaceStore.getState().createWorkspace();
    await useWorkspaceStore.getState().connectFolderInWorkspace(workspace.id, 'C:/Other');
    expect(useWorkspaceStore.getState().getActiveConnectedFolders()[0].path).toBe('C:/Default');
    expect(openFolderDialog).not.toHaveBeenCalled();
  });

  it('offers the original connection action when empty and disables changing while loading', async () => {
    await useWorkspaceStore.getState().createWorkspace();
    render(<FileTreeTabs />);
    expect(screen.queryByRole('button', { name: 'explorer.changeFolder' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'explorer.selectFolder' }));
    await waitFor(() => expect(screen.getByText('C:/Other')).toBeInTheDocument());
    act(() => useWorkspaceStore.setState({ loading: true }));
    expect(screen.getByRole('button', { name: 'explorer.changeFolder' })).toBeDisabled();
  });
});
