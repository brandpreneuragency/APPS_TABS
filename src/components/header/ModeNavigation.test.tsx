import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { ModeNavigation } from './ModeNavigation';

vi.mock('../../services/db', () => ({
  db: { settings: { put: vi.fn().mockResolvedValue(undefined) } },
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../stores/crmStore', () => ({ useCrmStore: { getState: () => ({ setLeadsCenterView: vi.fn() }) } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState());
  useTaskStore.setState(useTaskStore.getInitialState());
});
afterEach(cleanup);

describe('ModeNavigation', () => {
  it('keeps all controls visible in the requested order across view changes', () => {
    render(<ModeNavigation />);
    const expected = ['left-navbar', 'settings', 'terminal', 'documents', 'github', 'tasks', 'calendar', 'projects', 'clients'];
    for (const name of ['navigation.calendar', 'navigation.projects', 'navigation.taskList', 'navigation.docs', 'navigation.github', 'navigation.clients']) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.getAllByRole('button').map((button) => button.id)).toEqual(expected.map((id) => `nav-btn-${id}`));
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
      expect(document.querySelectorAll('.header-mode[aria-pressed="true"]')).toHaveLength(1);
    }
    expect(useUIStore.getState().githubMode).toBe(false);
  });

  it('enters GitHub as a separate workspace and keeps the other mode flags off', () => {
    useUIStore.setState({ taskMode: true, crmMode: false, activeView: 'document' });
    render(<ModeNavigation />);

    fireEvent.click(screen.getByRole('button', { name: 'navigation.github' }));

    expect(useUIStore.getState()).toMatchObject({ githubMode: true, taskMode: false, crmMode: false });
    expect(screen.getByRole('button', { name: 'navigation.github' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.header-mode[aria-pressed="true"]')).toHaveLength(1);
  });

  it('enters Clients without changing the selected client and clears project scope', () => {
    useTaskStore.setState({ selectedClientId: 'client-a', selectedProjectId: 'project-a' });
    useUIStore.setState({ activeCRMPage: 'projects', crmMode: true });
    render(<ModeNavigation />);

    fireEvent.click(screen.getByRole('button', { name: 'navigation.clients' }));

    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'client-a', selectedProjectId: null });
    expect(useUIStore.getState()).toMatchObject({
      activeCRMPage: 'clients', crmMode: true, contextPanelOpenByMode: { ...useUIStore.getState().contextPanelOpenByMode, crm: true },
    });
    expect(document.querySelectorAll('.header-mode[aria-pressed="true"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'navigation.docs' }));
    expect(useUIStore.getState().crmMode).toBe(false);
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'client-a', selectedProjectId: null });
  });

  it('toggles the left navbar while preserving its resized width', () => {
    useUIStore.setState({ navigationWidth: 245, navigationCollapsed: false });
    render(<ModeNavigation />);

    const toggle = screen.getByRole('button', { name: 'navigation.collapseNavbar' });
    fireEvent.click(toggle);
    expect(useUIStore.getState().navigationCollapsed).toBe(true);
    expect(useUIStore.getState().navigationWidth).toBe(245);

    fireEvent.click(screen.getByRole('button', { name: 'navigation.openNavbar' }));
    expect(useUIStore.getState().navigationCollapsed).toBe(false);
    expect(useUIStore.getState().navigationWidth).toBe(245);
  });

  it('opens the exact page when moving between workspaces', () => {
    render(<ModeNavigation />);
    for (const [name, mode, page] of [
      ['navigation.calendar', 'tasks', 'calendar'],
      ['navigation.projects', 'crm', 'projects'],
      ['navigation.taskList', 'tasks', 'list'],
      ['navigation.clients', 'crm', 'clients'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
      const state = useUIStore.getState();
      expect(state.taskMode).toBe(mode === 'tasks');
      expect(state.crmMode).toBe(mode === 'crm');
      expect(mode === 'tasks' ? state.activeTaskPage : state.activeCRMPage).toBe(page);
    }
  });
});
