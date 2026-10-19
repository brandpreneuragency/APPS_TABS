import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readDir, rename } from '../../services/fs-adapter';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TreeDropZone } from './TreeDropZone';
import { FileExplorerPanel } from './FileExplorerPanel';

vi.mock('../../services/db', () => ({
  db: {
    settings: { get: vi.fn(), put: vi.fn().mockResolvedValue(undefined) },
    workspaces: { put: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('../../services/fs-adapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/fs-adapter')>(),
  isNativeFsAvailable: () => true,
  readDir: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function transfer(source: string, internal = true) {
  return {
    types: internal ? ['application/x-tabs-tree-node', 'text/plain'] : ['text/plain'],
    getData: (type: string) => type === 'text/plain' ? source : '',
    dropEffect: 'none',
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  vi.mocked(readDir).mockImplementation(async (path) => {
    if (path === 'C:/Root') return [
      { name: 'Projects', path: 'C:/Root/Projects', kind: 'directory' },
      { name: 'existing.md', path: 'C:/Root/existing.md', kind: 'file' },
    ];
    if (path === 'C:/Root/Projects') return [
      { name: 'notes.md', path: 'C:/Root/Projects/notes.md', kind: 'file' },
      { name: 'archive', path: 'C:/Root/Projects/archive', kind: 'directory' },
    ];
    return [];
  });
  useWorkspaceStore.setState({ defaultFolderPath: 'C:/Root' });
  const workspace = await useWorkspaceStore.getState().createWorkspace();
  await useWorkspaceStore.getState().ensureChildrenLoaded(workspace.id, 'C:/Root/Projects');
});

afterEach(cleanup);

it.each(['notes.md', 'archive'])('moves nested %s to root through the existing store', async (name) => {
  const { container } = render(<ul><TreeDropZone targetDirFullPath="C:/Root" depth={0} /></ul>);
  const gap = container.querySelector<HTMLElement>('[data-tree-drop-directory]')!;
  const dataTransfer = transfer(`C:/Root/Projects/${name}`);
  fireEvent.dragOver(gap, { dataTransfer });
  expect(gap).toHaveAttribute('data-active', 'true');
  expect(dataTransfer.dropEffect).toBe('move');
  await act(async () => { fireEvent.drop(gap, { dataTransfer }); });
  expect(rename).toHaveBeenCalledExactlyOnceWith(`C:/Root/Projects/${name}`, `C:/Root/${name}`);
  expect(gap).not.toHaveAttribute('data-active');
});

it.each([
  ['C:/Root/existing.md', 'C:/Root'],
  ['C:/Root/Projects', 'C:/Root/Projects'],
  ['C:/Root/Projects', 'C:/Root/Projects/archive'],
])('preserves the move guard for %s into %s', async (source, target) => {
  const { container } = render(<ul><TreeDropZone targetDirFullPath={target} depth={1} /></ul>);
  await act(async () => {
    fireEvent.drop(container.querySelector('[data-tree-drop-directory]')!, { dataTransfer: transfer(source) });
  });
  expect(rename).not.toHaveBeenCalled();
});

it('does not accept plain text as a file move', async () => {
  const { container } = render(<ul><TreeDropZone targetDirFullPath="C:/Root" depth={0} end /></ul>);
  const gap = container.querySelector('[data-tree-drop-directory]')!;
  const dataTransfer = transfer('C:/Root/Projects/notes.md', false);
  fireEvent.dragOver(gap, { dataTransfer });
  expect(gap).not.toHaveAttribute('data-active');
  await act(async () => { fireEvent.drop(gap, { dataTransfer }); });
  expect(rename).not.toHaveBeenCalled();
});

it.each(['dragend', 'drop', 'blur', 'dragleave'])('clears the line on %s', (event) => {
  const { container } = render(<ul><TreeDropZone targetDirFullPath="C:/Root" depth={0} /></ul>);
  const gap = container.querySelector('[data-tree-drop-directory]')!;
  fireEvent.dragOver(gap, { dataTransfer: transfer('C:/Root/Projects/notes.md') });
  expect(gap).toHaveAttribute('data-active', 'true');
  fireEvent(event === 'blur' ? window : event === 'dragleave' ? gap : document, new Event(event, { bubbles: true }));
  expect(gap).not.toHaveAttribute('data-active');
});

it('enables gaps during a real tree drag and moves to the rendered root gap', async () => {
  const store = useWorkspaceStore.getState();
  const projectNode = store.getActiveRootNode()!.children!.find((node) => node.name === 'Projects')!;
  store.setExpandedPaths(store.activeWorkspaceId!, [projectNode.path]);
  const { container } = render(<FileExplorerPanel />);
  const source = screen.getByText('notes.md').closest('li')!;
  const body = container.querySelector('.panel-body')!;
  const dataTransfer = { ...transfer('C:/Root/Projects/notes.md'), setData: vi.fn() };
  expect(body).not.toHaveClass('filetree-dragging');
  fireEvent.dragStart(source, { dataTransfer });
  expect(body).toHaveClass('filetree-dragging');
  const rootGap = container.querySelector('[data-tree-drop-directory="C:/Root"]')!;
  fireEvent.dragOver(rootGap, { dataTransfer });
  await act(async () => { fireEvent.drop(rootGap, { dataTransfer }); });
  expect(rename).toHaveBeenCalledExactlyOnceWith('C:/Root/Projects/notes.md', 'C:/Root/notes.md');
  expect(body).not.toHaveClass('filetree-dragging');
});

it('keeps directory center drops separate from gaps at the parent level', async () => {
  const { container } = render(<FileExplorerPanel />);
  const row = screen.getByText('Projects').closest('.row-xs')!;
  const dataTransfer = transfer('C:/Root/existing.md');
  fireEvent.dragOver(row, { dataTransfer });
  expect(container.querySelector('[data-active]')).toBeNull();
  await act(async () => { fireEvent.drop(row, { dataTransfer }); });
  expect(rename).toHaveBeenCalledExactlyOnceWith('C:/Root/existing.md', 'C:/Root/Projects/existing.md');
});
