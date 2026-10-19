import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../services/db';
import i18n from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { ThemePicker } from './ThemePicker';

beforeEach(async () => {
  await db.settings.clear();
  useUIStore.setState(useUIStore.getInitialState());
  document.documentElement.removeAttribute('data-theme');
  await i18n.changeLanguage('en');
});

describe('ThemePicker', () => {
  it('selects and saves the optional theme through the actual control', async () => {
    render(<ThemePicker />);
    const picker = screen.getByRole('combobox', { name: 'Theme' });
    expect(picker).toHaveValue('default');
    fireEvent.change(picker, { target: { value: 'purple-neon' } });
    await waitFor(() => expect(picker).toHaveValue('purple-neon'));
    expect((await db.settings.get('theme'))?.value).toBe('purple-neon');
    expect(document.documentElement.dataset.theme).toBe('purple-neon');
    fireEvent.change(picker, { target: { value: 'default' } });
    await waitFor(() => expect(picker).toHaveValue('default'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('localizes the control in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    render(<ThemePicker />);
    expect(screen.getByRole('combobox', { name: 'Tema' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Mor Neon' })).toHaveValue('purple-neon');
  });

  it('shows persistence failure and keeps the previous theme', async () => {
    render(<ThemePicker />);
    const put = vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('storage unavailable'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'purple-neon' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the theme');
    expect(screen.getByRole('combobox')).toHaveValue('default');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    put.mockRestore();
  });
});
