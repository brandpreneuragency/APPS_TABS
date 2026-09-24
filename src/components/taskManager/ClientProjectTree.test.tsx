import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientProjectTree } from './ClientProjectTree';

const setSelection = vi.fn();
const createClient = vi.fn();
const createProject = vi.fn();
const deleteClient = vi.fn();
const deleteProject = vi.fn();
const showToast = vi.fn();

const clients = [
  { id: 'c1', name: 'Brandpreneur', color: 'text-blue-500', createdAt: 0, order: 0 },
  { id: 'c2', name: 'Wagner Atelier', color: 'text-emerald-500', createdAt: 0, order: 1 },
];

let projects = [
  { id: 'p-gen', name: 'General', color: 'text-blue-500', clientId: 'c1', createdAt: 0, order: 0 },
  { id: 'p-web', name: 'Yeni web sitesi', color: 'text-amber-500', clientId: 'c1', createdAt: 0, order: 1 },
  { id: 'p-gen-2', name: 'General', color: 'text-emerald-500', clientId: 'c2', createdAt: 0, order: 0 },
];

let selectedClientId: string | null = 'c1';
let selectedProjectId: string | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../stores/clientStore', () => ({
  useClientStore: (selector: (s: {
    clients: typeof clients;
    createClient: typeof createClient;
    deleteClient: typeof deleteClient;
  }) => unknown) =>
    selector({ clients, createClient, deleteClient }),
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector: (s: {
    projects: typeof projects;
    createProject: typeof createProject;
    deleteProject: typeof deleteProject;
  }) => unknown) =>
    selector({ projects, createProject, deleteProject }),
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector: (s: {
    selectedClientId: string | null;
    selectedProjectId: string | null;
    setSelection: typeof setSelection;
  }) => unknown) =>
    selector({
      selectedClientId,
      selectedProjectId,
      setSelection,
    }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { showToast: typeof showToast }) => unknown) =>
    selector({ showToast }),
}));

describe('ClientProjectTree', () => {
  beforeEach(() => {
    setSelection.mockReset();
    createClient.mockReset();
    createProject.mockReset();
    deleteClient.mockReset();
    deleteProject.mockReset();
    showToast.mockReset();
    selectedClientId = 'c1';
    selectedProjectId = null;
  });

  it('selects a nested project', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    await user.click(screen.getByRole('button', { name: 'General' }));
    expect(setSelection).toHaveBeenCalledWith('c1', 'p-gen');
  });

  it('reveals and selects a project created under a collapsed client', async () => {
    const user = userEvent.setup();
    const created = { id: 'p-new', name: 'Launch', color: 'text-blue-500', clientId: 'c2', createdAt: 1, order: 1 };
    createProject.mockImplementation(async () => {
      projects = [...projects, created];
      return created;
    });
    try {
      render(<ClientProjectTree />);
      const client = screen.getByRole('group', { name: 'Wagner Atelier' });
      await user.click(within(client).getByRole('button', { name: 'tasks.addProjectToClient' }));
      await user.type(screen.getByRole('textbox'), 'Launch');
      await user.click(screen.getByRole('button', { name: 'tasks.addProject' }));

      expect(createProject).toHaveBeenCalledWith('Launch', 'c2');
      expect(within(client).getByRole('button', { name: 'Launch' })).toBeInTheDocument();
      expect(setSelection).toHaveBeenCalledWith('c2', 'p-new');
    } finally {
      projects = projects.filter((project) => project.id !== created.id);
    }
  });

  it('selects a client without changing expand via the name button', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    await user.click(screen.getByRole('button', { name: 'Brandpreneur' }));
    expect(setSelection).toHaveBeenCalledWith('c1', null);
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
  });

  it('toggles expand from the chevron without selecting', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse Brandpreneur' }));
    expect(setSelection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand Brandpreneur' }));
    expect(setSelection).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
  });

  it('selects the focused nested project with Enter', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    const tree = screen.getByRole('tree');
    tree.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(setSelection).toHaveBeenCalledWith('c1', 'p-gen');
  });

  it('nests project rows under the client name', () => {
    render(<ClientProjectTree />);
    const projectRow = document.getElementById('client-tree-project-p-gen');
    expect(projectRow).toHaveClass('client-tree-row--project');
    expect(projectRow?.querySelector('.client-tree-chevron-spacer')).toBeInTheDocument();
  });

  it('continues keyboard from the last clicked row', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    await user.click(screen.getByRole('button', { name: 'General' }));
    expect(screen.getByRole('tree')).toHaveAttribute(
      'aria-activedescendant',
      'client-tree-project-p-gen',
    );

    setSelection.mockClear();
    screen.getByRole('tree').focus();
    await user.keyboard('{Enter}');
    expect(setSelection).toHaveBeenCalledWith('c1', 'p-gen');

    setSelection.mockClear();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(setSelection).toHaveBeenCalledWith('c1', 'p-web');
  });

  it('confirms and deletes a client', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    await user.click(screen.getByRole('button', { name: 'explorer.delete Brandpreneur' }));
    expect(screen.getByText('tasks.deleteClientConfirm:Brandpreneur')).toBeInTheDocument();
    expect(deleteClient).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'explorer.delete' }));
    expect(deleteClient).toHaveBeenCalledWith('c1');
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('confirms and deletes a project', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    await user.click(screen.getByRole('button', { name: 'explorer.delete Brandpreneur Yeni web sitesi' }));
    expect(screen.getByText('tasks.deleteProjectConfirm:Yeni web sitesi')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'explorer.delete' }));
    expect(deleteProject).toHaveBeenCalledWith('p-web');
    expect(deleteClient).not.toHaveBeenCalled();
  });

  it('cancels client delete without calling the store', async () => {
    const user = userEvent.setup();
    render(<ClientProjectTree />);
    await user.click(screen.getByRole('button', { name: 'explorer.delete Brandpreneur' }));
    await user.click(screen.getByRole('button', { name: 'confirm.cancel' }));
    expect(deleteClient).not.toHaveBeenCalled();
    expect(screen.queryByText('tasks.deleteClientConfirm:Brandpreneur')).not.toBeInTheDocument();
  });
});
