import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanelSubheader } from './RightPanelSubheader';

const { setActiveAgent, agents } = vi.hoisted(() => ({
  setActiveAgent: vi.fn(),
  agents: [
    { id: 'former-writer', name: 'Writing assistant', avatarUrl: '', systemPrompt: '', isDefault: false },
    { id: 'former-task', name: 'Planning assistant', avatarUrl: '', systemPrompt: '', isDefault: false },
  ],
}));

vi.mock('../../stores/aiStore', () => ({
  useAIStore: () => ({ agents, getActiveAgent: () => agents[0], setActiveAgent }),
}));
vi.mock('../../stores/chatStore', () => ({
  useChatStore: () => ({ threads: [], newChat: vi.fn(), selectThread: vi.fn(), deleteThread: vi.fn() }),
}));
vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({ taskMode: false, activeTaskId: null, contextWindowOpen: false, setContextWindowOpen: vi.fn() }),
}));
vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: () => ({ activeWorkspaceId: null }),
}));
vi.mock('../contextWindow', () => ({
  ContextWindowPanel: () => null,
  ContextWindowSummaryTooltip: () => null,
  ContextWindowRing: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key === 'sidebar.manageAgents' ? '+ Manage Agents' : key }),
}));

beforeEach(() => vi.clearAllMocks());

describe('shared agent picker', () => {
  it.each(['writer', 'task'] as const)('offers every agent in %s chats', (mode) => {
    render(<RightPanelSubheader mode={mode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Writing assistant' }));
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
    expect(screen.getByRole('menuitemradio', { name: 'Writing assistant' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitem', { name: '+ Manage Agents' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Planning assistant' }));
    expect(setActiveAgent).toHaveBeenCalledWith('former-task');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

