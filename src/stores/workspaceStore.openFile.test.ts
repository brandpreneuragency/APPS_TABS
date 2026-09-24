import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import { selectActiveWorkspaceMode, useUIStore } from './uiStore';
import { readTextFile } from '../services/fs-adapter';

const { settingsPut } = vi.hoisted(() => ({ settingsPut: vi.fn() }));
vi.mock('../services/db', () => ({
  db: {
    settings: { get: vi.fn().mockResolvedValue(undefined), put: settingsPut },
    workspaces: { put: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('../services/fs-adapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/fs-adapter')>(),
  isNativeFsAvailable: () => true,
  readDir: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  settingsPut.mockResolvedValue(undefined);
  vi.mocked(readTextFile).mockResolvedValue('# Requested document');
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useUIStore.setState(useUIStore.getInitialState(), true);
});

async function addWorkspace(folder: string, path?: string, isDirty = false) {
  const store = useWorkspaceStore.getState();
  const ws = await store.createWorkspace();
  await store.connectFolderInWorkspace(ws.id, folder);
  if (path) store.updateWorkspace(ws.id, {
    currentFile: { path, name: path.split('/').pop()!, content: 'preserved editor content', isDirty },
  });
  return ws.id;
}

describe('Explorer document routing', () => {
  it.each([
    { taskMode: true, crmMode: false, activeView: 'document' as const, activeCRMPage: 'clients' as const },
    { taskMode: false, crmMode: true, activeView: 'document' as const, activeCRMPage: 'projects' as const },
    { taskMode: false, crmMode: true, activeView: 'document' as const, activeCRMPage: 'forms' as const },
    { taskMode: false, crmMode: false, activeView: 'settings' as const, activeCRMPage: 'clients' as const },
  ])('opens the requested file in DOCS from $activeView / task=$taskMode / CRM=$activeCRMPage', async (mode) => {
    const id = await addWorkspace('C:/Notes', 'C:/Notes/unrelated.md');
    useUIStore.setState({ ...mode, primaryWrapperOpen: false });

    await useWorkspaceStore.getState().openFileByPath('C:\\Notes\\requested.md');

    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('documents');
    expect(useUIStore.getState().primaryWrapperOpen).toBe(true);
    expect(useWorkspaceStore.getState().getActiveWorkspace()).toMatchObject({
      id, currentFile: { path: 'C:/Notes/requested.md', name: 'requested.md', isDirty: false },
    });
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.currentFile?.content).toContain('Requested document');
    expect(settingsPut).toHaveBeenCalledWith({ key: 'taskMode', value: false });
    expect(settingsPut).toHaveBeenCalledWith({ key: 'crmMode', value: false });
  });

  it('selects the document already open in another tab, preserving its edits', async () => {
    const unrelated = await addWorkspace('C:/Notes', 'C:/Notes/other.md');
    const requested = await addWorkspace('C:/Notes', 'C:/Notes/requested.md', true);
    useWorkspaceStore.getState().setActiveWorkspace(unrelated);
    useUIStore.setState({ taskMode: true });

    await useWorkspaceStore.getState().openFileByPath('c:\\notes\\REQUESTED.md');

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    expect(useWorkspaceStore.getState().getActiveWorkspace()).toMatchObject({
      id: requested, currentFile: { content: 'preserved editor content', isDirty: true },
    });
    expect(readTextFile).not.toHaveBeenCalled();
    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('documents');
  });

  it('keeps an unrelated dirty document and opens the requested file in a new tab', async () => {
    const dirtyId = await addWorkspace('C:/Notes', 'C:/Notes/other.md', true);
    await useWorkspaceStore.getState().openFileByPath('C:/Notes/requested.md');

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces.find((ws) => ws.id === dirtyId)?.currentFile).toMatchObject({
      path: 'C:/Notes/other.md', content: 'preserved editor content', isDirty: true,
    });
    expect(state.getActiveWorkspace()?.currentFile?.path).toBe('C:/Notes/requested.md');
  });

  it('refreshes a clean document in its existing tab when the disk content changed', async () => {
    await addWorkspace('C:/Notes', 'C:/Notes/other.md');
    const requested = await addWorkspace('C:/Notes', 'C:/Notes/requested.md');
    vi.mocked(readTextFile).mockResolvedValue('# Changed on disk');

    await useWorkspaceStore.getState().openFileByPath('C:/Notes/requested.md');

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(requested);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.currentFile?.content).toContain('Changed on disk');
  });

  it('keeps a drive-root parent absolute when connecting the requested document folder', async () => {
    await useWorkspaceStore.getState().openFileByPath('C:\\requested.md');
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.connectedFolders).toEqual([{ id: '0', path: 'C:/' }]);
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.name).toBe('C:/');
  });

  it('uses the requested file folder instead of the configured default on a new tab', async () => {
    await addWorkspace('C:/Existing');
    useWorkspaceStore.setState({ defaultFolderPath: 'C:/Default' });
    useUIStore.setState({ crmMode: true, activeCRMPage: 'projects' });
    vi.mocked(readTextFile).mockResolvedValue('');

    await useWorkspaceStore.getState().openFileByPath('C:/Desktop/New TABS Markdown Document.md');

    const ws = useWorkspaceStore.getState().getActiveWorkspace();
    expect(ws?.connectedFolders).toEqual([{ id: '0', path: 'C:/Desktop' }]);
    expect(ws?.currentFile).toMatchObject({ path: 'C:/Desktop/New TABS Markdown Document.md', isDirty: false });
    expect(JSON.parse(ws!.currentFile!.content)).toMatchObject({ type: 'doc' });
    expect(selectActiveWorkspaceMode(useUIStore.getState())).toBe('documents');
  });

  it('does not select an unrelated document if the requested file cannot be read', async () => {
    const before = await addWorkspace('C:/Notes', 'C:/Notes/other.md');
    useUIStore.setState({ taskMode: true });
    vi.mocked(readTextFile).mockRejectedValue(new Error('Missing file'));

    await useWorkspaceStore.getState().openFileByPath('C:/Notes/missing.md');

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(before);
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.currentFile?.path).toBe('C:/Notes/other.md');
    expect(useUIStore.getState().taskMode).toBe(true);
    expect(useUIStore.getState().toasts.at(-1)?.message).toContain('Could not read file');
  });
});
