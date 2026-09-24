import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsSection } from './ToolsSection';

const mocks = vi.hoisted(() => ({
  native: true,
  probe: vi.fn(async (providerId: string) => ({
    providerId, installed: true, authState: 'notAuthenticated', models: [],
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../services/runtime', () => ({ isTauriRuntime: () => mocks.native }));
vi.mock('../../services/providers/desktopClient', () => ({ probeCliProvider: mocks.probe }));
vi.mock('../../services/providers/modelVisibility', () => ({
  useProviderModelVisibility: () => ({ allHidden: false, hiddenModelIds: [] }),
  visibleProviderModels: <T,>(models: T[]) => models,
}));
vi.mock('../../services/codex/useCodexService', () => ({
  useCodexService: () => ({ connection: null, models: [] }),
}));
vi.mock('./CodexSettings', () => ({ CodexSettings: () => <div>Codex details</div> }));
vi.mock('./CliProviderSettings', () => ({ CliProviderSettings: ({ name }: { name: string }) => <div>{name} details</div> }));
vi.mock('./SettingsPanels', () => ({
  SettingsPanels: ({ leftMain, centerMain }: { leftMain: ReactNode; centerMain: ReactNode }) =>
    <div>{leftMain}{centerMain}</div>,
}));

beforeEach(() => {
  mocks.native = true;
  mocks.probe.mockClear();
});

describe('Tools provider navigation', () => {
  it('checks each new CLI only when selected and keeps the reported sign-in state', async () => {
    const user = userEvent.setup();
    render(<ToolsSection />);
    expect(mocks.probe).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Grok/ }));
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledWith('grok'));
    expect(await screen.findByText('Grok details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Grok/ })).toHaveTextContent('cliProviders.status.signInRequired');

    await user.click(screen.getByRole('button', { name: /Command Code/ }));
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledWith('commandCode'));
    await user.click(screen.getByRole('button', { name: /OpenCode/ }));
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledWith('openCode'));
    expect(mocks.probe).toHaveBeenCalledTimes(3);
  });

  it('does not probe CLIs in the browser preview', async () => {
    mocks.native = false;
    const user = userEvent.setup();
    render(<ToolsSection />);
    await user.click(screen.getByRole('button', { name: /Grok/ }));
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Grok/ })).toHaveTextContent('cliProviders.status.desktopOnly');
  });
});
