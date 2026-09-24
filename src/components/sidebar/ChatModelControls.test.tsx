import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatModelControls } from './ChatModelControls';

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  hiddenByProvider: new Map<string, string[]>(),
  allHiddenProviders: new Set<string>(),
  codexHidden: [] as string[],
  codexAllHidden: false,
  hasConnectedFolder: false,
  session: undefined as { permissionProfile?: 'readOnly' | 'workspaceWrite' } | undefined,
}));

const mocks = vi.hoisted(() => ({
  put: vi.fn(async () => undefined),
  openSettings: vi.fn(),
  probe: vi.fn(async (providerId: string) => cliProbe(providerId)),
}));

function cliProbe(providerId: string) {
  const models = {
    grok: [
      { id: 'grok-4.7', displayName: 'Grok 4.7', isDefault: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
      { id: 'grok-hidden', displayName: 'Hidden Grok', isDefault: false, reasoningEfforts: [] },
    ],
    commandCode: [{ id: 'command-r', displayName: 'Command R', isDefault: true, reasoningEfforts: [] }],
    openCode: [{ id: 'open-code', displayName: 'OpenCode Large', isDefault: true, reasoningEfforts: [] }],
  } as const;
  return {
    providerId,
    installed: true,
    authState: 'authenticated' as const,
    models: models[providerId as keyof typeof models] ?? [],
  };
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('dexie', () => ({
  liveQuery: (query: () => Promise<unknown>) => ({
    subscribe: ({ next }: { next: (value: unknown) => void }) => {
      void query().then(next);
      return { unsubscribe: vi.fn() };
    },
  }),
}));

vi.mock('../../services/db', () => ({
  db: {
    settings: {
      get: async (key: string) => state.settings.has(key) ? { key, value: state.settings.get(key) } : undefined,
      put: mocks.put,
    },
    codexSessions: { get: async () => state.session },
  },
}));

vi.mock('../../services/runtime', () => ({ isTauriRuntime: () => true }));

vi.mock('../../services/providers/desktopClient', () => ({ probeCliProvider: mocks.probe }));

vi.mock('../../services/providers/modelVisibility', () => ({
  useProviderModelVisibility: (providerId: string) => ({
    allHidden: state.allHiddenProviders.has(providerId),
    hiddenModelIds: state.hiddenByProvider.get(providerId) ?? [],
  }),
  visibleProviderModels: <T extends { id: string }>(models: T[], visibility: { allHidden: boolean; hiddenModelIds: string[] }) =>
    visibility.allHidden ? [] : models.filter((model) => !visibility.hiddenModelIds.includes(model.id)),
}));

vi.mock('../../services/codex/useCodexService', () => ({
  useCodexService: () => ({
    connection: { version: '1.0.0' },
    activeRunId: undefined,
    models: [
      { id: 'astra', displayName: 'GPT-6 Astra', isDefault: true, reasoningEfforts: ['low', 'high'] },
      { id: 'sol', displayName: 'GPT-6 Sol', isDefault: false, reasoningEfforts: ['medium', 'high'] },
    ],
  }),
}));

vi.mock('../../services/codex/modelVisibility', () => ({
  useCodexModelVisibility: () => ({ allHidden: state.codexAllHidden, hiddenModelIds: state.codexHidden }),
  visibleCodexModels: <T extends { id: string }>(models: T[], visibility: { allHidden: boolean; hiddenModelIds: string[] }) =>
    visibility.allHidden ? [] : models.filter((model) => !visibility.hiddenModelIds.includes(model.id)),
}));

vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (store: { workspaces: Array<{ id: string; connectedFolders: Array<{ path: string }> }> }) => unknown) =>
    selector({ workspaces: [{ id: 'workspace-1', connectedFolders: state.hasConnectedFolder ? [{ path: 'C:/work' }] : [] }] }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (store: { openSettings: typeof mocks.openSettings }) => unknown) => selector({ openSettings: mocks.openSettings }),
}));

describe('ChatModelControls', () => {
  beforeEach(() => {
    state.settings = new Map([
      ['codexModelId', 'astra'],
      ['codexEffort', 'high'],
      ['providerModelId:grok', 'grok-4.7'],
    ]);
    state.hiddenByProvider = new Map([['grok', ['grok-hidden']]]);
    state.allHiddenProviders = new Set();
    state.codexHidden = [];
    state.codexAllHidden = false;
    state.hasConnectedFolder = false;
    state.session = undefined;
    mocks.put.mockClear();
    mocks.probe.mockReset();
    mocks.probe.mockImplementation(async (providerId: string) => cliProbe(providerId));
    mocks.openSettings.mockClear();
  });

  it('shows visible provider models in one searchable grouped picker and selects across providers', async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn(async () => undefined);
    render(<ChatModelControls providerId="codex" threadId="thread-1" workspaceId="workspace-1" onSelectModel={onSelectModel} />);

    await user.click(await screen.findByRole('button', { name: 'cliChat.model: Codex / GPT-6 Astra' }));
    const picker = screen.getByRole('group', { name: 'cliChat.model' });

    await waitFor(() => expect(mocks.probe).toHaveBeenCalledWith('grok'));
    expect(within(picker).getByText('Codex')).toBeInTheDocument();
    expect(within(picker).getByText('Grok')).toBeInTheDocument();
    expect(within(picker).getByText('Command Code')).toBeInTheDocument();
    expect(within(picker).getByText('OpenCode')).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: /GPT-6 Astra/i })).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).getByRole('button', { name: /Grok 4.7/i })).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: /Hidden Grok/i })).not.toBeInTheDocument();

    await user.click(within(picker).getByRole('button', { name: /Grok 4.7/i }));
    expect(onSelectModel).toHaveBeenCalledWith('grok', 'grok-4.7');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'cliChat.model' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /cliChat\.model:/i }));
    const search = within(screen.getByRole('group', { name: 'cliChat.model' })).getByRole('searchbox');
    await user.type(search, 'command');
    const filteredPicker = screen.getByRole('group', { name: 'cliChat.model' });
    await waitFor(() => expect(within(filteredPicker).getByRole('button', { name: /Command R/i })).toBeInTheDocument());
    expect(within(filteredPicker).queryByRole('button', { name: /GPT-6 Astra/i })).not.toBeInTheDocument();
  });

  it('persists a direct Codex reasoning effort without opening the options menu', async () => {
    const user = userEvent.setup();
    render(<ChatModelControls providerId="codex" threadId="thread-1" workspaceId="workspace-1" onSelectModel={async () => undefined} />);

    await user.click(await screen.findByRole('button', { name: 'codex.reasoning: high' }));
    const efforts = screen.getByRole('group', { name: 'codex.reasoning' });
    await user.click(within(efforts).getByRole('button', { name: /low/i }));

    expect(mocks.put).toHaveBeenCalledWith({ key: 'codexEffort', value: 'low' });
    expect(screen.queryByRole('group', { name: 'codex.reasoning' })).not.toBeInTheDocument();
  });

  it('shows Grok reasoning beside its model and saves the choice for that model', async () => {
    const user = userEvent.setup();
    render(<ChatModelControls providerId="grok" threadId="thread-1" workspaceId="workspace-1"
      onSelectModel={async () => undefined} />);

    await screen.findByRole('button', { name: 'cliChat.model: Grok / Grok 4.7' });
    await user.click(screen.getByRole('button', { name: 'codex.reasoning: codex.defaultEffort' }));
    const efforts = screen.getByRole('group', { name: 'codex.reasoning' });
    await user.click(within(efforts).getByRole('button', { name: 'xhigh' }));

    expect(mocks.put).toHaveBeenCalledWith({ key: 'providerReasoningEffort:grok:grok-4.7', value: 'xhigh' });
    expect(screen.getByRole('button', { name: 'codex.reasoning: xhigh' })).toBeInTheDocument();
  });

  it('keeps the reasoning control visible when a CLI reports no effort choices', async () => {
    const user = userEvent.setup();
    render(<ChatModelControls providerId="commandCode" threadId="thread-1" workspaceId="workspace-1"
      onSelectModel={async () => undefined} />);

    await screen.findByRole('button', { name: 'cliChat.model: Command Code / Command R' });
    await user.click(screen.getByRole('button', { name: 'codex.reasoning: codex.defaultEffort' }));
    const efforts = screen.getByRole('group', { name: 'codex.reasoning' });
    expect(within(efforts).getByText('cliChat.reasoningUnavailable')).toBeInTheDocument();
    expect(within(efforts).getAllByRole('button')).toHaveLength(1);
  });

  it('closes the picker with Escape and an outside pointer press', async () => {
    const user = userEvent.setup();
    render(<ChatModelControls providerId="codex" threadId="thread-1" workspaceId="workspace-1" onSelectModel={async () => undefined} />);

    const trigger = await screen.findByRole('button', { name: 'cliChat.model: Codex / GPT-6 Astra' });
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'cliChat.model' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'cliChat.model' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'cliChat.model' })).not.toBeInTheDocument());
  });

  it('locks model switching during a run and hides Codex settings in a legacy thread', async () => {
    const onSelectModel = vi.fn(async () => undefined);
    const { rerender } = render(<ChatModelControls providerId="codex" switchingLocked
      threadId="thread-1" workspaceId="workspace-1" onSelectModel={onSelectModel} />);

    expect(await screen.findByRole('button', { name: 'cliChat.model: Codex / GPT-6 Astra' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'codex.reasoning: high' })).toBeDisabled();

    rerender(<ChatModelControls providerId="codex" providerLocked
      threadId="thread-1" workspaceId="workspace-1" onSelectModel={onSelectModel} />);
    expect(screen.getByRole('button', { name: 'cliChat.model: Codex / GPT-6 Astra' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'codex.reasoning: high' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'codex.options' })).not.toBeInTheDocument();
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it('checks CLI catalogues one at a time when the picker opens', async () => {
    let finishGrok: (() => void) | undefined;
    const grokPending = new Promise<void>((resolve) => { finishGrok = resolve; });
    mocks.probe.mockImplementation(async (id: string) => {
      if (id === 'grok') await grokPending;
      return cliProbe(id);
    });
    const user = userEvent.setup();
    render(<ChatModelControls providerId="grok" threadId="thread-1" workspaceId="workspace-1"
      onSelectModel={async () => undefined} />);

    await user.click(screen.getByRole('button', { name: 'cliChat.model: Grok / cliChat.setup' }));
    expect(mocks.probe).toHaveBeenCalledWith('grok');
    expect(mocks.probe).not.toHaveBeenCalledWith('commandCode');
    finishGrok?.();
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledWith('commandCode'));
  });
});
