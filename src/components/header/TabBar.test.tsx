import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TabBar } from './TabBar';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
});

describe('document tab labels', () => {
  it('numbers empty and default tabs while preserving custom names', () => {
    const workspaces = ['', '   ', 'Workspace 7', 'Notes', '__BROWSER_ROOT__:Projects'].map((name, index) => ({
      id: String(index), name, connectedFolders: [], activeFolderId: null,
      currentFile: null, expandedPaths: [], selectedTreePath: null,
      createdAt: 0, updatedAt: 0, order: index,
    }));
    useWorkspaceStore.setState({ workspaces, activeWorkspaceId: '0' });
    render(<TabBar />);
    expect(screen.getAllByRole('tab').map((tab) => tab.title)).toEqual([
      'Doc 1', 'Doc 2', 'Doc 3', 'Notes', 'Projects',
    ]);
    for (const label of ['Doc 1', 'Doc 2', 'Doc 3']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(useWorkspaceStore.getState().workspaces).toEqual(workspaces);
  });
});
