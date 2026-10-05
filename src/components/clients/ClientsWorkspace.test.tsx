import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsCategoryPanel } from './ClientsCategoryPanel';
import { ClientsWorkspace } from './ClientsWorkspace';
import { LeftNarrowSidebar } from '../layout/LeftNarrowSidebar';
import { useClientStore } from '../../stores/clientStore';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { Client } from '../../types';
import { createRecordsFixture, cleanupRecordsFixtures } from '../../services/clients/recordsTestFixtures';
import type { RecordsFixture } from '../../services/clients/recordsTestFixtures';

vi.mock('../../services/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/db')>(),
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../taskManager/AddNewClientButton', () => ({ AddNewClientButton: () => <button type="button">Add brand</button> }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const brand: Client = { id: 'client-a', name: 'Northwind', color: '#123456', createdAt: 1, order: 0 };
const general: Client = { id: 'general', name: 'General', color: '#654321', createdAt: 1, order: 1 };
const secondBrand: Client = { id: 'client-b', name: 'Southridge', color: '#345678', createdAt: 1, order: 2 };
let fixture: RecordsFixture;

beforeEach(async () => {
  fixture = await createRecordsFixture();
  await fixture.database.clients.put(general);
  useUIStore.setState({ ...useUIStore.getInitialState(), crmMode: true, activeCRMPage: 'clients' });
  useTaskStore.setState({ ...useTaskStore.getInitialState(), selectedClientId: brand.id, selectedProjectId: 'project-a' });
  useClientStore.setState({ clients: [brand, general, secondBrand], isLoaded: true });
  useProjectStore.setState(useProjectStore.getInitialState());
  useClientDetailsStore.setState({ category: 'overview', drafts: {}, saveStates: {} });
});
afterEach(async () => {
  cleanup();
  await cleanupRecordsFixtures();
});

function renderWorkspace() {
  return render(<><ClientsCategoryPanel /><ClientsWorkspace database={fixture.database} records={fixture.records} /></>);
}

describe('Clients workspace scope navigation', () => {
  it('shows Everything and No Client without CRM More, and selects both real scopes', () => {
    useClientDetailsStore.getState().setCategory('notes');
    render(<LeftNarrowSidebar />);

    const everything = screen.getByRole('tab', { name: 'navigation.everything' });
    const noClient = screen.getByRole('tab', { name: 'clients.noClientScope' });
    expect(everything).toBeInTheDocument();
    expect(noClient).toBeInTheDocument();
    expect(screen.queryByText('navigation.more')).not.toBeInTheDocument();

    fireEvent.click(everything);
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: null, selectedProjectId: null });
    expect(useClientDetailsStore.getState().category).toBe('notes');
    fireEvent.keyDown(everything, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(noClient);
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: general.id, selectedProjectId: null });
    expect(useClientDetailsStore.getState().category).toBe('notes');
    fireEvent.click(screen.getByRole('tab', { name: secondBrand.name }));
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: secondBrand.id, selectedProjectId: null });
    expect(useClientDetailsStore.getState().category).toBe('notes');
    expect(useClientStore.getState().clients).toEqual([brand, general, secondBrand]);
  });

  it('keeps scope and More-menu behavior on Projects', () => {
    const { rerender } = render(<LeftNarrowSidebar />);
    act(() => useUIStore.setState({ activeCRMPage: 'projects' }));
    rerender(<LeftNarrowSidebar />);

    expect(screen.getByRole('tab', { name: 'navigation.everything' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'navigation.noClient' })).toBeInTheDocument();
    expect(screen.getByText('navigation.more')).toBeInTheDocument();
  });

  it('shows three category tabs with live-brand identity and shell keyboard behavior', async () => {
    renderWorkspace();

    const tabs = screen.getAllByRole('tab');
    const overview = screen.getByRole('tab', { name: 'clients.overview' });
    const profile = screen.getByRole('tab', { name: 'clients.profile' });
    const notes = screen.getByRole('tab', { name: 'clients.notes' });
    expect(tabs).toHaveLength(3);
    expect(profile).not.toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Northwind' })).toBeInTheDocument();

    fireEvent.keyDown(overview, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(profile);
    expect(useClientDetailsStore.getState().category).toBe('profile');
    fireEvent.keyDown(profile, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(notes);
    expect(useClientDetailsStore.getState().category).toBe('notes');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('clients.noNotesForClient'));
  });

  it('disables Profile without a live brand while Everything Notes remains aggregate-only', async () => {
    useTaskStore.setState({ selectedClientId: null, selectedProjectId: null });
    renderWorkspace();

    const profile = screen.getByRole('tab', { name: 'clients.profile' });
    const overview = screen.getByRole('tab', { name: 'clients.overview' });
    const notes = screen.getByRole('tab', { name: 'clients.notes' });
    expect(profile).toBeDisabled();
    expect(profile).toHaveAttribute('aria-describedby', 'clients-profile-disabled-reason');
    expect(screen.getByText('clients.profileNeedsBrand')).toBeInTheDocument();
    expect(notes).not.toBeDisabled();
    expect(await screen.findByText('clients.noProjects')).toBeInTheDocument();

    fireEvent.keyDown(overview, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(notes);
    expect(useClientDetailsStore.getState().category).toBe('notes');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('clients.noNotes'));
  });

  it('moves Everything creation into the aggregate notes flow instead of opening a brand profile', async () => {
    useTaskStore.setState({ selectedClientId: null, selectedProjectId: null });
    renderWorkspace();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'clients.addNote' }));
    expect(useClientDetailsStore.getState().category).toBe('notes');
    expect(screen.getByRole('combobox', { name: 'clients.selectClient' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'clients.profile' })).toBeDisabled();
  });

  it('shows No Client overview as unassigned work without creating detail drafts', async () => {
    useTaskStore.setState({ selectedClientId: general.id, selectedProjectId: null });
    renderWorkspace();

    expect(screen.getByRole('heading', { name: 'clients.noClientScope' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'clients.profile' })).toBeDisabled();
    expect(screen.getByText('clients.profileNeedsBrand')).toBeInTheDocument();
    expect(await screen.findByText('clients.noProjects')).toBeInTheDocument();
    expect(useClientDetailsStore.getState().drafts).toEqual({});
    expect(useClientStore.getState().clients).toEqual([brand, general, secondBrand]);
  });

  it('reaches the static category panel with Tab and returns to the selected tab with Shift+Tab', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const overview = screen.getByRole('tab', { name: 'clients.overview' });
    const panel = screen.getByRole('tabpanel');
    expect(panel.querySelector('a,button,input,textarea,[tabindex="0"]')).not.toBeNull();

    await user.click(overview);
    await user.tab();
    expect(panel).toHaveFocus();

    await user.tab({ shift: true });
    expect(overview).toHaveFocus();
  });
});
