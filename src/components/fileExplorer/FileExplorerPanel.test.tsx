import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readDir } from '../../services/fs-adapter';
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
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./TreeNode', () => ({ TreeNode: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
});
afterEach(cleanup);

it('shows and filters partial results while a later folder is still loading', async () => {
  let finishSlowRead!: (entries: Awaited<ReturnType<typeof readDir>>) => void;
  const slowRead = new Promise<Awaited<ReturnType<typeof readDir>>>((resolve) => { finishSlowRead = resolve; });
  vi.mocked(readDir).mockImplementation(async (path) => {
    if (path === 'C:/Search') return [
      { name: 'notes.md', path: 'C:/Search/notes.md', kind: 'file' },
      { name: 'a', path: 'C:/Search/a', kind: 'directory' },
      { name: 'b', path: 'C:/Search/b', kind: 'directory' },
    ];
    if (path === 'C:/Search/a') return [{ name: 'nested.md', path: 'C:/Search/a/nested.md', kind: 'file' }];
    return slowRead;
  });
  useWorkspaceStore.setState({ defaultFolderPath: 'C:/Search' });
  await useWorkspaceStore.getState().createWorkspace();
  render(<FileExplorerPanel />);
  fireEvent.click(screen.getAllByRole('button', { name: 'explorer.searchFiles' })[0]);
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: '.md' } });
  expect(screen.getByRole('option', { name: 'notes.md' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('option', { name: 'nested.md' })).toBeInTheDocument());
  expect(screen.queryByText('explorer.searchLoading')).not.toBeInTheDocument();
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
  fireEvent.change(input, { target: { value: 'nested' } });
  expect(screen.queryByRole('option', { name: 'notes.md' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'nested.md' })).toBeInTheDocument();
  await act(async () => { finishSlowRead([]); });
  await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false'));
  expect(vi.mocked(readDir).mock.calls.filter(([path]) => path === 'C:/Search/b')).toHaveLength(1);
});

it('stops scheduling folder reads when the search is cleared', async () => {
  let finishRead!: (entries: Awaited<ReturnType<typeof readDir>>) => void;
  const pendingRead = new Promise<Awaited<ReturnType<typeof readDir>>>((resolve) => { finishRead = resolve; });
  vi.mocked(readDir).mockImplementation(async (path) => {
    if (path === 'C:/Cancel') return [
      { name: 'a', path: 'C:/Cancel/a', kind: 'directory' },
      { name: 'b', path: 'C:/Cancel/b', kind: 'directory' },
    ];
    return pendingRead;
  });
  useWorkspaceStore.setState({ defaultFolderPath: 'C:/Cancel' });
  await useWorkspaceStore.getState().createWorkspace();
  render(<FileExplorerPanel />);
  fireEvent.click(screen.getAllByRole('button', { name: 'explorer.searchFiles' })[0]);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  await waitFor(() => expect(readDir).toHaveBeenCalledWith('C:/Cancel/a'));
  expect(screen.queryByText('explorer.noSearchMatches')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await act(async () => { finishRead([]); });
  expect(readDir).not.toHaveBeenCalledWith('C:/Cancel/b');
  expect(screen.queryByText('explorer.searchLoading')).not.toBeInTheDocument();
});

it('groups header actions and focuses, toggles, and dismisses the search dropdown', async () => {
  vi.mocked(readDir).mockResolvedValue([]);
  useWorkspaceStore.setState({ defaultFolderPath: 'C:/Search' });
  await useWorkspaceStore.getState().createWorkspace();
  const { container } = render(<FileExplorerPanel />);
  const toolbar = container.querySelector<HTMLElement>('.panel-header')!;
  const controls = within(toolbar);
  const searchButton = controls.getByRole('button', { name: 'explorer.searchFiles' });
  expect(controls.getByText('C:/Search')).toBeInTheDocument();
  expect(controls.getByRole('button', { name: 'explorer.changeFolder' })).toBeInTheDocument();
  expect(controls.getByRole('button', { name: 'explorer.newFile' })).toBeInTheDocument();
  expect(controls.getByRole('button', { name: 'explorer.newFolder' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'explorer.searchFiles' })).toHaveLength(1);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(searchButton);
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(searchButton).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(searchButton).toHaveFocus();
  fireEvent.click(searchButton);
  fireEvent.mouseDown(document.body);
  expect(searchButton).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(searchButton);
  fireEvent.click(searchButton);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});

it('reopens search without losing the query or duplicating IDs', async () => {
  vi.mocked(readDir).mockResolvedValue([]);
  useWorkspaceStore.setState({ defaultFolderPath: 'C:/Search' });
  await useWorkspaceStore.getState().createWorkspace();
  const { container } = render(<FileExplorerPanel />);
  const searchButton = screen.getByRole('button', { name: 'explorer.searchFiles' });
  fireEvent.click(searchButton);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'notes' } });
  fireEvent.click(searchButton);
  expect(searchButton).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(searchButton);
  expect(screen.getByRole('searchbox')).toHaveValue('notes');
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(searchButton).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('search')).toHaveAttribute('id', searchButton.getAttribute('aria-controls'));
  const ids = Array.from(container.querySelectorAll('[id]'), (element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  await act(async () => {});
});
