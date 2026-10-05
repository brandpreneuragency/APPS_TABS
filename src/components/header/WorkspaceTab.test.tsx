import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceFile } from '../../types';
import { db } from '../../services/db';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { WorkspaceTab } from './WorkspaceTab';
import { TreeNode } from '../fileExplorer/TreeNode';

const { persistedWorkspaces } = vi.hoisted(() => ({
  persistedWorkspaces: new Map<string, Workspace>(),
}));

vi.mock('../../services/db', () => ({
  db: {
    settings: {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    },
    workspaces: {
      put: vi.fn(async (workspace: Workspace) => {
        persistedWorkspaces.set(workspace.id, structuredClone(workspace));
      }),
      toArray: vi.fn(async () => [...persistedWorkspaces.values()].map((workspace) => structuredClone(workspace))),
    },
  },
}));

vi.mock('../../services/fs-adapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/fs-adapter')>(),
  isNativeFsAvailable: () => true,
  exists: vi.fn().mockResolvedValue(true),
  readDir: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue('Brief content'),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function file(name: string): WorkspaceFile {
  return { name, path: `C:/Projects/${name}`, content: '{"type":"doc"}', isDirty: false };
}

function workspace(updates: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-tab-test', name: 'Doc 1', connectedFolders: [], activeFolderId: null,
    currentFile: file('brief.md'), expandedPaths: [], selectedTreePath: null,
    createdAt: 0, updatedAt: 0, order: 0, ...updates,
  };
}

function tab(current: Workspace, isActive = true, charLimit = 80, onClose = vi.fn(), onSelect = vi.fn()) {
  return <WorkspaceTab workspace={current} index={2} isActive={isActive} charLimit={charLimit}
    onSelect={onSelect} onClose={onClose} onRename={vi.fn()} />;
}

function StoredWorkspaceTab({ id }: { id: string }) {
  const current = useWorkspaceStore((state) => state.workspaces.find((entry) => entry.id === id));
  if (!current) return null;
  return (
    <WorkspaceTab workspace={current} index={0} isActive charLimit={80}
      onSelect={() => undefined} onClose={() => undefined}
      onRename={(name) => useWorkspaceStore.getState().renameWorkspace(id, name)} />
  );
}

beforeEach(() => {
  persistedWorkspaces.clear();
  vi.clearAllMocks();
  vi.mocked(db.settings.get).mockResolvedValue(undefined);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('WorkspaceTab names', () => {
  it.each([
    ['Doc 7', 'Doc 7', 'brief'],
    ['Workspace 7', 'Workspace 7', 'brief'],
    ['Projects', 'Projects', 'brief'],
    ['__BROWSER_ROOT__:Projects', 'Projects', 'brief'],
    ['Launch notes', 'Launch notes', 'Launch notes'],
  ])('retains the legacy reload heuristic without inferring intent for %s', async (name, loadedName, label) => {
    const legacy = workspace({ name, connectedFolders: [{ id: '0', path: 'C:/Projects' }] });
    persistedWorkspaces.set(legacy.id, structuredClone(legacy));
    await useWorkspaceStore.getState().loadWorkspaces();
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe(loadedName);
    expect(useWorkspaceStore.getState().workspaces[0].nameIsCustom).toBeUndefined();
    expect(persistedWorkspaces.get(legacy.id)?.nameIsCustom).toBeUndefined();
    render(<StoredWorkspaceTab id={legacy.id} />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', label);
  });

  it('records explicit intent when confirming an unchanged no-file generated label', async () => {
    const current = workspace({ name: 'Doc 7', currentFile: null });
    useWorkspaceStore.setState({ workspaces: [current] });
    const user = userEvent.setup();
    render(<StoredWorkspaceTab id={current.id} />);
    await user.dblClick(screen.getByText('Doc 7'));
    await user.type(screen.getByRole('textbox'), '{Enter}');
    expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ name: 'Doc 7', nameIsCustom: true });
    await waitFor(() => expect(persistedWorkspaces.get(current.id)).toMatchObject({ name: 'Doc 7', nameIsCustom: true }));
    act(() => useWorkspaceStore.getState().updateWorkspace(current.id, { currentFile: file('brief.md') }));
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Doc 7');
  });

  it('keeps the middle-click folder-derived name automatic rather than marking it as a rename', async () => {
    render(<ul><TreeNode depth={0} node={{ name: 'brief.md', path: 'brief.md', fullPath: 'C:/Projects/brief.md', kind: 'file' }} /></ul>);
    await act(async () => {
      fireEvent(screen.getByText('brief.md'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    });
    const created = useWorkspaceStore.getState().workspaces[0];
    expect(created).toMatchObject({ name: 'Projects', nameIsCustom: false, currentFile: { name: 'brief.md' } });
    expect(persistedWorkspaces.get(created.id)).toMatchObject({ name: 'Projects', nameIsCustom: false });
    render(<StoredWorkspaceTab id={created.id} />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'brief');
  });

  it.each([
    ['Doc 7', false, [], false],
    ['Previously automatic label', false, [], false],
    ['Launch notes', true, [], true],
    ['Doc 7', true, [], true],
    ['__BROWSER_ROOT__:Projects', true, [], true],
    ['Projects', true, [{ id: '0', path: 'C:/Projects' }], true],
    ['', undefined, [], false],
    ['   ', undefined, [], false],
    ['Doc 7', undefined, [], false],
    ['Workspace 7', undefined, [], false],
    ['__BROWSER_ROOT__:Projects', undefined, [], false],
    ['Projects', undefined, [{ id: '0', path: 'C:/Projects' }], false],
    ['Projects', undefined, [{ id: '0', path: 'C:\\Projects' }], false],
    ['Projects', undefined, [{ id: '0', path: '__BROWSER_ROOT__:Projects' }], false],
    ['C:/', undefined, [{ id: '0', path: 'C:/' }], false],
    ['Launch notes', undefined, [{ id: '0', path: 'C:/Projects' }], true],
  ] satisfies [string, boolean | undefined, Workspace['connectedFolders'], boolean][])(
    'preserves duplicate naming intent for %s (source flag %s)', async (name, nameIsCustom, connectedFolders, isCustom) => {
      const source = workspace({ name, nameIsCustom, connectedFolders });
      useWorkspaceStore.setState({ workspaces: [source] });
      persistedWorkspaces.set(source.id, structuredClone(source));
      const copy = await useWorkspaceStore.getState().duplicateWorkspace(source.id);
      expect(copy).toMatchObject({ name: `${source.name} (copy)`, nameIsCustom: isCustom });
      expect(persistedWorkspaces.get(copy.id)).toMatchObject({ name: copy.name, nameIsCustom: isCustom });
      expect(useWorkspaceStore.getState().workspaces[0]).toEqual(source);
      const view = render(<StoredWorkspaceTab id={copy.id} />);
      expect(screen.getByRole('tab')).toHaveAttribute('title', isCustom ? copy.name : 'brief');
      view.unmount();

      useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
      await useWorkspaceStore.getState().loadWorkspaces();
      const reloaded = useWorkspaceStore.getState().workspaces.find((entry) => entry.id === copy.id)!;
      expect(reloaded.nameIsCustom).toBe(isCustom);
      expect(persistedWorkspaces.get(copy.id)?.nameIsCustom).toBe(isCustom);
      render(<StoredWorkspaceTab id={copy.id} />);
      expect(screen.getByRole('tab')).toHaveAttribute('title', isCustom ? copy.name : 'brief');
      act(() => useWorkspaceStore.getState().updateWorkspace(copy.id, { currentFile: file('next.md') }));
      expect(screen.getByRole('tab')).toHaveAttribute('title', isCustom ? copy.name : 'next');
      act(() => useWorkspaceStore.getState().closeCurrentFile(copy.id));
      expect(screen.getByRole('tab')).toHaveAttribute('title', reloaded.name);
      expect(persistedWorkspaces.get(copy.id)).toMatchObject({ nameIsCustom: isCustom, currentFile: null });
    },
  );

  it.each([false, true])('replaces a folder with preserveName=%s and persists the resulting intent', async (preserveName) => {
    const store = useWorkspaceStore.getState();
    const created = await store.createWorkspace('Doc 7');
    await store.connectFolderInWorkspace(created.id, 'C:/Projects', { preserveName: true });
    store.updateWorkspace(created.id, { currentFile: file('brief.md') });
    await store.connectFolderInWorkspace(created.id, 'C:/Other', { replaceExisting: true, preserveName });
    expect(persistedWorkspaces.get(created.id)).toMatchObject({
      name: preserveName ? 'Doc 7' : 'Other', nameIsCustom: preserveName,
    });
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    await useWorkspaceStore.getState().loadWorkspaces();
    render(<StoredWorkspaceTab id={created.id} />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', preserveName ? 'Doc 7' : 'brief');
    act(() => useWorkspaceStore.getState().disconnectFolderInWorkspace(created.id, '0'));
    expect(screen.getByRole('tab')).toHaveAttribute('title', preserveName ? 'Doc 7' : 'brief');
    await act(() => useWorkspaceStore.getState().setDefaultFolderPath('C:/NextDefault'));
    expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({
      name: preserveName ? 'Doc 7' : 'NextDefault', nameIsCustom: preserveName,
    });
  });

  it.each([undefined, '', '   ', 'Doc 7', 'Workspace 7', 'Projects', '__BROWSER_ROOT__:Projects'])(
    'records creation intent for %s while attaching the default folder', async (name) => {
      useWorkspaceStore.setState({ defaultFolderPath: 'C:/Projects' });
      const created = await useWorkspaceStore.getState().createWorkspace(name);
      const isCustom = !!name?.trim();
      expect(created).toMatchObject({ name: isCustom ? name : 'Projects', nameIsCustom: isCustom });
      expect(persistedWorkspaces.get(created.id)).toMatchObject({ name: created.name, nameIsCustom: isCustom });
      useWorkspaceStore.getState().updateWorkspace(created.id, { currentFile: file('brief.md') });
      render(<StoredWorkspaceTab id={created.id} />);
      expect(screen.getByRole('tab')).toHaveAttribute('title', isCustom ? name : 'brief');
    },
  );

  it.each([
    ['apply', 'Doc 7'], ['reload', 'Doc 7'],
    ['apply', 'Workspace 7'], ['reload', 'Workspace 7'],
    ['apply', 'Projects'], ['reload', 'Projects'],
    ['apply', '__BROWSER_ROOT__:Projects'], ['reload', '__BROWSER_ROOT__:Projects'],
  ])('keeps explicit names during default-folder %s: %s', async (mode, name) => {
    const store = useWorkspaceStore.getState();
    const created = await store.createWorkspace();
    store.renameWorkspace(created.id, name);
    if (mode === 'apply') {
      await store.setDefaultFolderPath('C:/Default');
    } else {
      useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
      vi.mocked(db.settings.get).mockResolvedValue({ key: 'defaultWorkspaceFolder', value: 'C:/Default' });
      await useWorkspaceStore.getState().loadWorkspaces();
    }
    expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({
      name, nameIsCustom: true, connectedFolders: [{ id: '0', path: 'C:/Default' }],
    });
    expect(persistedWorkspaces.get(created.id)).toMatchObject({ name, nameIsCustom: true });
    render(<StoredWorkspaceTab id={created.id} />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', name);
    act(() => useWorkspaceStore.getState().disconnectFolderInWorkspace(created.id, '0'));
    await act(() => useWorkspaceStore.getState().setDefaultFolderPath('C:/NextDefault'));
    expect(screen.getByRole('tab')).toHaveAttribute('title', name);
    expect(useWorkspaceStore.getState().workspaces[0].connectedFolders[0].path).toBe('C:/NextDefault');
  });

  it.each(['Doc 7', 'Workspace 7', 'Projects', '__BROWSER_ROOT__:Projects'])(
    'preserves explicit rename %s through persistence and file changes', async (name) => {
      const user = userEvent.setup();
      const store = useWorkspaceStore.getState();
      const created = await store.createWorkspace();
      await store.connectFolderInWorkspace(created.id, 'C:/Projects');
      store.updateWorkspace(created.id, { currentFile: file('brief.md') });
      const view = render(<StoredWorkspaceTab id={created.id} />);
      await user.dblClick(screen.getByText('brief'));
      await user.clear(screen.getByRole('textbox'));
      await user.type(screen.getByRole('textbox'), `${name}{Enter}`);
      expect(screen.getByRole('tab')).toHaveAttribute('title', name);
      await waitFor(() => expect(persistedWorkspaces.get(created.id)).toMatchObject({ name, nameIsCustom: true }));

      view.unmount();
      useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
      await useWorkspaceStore.getState().loadWorkspaces();
      render(<StoredWorkspaceTab id={created.id} />);
      expect(screen.getByRole('tab')).toHaveAttribute('title', name);
      expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ name, nameIsCustom: true });
      act(() => useWorkspaceStore.getState().updateWorkspace(created.id, { currentFile: file('next.md') }));
      expect(screen.getByRole('tab')).toHaveAttribute('title', name);
      act(() => useWorkspaceStore.getState().closeCurrentFile(created.id));
      expect(screen.getByRole('tab')).toHaveAttribute('title', name);
    },
  );

  it('shows a double-click rename with a file open after persistence and file changes', async () => {
    const user = userEvent.setup();
    const store = useWorkspaceStore.getState();
    const created = await store.createWorkspace();
    await store.connectFolderInWorkspace(created.id, 'C:/Projects');
    store.updateWorkspace(created.id, { currentFile: file('brief.md') });
    const view = render(<StoredWorkspaceTab id={created.id} />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'brief');

    await user.dblClick(screen.getByText('brief'));
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('brief');
    await user.clear(input);
    await user.type(input, '  Launch notes  {Enter}');

    expect(useWorkspaceStore.getState().workspaces[0].name).toBe('Launch notes');
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Launch notes');
    expect(screen.getByText('Launch notes')).toBeVisible();
    await waitFor(() => expect(persistedWorkspaces.get(created.id)?.name).toBe('Launch notes'));

    view.unmount();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    await useWorkspaceStore.getState().loadWorkspaces();
    render(<StoredWorkspaceTab id={created.id} />);
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Launch notes');
    expect(useWorkspaceStore.getState().workspaces[0].currentFile?.name).toBe('brief.md');

    act(() => useWorkspaceStore.getState().updateWorkspace(created.id, { currentFile: file('follow-up.txt') }));
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Launch notes');
    act(() => useWorkspaceStore.getState().closeCurrentFile(created.id));
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Launch notes');
  });

  it.each([
    ['', []],
    ['   ', []],
    ['Doc 7', []],
    ['Workspace 7', []],
    ['Projects', [{ id: '0', path: 'C:/Projects' }]],
    ['Projects', [{ id: '0', path: 'C:\\Projects' }]],
    ['Projects', [{ id: '0', path: '__BROWSER_ROOT__:Projects' }]],
    ['__BROWSER_ROOT__:Projects', []],
    ['C:/', [{ id: '0', path: 'C:/' }]],
  ] satisfies [string, Workspace['connectedFolders']][])('keeps automatic name %s file-first', (name, connectedFolders) => {
    const current = workspace({ name, connectedFolders });
    const view = render(tab(current));
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'brief');
    view.rerender(tab({ ...current, currentFile: file('follow-up.txt') }));
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'follow-up');
  });

  it.each([
    ['report.v2.md', 'report.v2'],
    ['README', 'README'],
    ['.env', '.env'],
  ])('preserves filename formatting for %s', (name, label) => {
    render(tab(workspace({ currentFile: file(name) })));
    expect(screen.getByRole('tab')).toHaveAttribute('title', label);
    expect(screen.getByText(label)).toBeVisible();
  });

  it.each([
    ['', 'Doc 3'],
    ['   ', 'Doc 3'],
    ['Workspace 7', 'Doc 3'],
    ['Doc 7', 'Doc 7'],
    ['Notes', 'Notes'],
    ['__BROWSER_ROOT__:Projects', 'Projects'],
    ['__BROWSER_ROOT__:', 'Doc 3'],
  ])('preserves no-file label %s as %s', (name, label) => {
    render(tab(workspace({ name, currentFile: null })));
    expect(screen.getByRole('tab')).toHaveAttribute('title', label);
    expect(screen.getByText(label)).toBeVisible();
  });

  it('uses a persisted custom name for active and passive tabs with the normal icon and truncation', () => {
    const current = workspace({ name: 'Saved custom workspace', connectedFolders: [{ id: '0', path: 'C:/Projects' }] });
    const view = render(tab(current, true, 8));
    expect(screen.getByRole('tab')).toHaveAttribute('title', current.name);
    expect(screen.getByText('Saved cu…')).toBeVisible();
    expect(screen.getByRole('tab').querySelector('svg.lucide-file-text')).toBeInTheDocument();
    view.rerender(tab({ ...current, currentFile: file('other.md') }, false, 8));
    expect(screen.getByRole('tab')).toHaveAttribute('title', current.name);
    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'false');
  });

  it('does not start renaming an inactive tab', async () => {
    const user = userEvent.setup();
    render(tab(workspace(), false));
    await user.dblClick(screen.getByText('brief'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cancels a rename with Escape and ignores blank names', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<WorkspaceTab workspace={workspace()} index={0} isActive charLimit={80}
      onSelect={vi.fn()} onClose={vi.fn()} onRename={onRename} />);
    await user.dblClick(screen.getByText('brief'));
    await user.type(screen.getByRole('textbox'), 'cancelled{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'brief');
    await user.dblClick(screen.getByText('brief'));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'brief');
  });

  it('commits a rename on blur while a file is open', async () => {
    const user = userEvent.setup();
    const current = workspace();
    useWorkspaceStore.setState({ workspaces: [current] });
    render(<StoredWorkspaceTab id={current.id} />);
    await user.dblClick(screen.getByText('brief'));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Meeting notes');
    await user.tab();
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Meeting notes');
    await waitFor(() => expect(persistedWorkspaces.get(current.id)?.name).toBe('Meeting notes'));
  });

  it('closes a clean renamed tab without selecting it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(tab(workspace({ name: 'Launch notes' }), true, 80, onClose, onSelect));
    await user.click(screen.getByRole('button', { name: 'tabs.closeTab' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText('tabs.closeConfirm')).not.toBeInTheDocument();
  });

  it('anchors the close dialog to the dirty passive tab without selecting it', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(tab(workspace({ currentFile: { ...file('brief.md'), isDirty: true } }), false, 80, onClose, onSelect));
    vi.spyOn(screen.getByRole('tab'), 'getBoundingClientRect').mockReturnValue({
      left: 120, top: 40, bottom: 72, right: 260, width: 140, height: 32,
      x: 120, y: 40, toJSON: () => ({}),
    });
    fireEvent.click(screen.getByRole('button', { name: 'tabs.closeTab' }));
    const dialog = document.getElementById('confirm-dialog');
    expect(dialog).toHaveStyle({ left: '120px', top: '80px' });
    expect(dialog?.parentElement?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'confirm.cancel' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.getElementById('confirm-dialog')).not.toBeInTheDocument();
  });

  it('still confirms and saves before closing a dirty renamed tab', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const saveCurrentFile = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ saveCurrentFile });
    const current = workspace({ name: 'Launch notes', currentFile: { ...file('brief.md'), isDirty: true } });
    render(tab(current, true, 80, onClose));
    expect(screen.getByTitle('Unsaved changes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'tabs.closeTab' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('tabs.closeConfirm')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'confirm.cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'tabs.closeTab' }));
    await user.click(screen.getByRole('button', { name: 'confirm.save' }));
    expect(saveCurrentFile).toHaveBeenCalledWith(current.id);
    expect(onClose).toHaveBeenCalledOnce();
    expect(saveCurrentFile.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });
});
