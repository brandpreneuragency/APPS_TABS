import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../services/db';
import type { CliProviderProbe } from '../../services/providers/desktopClient';
import { CliProviderSettings } from './CliProviderSettings';
import { cliProviderStatus } from './cliProviderStatus';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const probe: CliProviderProbe = {
  providerId: 'grok', installed: true, authState: 'authenticated', version: '1.0',
  models: [
    { id: 'grok-fast', displayName: 'Grok Fast', isDefault: true, reasoningEfforts: [] },
    { id: 'grok-precise', displayName: 'Grok Precise', isDefault: false, reasoningEfforts: [] },
  ],
};

afterEach(async () => {
  cleanup();
  await db.settings.bulkDelete(['grokModelVisibility', 'providerModelId:grok']);
});

describe('CLI provider settings', () => {
  it('reports install and authentication states without inferring sign-in from models', () => {
    expect(cliProviderStatus()).toBe('notChecked');
    expect(cliProviderStatus({ loading: true })).toBe('checking');
    expect(cliProviderStatus({ error: 'failed' })).toBe('checkFailed');
    expect(cliProviderStatus({ probe: { ...probe, installed: false } })).toBe('notInstalled');
    expect(cliProviderStatus({ probe: { ...probe, authState: 'notAuthenticated' } })).toBe('signInRequired');
    expect(cliProviderStatus({ probe: { ...probe, authState: 'unknown' } })).toBe('signInUnknown');
    expect(cliProviderStatus({ probe })).toBe('signedIn');
  });

  it('saves a provider-specific model and individual and all visibility', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {});
    const { rerender } = render(<CliProviderSettings providerId="grok" name="Grok" loginCommand="grok login"
      desktop state={{ probe }} onRefresh={refresh} />);

    expect(screen.queryByText('grok login')).not.toBeInTheDocument();
    expect(screen.getAllByText('cliProviders.status.signedIn').length).toBeGreaterThan(0);
    rerender(<CliProviderSettings providerId="grok" name="Grok" loginCommand="grok login"
      desktop state={{ probe: { ...probe, authState: 'notAuthenticated' } }} onRefresh={refresh} />);
    expect(screen.getByText('grok login')).toBeInTheDocument();
    rerender(<CliProviderSettings providerId="grok" name="Grok" loginCommand="grok login"
      desktop state={{ probe }} onRefresh={refresh} />);

    const defaultModel = await screen.findByLabelText('codex.defaultModel');
    await user.selectOptions(defaultModel, 'grok-precise');
    await waitFor(async () => {
      expect((await db.settings.get('providerModelId:grok'))?.value).toBe('grok-precise');
    });

    const modelSwitches = screen.getAllByRole('switch');
    await waitFor(() => expect(modelSwitches[0]).toBeEnabled());
    await user.click(modelSwitches[0]);
    await waitFor(async () => {
      expect((await db.settings.get('grokModelVisibility'))?.value).toEqual({
        allHidden: false, hiddenModelIds: ['grok-fast'],
      });
    });

    await user.click(screen.getByRole('checkbox', { name: 'codex.showAllModels' }));
    await waitFor(async () => {
      expect((await db.settings.get('grokModelVisibility'))?.value).toEqual({
        allHidden: false, hiddenModelIds: [],
      });
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the browser preview read-only and does not claim authentication', () => {
    const refresh = vi.fn(async () => {});
    render(<CliProviderSettings providerId="grok" name="Grok" loginCommand="grok login"
      desktop={false} onRefresh={refresh} />);
    expect(screen.getByText('cliProviders.desktopOnly')).toBeInTheDocument();
    expect(screen.queryByText('grok login')).not.toBeInTheDocument();
    expect(screen.queryByText('cliProviders.status.signedIn')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
