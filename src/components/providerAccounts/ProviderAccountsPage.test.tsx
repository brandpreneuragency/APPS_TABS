import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderAccountsPage } from './ProviderAccountsPage';
import { createProviderAccountsStore } from '../../services/providerAccounts/store';
import type { ProviderAccount, ProviderAccountsClient } from '../../services/providerAccounts/types';

vi.mock('../../services/runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('../layout/workspace/AssistantToggle', () => ({ AssistantToggle: () => null }));
vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}`,
  i18n: { language: 'en' },
}) }));
afterEach(cleanup);

const account: ProviderAccount = {
  id: 'codex-1', providerId: 'openai-codex', label: 'Codex 1', status: 'connected', duplicateOf: null,
  identity: { key: 'synthetic-a', email: 'synthetic@example.invalid', workspaceId: 'workspace-a', plan: 'pro' },
  lastAttemptAt: 1000, lastSuccessAt: 1000, error: null,
  usage: { windows: [{ id: 'fiveHour', windowMinutes: 300, usedPercent: 20, resetsAt: 5000 }], resetTokens: 3 },
};
function fixture(row = account) {
  const api: ProviderAccountsClient = {
    list: vi.fn().mockResolvedValue([row]), refresh: vi.fn().mockResolvedValue([row]),
    connections: vi.fn().mockResolvedValue([{ id: 'hermes-mother', providerId: 'openai-codex',
      identity: row.identity, evidence: 'configured', observedAt: 1000, error: null }]),
    beginLogin: vi.fn(), openLogin: vi.fn(), pollLogin: vi.fn(), cancelLogin: vi.fn(),
  };
  return { api, store: createProviderAccountsStore(api) };
}

describe('provider accounts dashboard', () => {
  it('shows partial limits without inventing a weekly balance or runtime account confirmation', async () => {
    const { api, store } = fixture(); render(<ProviderAccountsPage store={store} />);
    await screen.findByRole('article', { name: 'Codex 1' });
    expect(screen.getByText('providerAccounts.remaining 80')).toBeInTheDocument();
    expect(screen.getAllByText('providerAccounts.unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/providerAccounts\.evidence\.configured/)).toHaveLength(2);
    expect(screen.queryByText('providerAccounts.evidence.runtime')).not.toBeInTheDocument();
    expect(api.beginLogin).not.toHaveBeenCalled();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByText('providerAccounts.resetAwaitingRefresh')).toBeInTheDocument();
  });

  it('does not render a duplicate account as another quota pool', async () => {
    const { store } = fixture({ ...account, status: 'duplicate', duplicateOf: 'codex-2' });
    render(<ProviderAccountsPage store={store} />);
    await screen.findByText('providerAccounts.duplicate codex-2');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('retains the dashboard and honest error state when native loading fails', async () => {
    const { api, store } = fixture(); vi.mocked(api.list).mockRejectedValue(new Error('fixture unavailable'));
    render(<ProviderAccountsPage store={store} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('providerAccounts.errors.loadFailed'));
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
