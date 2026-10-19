import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { AppearanceSection } from './AppearanceSection';

vi.mock('./SettingsPanels', () => ({
  SettingsPanels: ({ leftMain, centerMain }: { leftMain: ReactNode; centerMain: ReactNode }) => <>{leftMain}{centerMain}</>,
}));

beforeEach(async () => {
  useUIStore.setState(useUIStore.getInitialState());
  await i18n.changeLanguage('en');
});

describe('Appearance settings without token overrides', () => {
  it('keeps named themes, text size, fonts, language and folder settings without token editors', () => {
    const { container } = render(<AppearanceSection />);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveClass('ui-input');
    expect(screen.getByRole('button', { name: /Text size.*\+/i })).toHaveClass('ui-icon-button');
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TR' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /font family/i }));
    expect(screen.getByRole('button', { name: 'Times New Roman' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Courier New' })).toBeInTheDocument();
    expect(container.querySelector('.settings-folder-controls')).not.toBeNull();
    expect(container.querySelector('input[type="color"]')).toBeNull();
    expect(screen.queryByText(/token overrides/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spacing' })).not.toBeInTheDocument();
  });
});
