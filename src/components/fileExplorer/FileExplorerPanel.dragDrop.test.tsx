import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readDir, rename } from '../../services/fs-adapter';
import { useWorkspaceStore } from '../../stores/workspaceStore';
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

beforeEach(async () => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  vi.mocked(readDir).mockImplementation(async (path) => {
    if (path === 'C:/Root') return [
      { name: 'Projects', path: 'C:/Root/Projects', kind: 'directory' },
      { name: 'Other', path: 'C:/Root/Other', kind: 'directory' },
    ];
    if (path === 'C:/Root/Projects') return [
      { name: 'notes.md', path: 'C:/Root/Projects/notes.md', kind: 'file' },
    ];
    return [];
  });
  useWorkspaceStore.setState({ defaultFolderPath: 'C:/Root' });
  const workspace = await useWorkspaceStore.getState().createWorkspace();
  await useWorkspaceStore.getState().ensureChildrenLoaded(workspace.id, 'C:/Root/Projects');
  useWorkspaceStore.getState().setExpandedPaths(workspace.id, ['Root/Projects']);
});
afterEach(cleanup);

function startDrag() {
  const values = new Map<string, string>();
  const dataTransfer = {
    types: ['application/x-tabs-tree-node', 'text/plain'],
    setData: (type: string, value: string) => { values.set(type, value); },
    getData: (type: string) => values.get(type) ?? '',
    effectAllowed: 'none', dropEffect: 'none',
  };
  fireEvent.dragStart(screen.getByText('notes.md').closest('[data-tree-node]')!, { dataTransfer });
  return dataTransfer;
}

it('moves from an expanded folder to a root gap through the complete explorer', async () => {
  const { container } = render(<FileExplorerPanel />);
  const dataTransfer = startDrag();
  expect(container.querySelector('.panel-body')).toHaveClass('filetree-dragging');
  const gap = container.querySelector('#filetree-list > .tree-drop-zone > [data-tree-drop-directory="C:/Root"]')!;
  fireEvent.dragOver(gap, { dataTransfer });
  expect(gap).toHaveAttribute('data-active', 'true');
  await act(async () => { fireEvent.drop(gap, { dataTransfer }); });
  expect(rename).toHaveBeenCalledExactlyOnceWith('C:/Root/Projects/notes.md', 'C:/Root/notes.md');
  expect(container.querySelector('.panel-body')).not.toHaveClass('filetree-dragging');
  expect(gap).not.toHaveAttribute('data-active');
});

it('keeps directory rows as inside targets', async () => {
  render(<FileExplorerPanel />);
  const dataTransfer = startDrag();
  const directory = screen.getByText('Other').closest('.row-xs')!;
  fireEvent.dragOver(directory, { dataTransfer });
  await act(async () => { fireEvent.drop(directory, { dataTransfer }); });
  expect(rename).toHaveBeenCalledExactlyOnceWith('C:/Root/Projects/notes.md', 'C:/Root/Other/notes.md');
});

it('disables all gap hit areas when a drag is cancelled', () => {
  const { container } = render(<FileExplorerPanel />);
  const dataTransfer = startDrag();
  fireEvent.dragEnd(document, { dataTransfer });
  expect(container.querySelector('.panel-body')).not.toHaveClass('filetree-dragging');
});
