import 'fake-indexeddb/auto';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('reserves the navigation for GitHub repositories instead of documents, notes, or clients', () => {
    useUIStore.setState({ githubMode: true, taskMode: true, activeView: 'notes' });
    const navigationRef = vi.fn();
    render(<LeftNarrowSidebar githubNavigationRef={navigationRef} />);
    const navigation = screen.getByRole('navigation', { name: 'github.repositories' });
    expect(navigation).toHaveAttribute('id', 'nav-bar');
    expect(navigation.querySelector('.github-navigation-slot')).not.toBeNull();
    expect(navigationRef).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    expect(screen.queryByRole('button', { name: 'tabs.newDocument' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tasks.addNewClient' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'tabs.openTabs' })).not.toBeInTheDocument();
  });

  it('keeps client selection unchanged when arrow keys are used on the remove control', async () => {
    useUIStore.setState({ crmMode: true, activeCRMPage: 'clients' });
    useClientStore.setState({ clients: [
      { id: 'c1', name: 'First client', color: '', order: 0, createdAt: 1 },
    ] });
    useTaskStore.setState({ selectedClientId: null, selectedProjectId: null });
    render(<LeftNarrowSidebar />);
    const button = screen.getByRole('button', { name: 'explorer.delete: First client' });
    button.focus();
    await userEvent.keyboard('{ArrowDown}{Home}{End}');
    expect(button).toHaveFocus();
    expect(useTaskStore.getState().selectedClientId).toBeNull();
    expect(screen.queryByText('tasks.deleteClientConfirm')).not.toBeInTheDocument();
  });

  it('confirms client removal without selecting it and leaves built-in scopes intact', async () => {
    useUIStore.setState({ crmMode: true, activeCRMPage: 'clients' });
    useClientStore.setState({ clients: [
      { id: 'c1', name: 'First client', color: '', order: 0, createdAt: 1 },
      { id: 'none', name: 'No Client', color: '', order: 1, createdAt: 1 },
    ] });
    useTaskStore.setState({ selectedClientId: null, selectedProjectId: null });
    const remove = vi.spyOn(useClientStore.getState(), 'deleteClient').mockResolvedValue();
    render(<LeftNarrowSidebar />);
    expect(screen.getAllByRole('button', { name: /^explorer.delete:/ })).toHaveLength(1);
    const button = screen.getByRole('button', { name: 'explorer.delete: First client' });
    expect(button.closest('[role="tab"]')).toBeNull();
    await userEvent.click(button);
    expect(useTaskStore.getState().selectedClientId).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'confirm.cancel' }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'explorer.delete' }));
    expect(remove).toHaveBeenCalledExactlyOnceWith('c1');
  });

  it('animates reordered groups and keeps the drop marker when entering a child', () => {
    useUIStore.setState({ taskMode: true });
    const clients = [
      { id: 'c1', name: 'First client', color: '', order: 0, createdAt: 1 },
      { id: 'c2', name: 'Second client', color: '', order: 1, createdAt: 1 },
    ];
    useClientStore.setState({ clients });
    vi.spyOn(useClientStore.getState(), 'reorderClient').mockImplementation(async () => {
      useClientStore.setState({ clients: clients.map((client) => ({ ...client, order: 1 - client.order })) });
    });
    render(<LeftNarrowSidebar />);
    const target = screen.getByRole('region', { name: 'First client' });
    const source = screen.getByRole('region', { name: 'Second client' });
    const animate = vi.fn();
    for (const row of [target, source]) {
      Object.defineProperty(row, 'animate', { value: animate });
      vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({
        top: Array.from(row.parentElement!.children).indexOf(row) * 100,
        height: 100,
      } as DOMRect));
    }
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(within(source).getByText('Second client'), { dataTransfer });
    expect(source).toHaveAttribute('data-client-dragging', 'true');
    fireEvent.dragOver(target, { dataTransfer });
    const leave = createEvent.dragLeave(target);
    Object.defineProperty(leave, 'relatedTarget', { value: within(target).getByText('First client') });
    fireEvent(target, leave);
    expect(target).toHaveAttribute('data-client-drop-position', 'before');
    act(() => { fireEvent.drop(target, { dataTransfer }); });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: 'translateY(-100px)' }, { transform: 'translateY(0)' }],
      { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    expect(source).not.toHaveAttribute('data-client-dragging');
  });

  it('reorders client groups by dragging their names without changing project ownership', () => {
    useUIStore.setState({ taskMode: true });
    useClientStore.setState({ clients: [
      { id: 'c1', name: 'First client', color: '', order: 0, createdAt: 1 },
      { id: 'c2', name: 'Second client', color: '', order: 1, createdAt: 1 },
    ] });
    useProjectStore.setState({ projects: [
      { id: 'p1', clientId: 'c1', name: 'Website', color: '', order: 0, createdAt: 1 },
    ] });
    const reorder = vi.spyOn(useClientStore.getState(), 'reorderClient').mockResolvedValue();
    render(<LeftNarrowSidebar />);
    const source = screen.getByText('Second client');
    const target = screen.getByRole('region', { name: 'First client' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    expect(source).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 0 });
    expect(target).toHaveAttribute('data-client-drop-position', 'before');
    fireEvent.drop(target, { dataTransfer, clientY: 0 });
    expect(reorder).toHaveBeenCalledWith('c2', 'c1', false);
    expect(target).not.toHaveAttribute('data-client-drop-position');
    reorder.mockClear();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Website' }), { dataTransfer });
    const other = screen.getByRole('region', { name: 'Second client' });
    fireEvent.dragOver(other, { dataTransfer });
    fireEvent.drop(other, { dataTransfer });
    expect(reorder).not.toHaveBeenCalled();
  });

  it('allows CRM client reordering while keeping built-in scopes fixed', () => {
    useUIStore.setState({ crmMode: true, activeCRMPage: 'clients' });
    useClientStore.setState({ clients: [
      { id: 'c1', name: 'First client', color: '', order: 0, createdAt: 1 },
      { id: 'c2', name: 'Second client', color: '', order: 1, createdAt: 1 },
    ] });
    const reorder = vi.spyOn(useClientStore.getState(), 'reorderClient').mockResolvedValue();
    render(<LeftNarrowSidebar />);
    expect(screen.getByRole('tab', { name: 'navigation.everything' })).not.toHaveAttribute('draggable');
    expect(screen.getByRole('tab', { name: 'clients.noClientScope' })).not.toHaveAttribute('draggable');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByRole('tab', { name: 'First client' }), { dataTransfer });
    const target = screen.getByRole('tab', { name: 'Second client' });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, 'clientY', { value: 10 });
    fireEvent(target, dragOver);
    expect(target).toHaveAttribute('data-client-drop-position', 'after');
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, 'clientY', { value: 10 });
    fireEvent(target, drop);
    expect(reorder).toHaveBeenCalledWith('c1', 'c2', true);
  });

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
    expect(within(header).queryByRole('button', { name: 'tabs.closeUneditedTabs' })).not.toBeInTheDocument();
  });

  it('keeps the document creation button in Doc Mode', async () => {
    const createWorkspace = vi.spyOn(useWorkspaceStore.getState(), 'createWorkspace').mockResolvedValue(workspace('new'));
    useWorkspaceStore.setState({ workspaces: [workspace('first'), workspace('last')], activeWorkspaceId: 'last' });
    const { container } = render(<LeftNarrowSidebar />);
    const header = container.querySelector('.nav-bar-header') as HTMLElement;
    expect(within(header).queryByRole('button', { name: 'tasks.addNewClient' })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'tabs.newDocument' })).not.toBeInTheDocument();
    const newDocument = screen.getByRole('button', { name: 'tabs.newDocument' });
    const tabList = screen.getByRole('tablist', { name: 'tabs.openTabs' });
    expect(tabList.nextElementSibling).toBe(newDocument.parentElement);
    expect(tabList.parentElement).toHaveClass('document-navigation');
    expect(within(tabList).getAllByRole('tab')).toHaveLength(2);
    await userEvent.click(newDocument);
    expect(createWorkspace).toHaveBeenCalledOnce();
  });
});

describe('sidebar close unedited tabs', () => {
  it('closes saved and empty tabs, preserves dirty drafts, and never prompts', async () => {
    const tabs = [workspace('saved', false), workspace('draft', true), workspace('empty')];
    await db.workspaces.bulkPut(tabs);
    useWorkspaceStore.setState({ workspaces: tabs, activeWorkspaceId: 'saved' });
    const confirm = vi.spyOn(window, 'confirm');
    const { container } = render(<LeftNarrowSidebar />);
    const clearButton = screen.getByRole('button', { name: 'tabs.closeUneditedTabs' });
    expect(clearButton).toHaveTextContent('tabs.clearTabs');
    expect(clearButton.parentElement).toBe(container.querySelector('#nav-bar > .nav-bar-header > .nav-bar-toolbar'));
    await userEvent.click(clearButton);
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
    render(<LeftNarrowSidebar />);
    await userEvent.click(screen.getByRole('button', { name: 'tabs.closeUneditedTabs' }));
    await waitFor(() => {
      const remaining = useWorkspaceStore.getState().workspaces;
      expect(remaining).toHaveLength(1);
      expect(tabs.some((tab) => tab.id === remaining[0].id)).toBe(false);
      expect(remaining[0].currentFile).toBeNull();
    });
  });
});
