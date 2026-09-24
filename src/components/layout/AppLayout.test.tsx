import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../../stores/uiStore';
import { AppLayout } from './AppLayout';

vi.mock('../../services/db', () => ({ db: { settings: { put: vi.fn().mockResolvedValue(undefined) } } }));
vi.mock('./LeftNarrowSidebar', () => ({ LeftNarrowSidebar: () => <nav /> }));
vi.mock('./NavigationResizeHandle', () => ({ NavigationResizeHandle: () => <div /> }));
vi.mock('../fileViewer/FileViewerPanel', () => ({ FileViewerPanel: () => null }));
vi.mock('../sidebar/RightPanelSubheader', () => ({ RightPanelSubheader: () => null }));
vi.mock('../terminal/TerminalPanel', () => ({ TerminalPanel: () => null }));
vi.mock('../settings/SettingsDocument', () => ({ SettingsDocument: () => null }));
vi.mock('./workspace', () => ({
  WorkspaceShell: ({ primary }: { primary: React.ReactNode }) => <div>{primary}</div>,
  PrimaryWorkspaceContent: () => <div />,
}));
vi.mock('../../stores/taskAssistantBinding', () => ({
  resolveTaskAssistantBinding: () => null,
}));
vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector: (state: { activeTaskId: null; selectedClientId: null; selectedProjectId: null }) => unknown) =>
    selector({ activeTaskId: null, selectedClientId: null, selectedProjectId: null }),
}));

beforeEach(() => useUIStore.setState(useUIStore.getInitialState()));
afterEach(cleanup);

describe('AppLayout navigation width', () => {
  const ui = {
    editor: <div />,
    sidebar: <div />,
    leftPanel: <div />,
    taskListPanel: <div />,
    modals: null,
  };

  it('publishes the open rail width so the titlebar can be pushed aside', () => {
    useUIStore.setState({ navigationWidth: 245, navigationCollapsed: false });
    const { container } = render(<AppLayout {...ui} />);
    const workspace = container.querySelector('.workspace');
    expect(workspace).toHaveAttribute('data-navigation-collapsed', 'false');
    expect((workspace as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe('245px');
  });

  it('collapses the rail track to zero without losing the stored width', () => {
    useUIStore.setState({ navigationWidth: 245, navigationCollapsed: true });
    const { container } = render(<AppLayout {...ui} />);
    const workspace = container.querySelector('.workspace');
    expect(workspace).toHaveAttribute('data-navigation-collapsed', 'true');
    expect((workspace as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe('0px');
    expect(useUIStore.getState().navigationWidth).toBe(245);
  });
});
