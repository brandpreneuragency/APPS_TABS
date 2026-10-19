import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore, type TreeNode as TreeNodeType } from '../../stores/workspaceStore';
import { TreeNode } from './TreeNode';

vi.mock('../../services/db', () => ({
  db: {
    settings: { get: vi.fn(), put: vi.fn().mockResolvedValue(undefined) },
    workspaces: { put: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const folder: TreeNodeType = {
  name: 'Projects', path: 'Projects', fullPath: 'C:/Projects', kind: 'directory',
  children: [{
    name: 'archive', path: 'Projects/archive', fullPath: 'C:/Projects/archive', kind: 'directory',
    children: [{
      name: 'notes.md', path: 'Projects/archive/notes.md', fullPath: 'C:/Projects/archive/notes.md', kind: 'file',
    }],
  }],
};

beforeEach(async () => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  const workspace = await useWorkspaceStore.getState().createWorkspace();
  useWorkspaceStore.getState().updateWorkspace(workspace.id, {
    expandedPaths: ['Projects', 'Projects/archive'], selectedTreePath: 'Projects',
  });
});
afterEach(cleanup);

it('highlights the selected folder container including all visible descendants', () => {
  render(<ul><TreeNode node={folder} depth={0} /></ul>);
  const selectedFolder = screen.getByText('Projects').closest('li')!;
  const nestedFolder = screen.getByText('archive').closest('li')!;
  const nestedFile = screen.getByText('notes.md').closest('li')!;

  expect(selectedFolder).toHaveStyle({ backgroundColor: 'var(--c-background-1)' });
  expect(selectedFolder).toContainElement(nestedFile);
  expect(nestedFolder.style.backgroundColor).toBe('transparent');
  expect(nestedFile.style.backgroundColor).toBe('transparent');
  expect(screen.getByText('Projects')).toHaveStyle({ color: 'var(--c-text-1)' });
  expect(screen.getByText('archive')).toHaveStyle({ color: 'var(--c-text-3)' });
  expect(screen.getByText('notes.md')).toHaveStyle({ color: 'var(--c-text-3)' });

  act(() => {
    const store = useWorkspaceStore.getState();
    store.setSelectedTreePath(store.activeWorkspaceId!, 'Projects/archive');
  });
  expect(selectedFolder.style.backgroundColor).toBe('transparent');
  expect(nestedFolder).toHaveStyle({ backgroundColor: 'var(--c-background-1)' });
  expect(screen.getByText('Projects')).toHaveStyle({ color: 'var(--c-text-3)' });
  expect(screen.getByText('archive')).toHaveStyle({ color: 'var(--c-text-1)' });
  expect(screen.getByText('notes.md')).toHaveStyle({ color: 'var(--c-text-3)' });

  act(() => {
    const store = useWorkspaceStore.getState();
    store.setSelectedTreePath(store.activeWorkspaceId!, 'Projects/archive/notes.md');
  });
  expect(nestedFolder.style.backgroundColor).toBe('transparent');
  expect(nestedFile).toHaveStyle({ backgroundColor: 'var(--c-background-1)' });
  expect(screen.getByText('Projects')).toHaveStyle({ color: 'var(--c-text-3)' });
  expect(screen.getByText('archive')).toHaveStyle({ color: 'var(--c-text-3)' });
  expect(screen.getByText('notes.md')).toHaveStyle({ color: 'var(--c-text-1)' });
});

it('keeps the selected folder highlighted when collapsed and expanded again', () => {
  render(<ul><TreeNode node={folder} depth={0} /></ul>);
  fireEvent.click(screen.getByText('Projects'));
  expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
  expect(screen.getByText('Projects').closest('li')).toHaveStyle({ backgroundColor: 'var(--c-background-1)' });

  fireEvent.click(screen.getByText('Projects'));
  expect(screen.getByText('Projects').closest('li')).toContainElement(screen.getByText('notes.md'));
  expect(screen.getByText('Projects').closest('li')).toHaveStyle({ backgroundColor: 'var(--c-background-1)' });
});
