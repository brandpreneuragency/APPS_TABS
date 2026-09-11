import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddNewClientButton } from './AddNewClientButton';

const createClient = vi.fn();
const showToast = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../stores/clientStore', () => ({
  useClientStore: (selector: (s: { createClient: typeof createClient; clients: { name: string }[] }) => unknown) =>
    selector({ createClient, clients: [{ name: 'Brandpreneur' }] }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { showToast: typeof showToast }) => unknown) =>
    selector({ showToast }),
}));

describe('AddNewClientButton', () => {
  beforeEach(() => {
    createClient.mockReset();
    showToast.mockReset();
    createClient.mockResolvedValue({ id: 'c1', name: 'Wagner Atelier' });
  });

  it('opens a name field under the add button and creates a client', async () => {
    const user = userEvent.setup();
    render(<AddNewClientButton />);

    await user.click(screen.getByRole('button', { name: 'tasks.addNewClient' }));
    const input = screen.getByRole('textbox', { name: 'tasks.clientNamePlaceholder' });
    await user.type(input, 'Wagner Atelier');
    await user.click(screen.getByRole('button', { name: 'tasks.addClient' }));

    expect(createClient).toHaveBeenCalledWith('Wagner Atelier');
    expect(showToast).toHaveBeenCalledWith('tasks.clientCreated:Wagner Atelier', 'info');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not create a duplicate client name', async () => {
    const user = userEvent.setup();
    render(<AddNewClientButton />);

    await user.click(screen.getByRole('button', { name: 'tasks.addNewClient' }));
    await user.type(screen.getByRole('textbox'), 'brandpreneur');
    await user.click(screen.getByRole('button', { name: 'tasks.addClient' }));

    expect(createClient).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('tasks.clientExists:brandpreneur', 'error');
  });
});
