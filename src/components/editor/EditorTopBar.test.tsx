import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { EditorTopBar } from './EditorTopBar';

afterEach(cleanup);

function setup() {
  render(<I18nextProvider i18n={i18n}><EditorTopBar editor={null} onSave={vi.fn()} /></I18nextProvider>);
  return screen.getByRole('button', { name: 'More' });
}

describe('Editor overflow menu', () => {
  it('hides actions until opened and preserves disabled history actions', () => {
    const trigger = setup();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toBeDisabled();
    expect(screen.getByRole('menuitemcheckbox')).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Find & Replace' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('toggles rainbow and dismisses on outside click', () => {
    const trigger = setup();
    const before = useUIStore.getState().rainbowMode;
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemcheckbox'));
    expect(useUIStore.getState().rainbowMode).toBe(!before);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    useUIStore.setState({ rainbowMode: before });
  });

  it('opens find independently of the dismissed menu', async () => {
    fireEvent.click(setup());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find & Replace' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(screen.getByPlaceholderText('Find')).toHaveFocus());
    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'example' } });
    expect(screen.getByPlaceholderText('Find')).toHaveValue('example');
  });
});
