import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../types';
import { db } from '../../services/db';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { LeftNarrowSidebar } from './LeftNarrowSidebar';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function workspace(id: string, dirty?: boolean): Workspace {
  return {
    id, name: id, connectedFolders: [], activeFolderId: null,
    currentFile: dirty === undefined ? null : {
      path: dirty ? `__draft__:${id}` : `C:/test/${id}.md`,
      name: `${id}.md`, content: '{"type":"doc"}', isDirty: dirty,
    },
    expandedPaths: [], selectedTreePath: null, createdAt: 0, updatedAt: 0, order: 0,
  };
}

beforeEach(async () => {
  useUIStore.setState(useUIStore.getInitialState());
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  await db.workspaces.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('sidebar header add button', () => {
  it('groups project buttons by client and selects the exact project', async () => {
    useUIStore.setState({ taskMode: true });
    useClientStore.setState({ clients: [
      { id: 'c1', name: 'Wagner Atelier', color: '', order: 0, createdAt: 1 },
      { id: 'c2', name: 'Other client', color: '', order: 1, createdAt: 1 },
    ] });
    useProjectStore.setState({ projects: [
      { id: 'p1', clientId: 'c1', name: 'General', color: '', order: 0, createdAt: 1 },
      { id: 'p2', clientId: 'c1', name: 'Website', color: '', order: 1, createdAt: 1 },
      { id: 'p3', clientId: 'c2', name: 'General', color: '', order: 2, createdAt: 1 },
    ] });
    render(<LeftNarrowSidebar />);
    const client = screen.getByRole('region', { name: 'Wagner Atelier' });
    const allButton = within(client).getByRole('button', { name: 'navigation.all' });
    expect(allButton).toBe(client.querySelector('.scope-project-content')?.children[1]);
    await userEvent.click(within(client).getByRole('button', { name: 'Website' }));
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'c1', selectedProjectId: 'p2' });
    expect(within(client).getByRole('button', { name: 'Website' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('region', { name: 'Other client' })).getByRole('button', { name: 'General' })).not.toHaveAttribute('aria-current');
    await userEvent.click(allButton);
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'c1', selectedProjectId: null });
    expect(allButton).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(client).getByRole('button', { name: 'Website' }));
    const reorder = vi.spyOn(useProjectStore.getState(), 'reorderProject').mockResolvedValue();
    const source = within(client).getByRole('button', { name: 'Website' });
    const target = within(client).getByRole('button', { name: 'General' });
    const other = within(screen.getByRole('region', { name: 'Other client' })).getByRole('button', { name: 'General' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(other, { dataTransfer, clientY: 0 });
    fireEvent.drop(other, { dataTransfer });
    expect(reorder).not.toHaveBeenCalled();
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 0 });
    expect(target).toHaveAttribute('data-drop-position', 'before');
    fireEvent.drop(target, { dataTransfer });
    expect(reorder).toHaveBeenCalledWith('p2', 'p1', false);
  });
  it.each([
    { taskMode: true },
    { crmMode: true, activeCRMPage: 'clients' as const },
    { crmMode: true, activeCRMPage: 'projects' as const },
    { crmMode: true, activeCRMPage: 'leads' as const },
    { crmMode: true, activeCRMPage: 'pipeline' as const },
    { crmMode: true, activeCRMPage: 'forms' as const },
    { activeView: 'settings' as const },
  ])('opens Add Client in the header for %j', async (mode) => {
    useUIStore.setState(mode);
    const { container } = render(<LeftNarrowSidebar />);
    const header = container.querySelector('.nav-bar-header') as HTMLElement;
    await userEvent.click(within(header).getByRole('button', { name: 'tasks.addNewClient' }));
    expect(within(header).getByRole('dialog', { name: 'tasks.addNewClient' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'tasks.clientNamePlaceholder' })).toHaveFocus();
    expect(within(header).queryByRole('button', { name: 'tabs.newDocument' })).not.toBeInTheDocument();
  });

  it('keeps the document creation button in Doc Mode', async () => {
    const createWorkspace = vi.spyOn(useWorkspaceStore.getState(), 'createWorkspace').mockResolvedValue(workspace('new'));
    const { container } = render(<LeftNarrowSidebar />);
    const header = container.querySelector('.nav-bar-header') as HTMLElement;
    expect(within(header).queryByRole('button', { name: 'tasks.addNewClient' })).not.toBeInTheDocument();
    await userEvent.click(within(header).getByRole('button', { name: 'tabs.newDocument' }));
    expect(createWorkspace).toHaveBeenCalledOnce();
  });
});

describe('sidebar close unedited tabs', () => {
  it('closes saved and empty tabs, preserves dirty drafts, and never prompts', async () => {
    const tabs = [workspace('saved', false), workspace('draft', true), workspace('empty')];
    await db.workspaces.bulkPut(tabs);
    useWorkspaceStore.setState({ workspaces: tabs, activeWorkspaceId: 'saved' });
    const confirm = vi.spyOn(window, 'confirm');
    render(<LeftNarrowSidebar />);
    await userEvent.click(screen.getByRole('button', { name: 'tabs.closeUneditedTabs' }));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces.map((tab) => tab.id)).toEqual(['draft']));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('draft');
    expect(await db.workspaces.toArray()).toEqual([tabs[1]]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves one fresh blank tab when all existing tabs are clean', async () => {
    const tabs = [workspace('saved', false), workspace('empty')];
    await db.workspaces.bulkPut(tabs);
    useWorkspaceStore.setState({ workspaces: tabs, activeWorkspaceId: 'saved' });
    await useWorkspaceStore.getState().closeUneditedWorkspaces();
    const remaining = useWorkspaceStore.getState().workspaces;
    expect(remaining).toHaveLength(1);
    expect(tabs.some((tab) => tab.id === remaining[0].id)).toBe(false);
    expect(remaining[0].currentFile).toBeNull();
  });
});
