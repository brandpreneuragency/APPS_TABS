import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddNewProjectButton } from './AddNewProjectButton';

const createProject = vi.fn();
const showToast = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector: (s: {
    createProject: typeof createProject;
    projects: { name: string; clientId: string }[];
  }) => unknown) =>
    selector({
      createProject,
      projects: [
        { name: 'General', clientId: 'c1' },
        { name: 'Launch', clientId: 'c2' },
      ],
    }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { showToast: typeof showToast }) => unknown) =>
    selector({ showToast }),
}));

describe('AddNewProjectButton', () => {
  beforeEach(() => {
    createProject.mockReset();
    showToast.mockReset();
    createProject.mockResolvedValue({ id: 'p1', name: 'Website' });
  });

  it('opens a name field under the add button and creates a project for the client', async () => {
    const user = userEvent.setup();
    render(<AddNewProjectButton clientId="c1" />);

    await user.click(screen.getByRole('button', { name: 'tasks.addNewProject' }));
    const input = screen.getByRole('textbox', { name: 'tasks.projectNamePlaceholder' });
    await user.type(input, 'Website');
    await user.click(screen.getByRole('button', { name: 'tasks.addProject' }));

    expect(createProject).toHaveBeenCalledWith('Website', 'c1');
    expect(showToast).toHaveBeenCalledWith('tasks.projectCreated:Website', 'info');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not create a duplicate project name within the client', async () => {
    const user = userEvent.setup();
    render(<AddNewProjectButton clientId="c1" />);

    await user.click(screen.getByRole('button', { name: 'tasks.addNewProject' }));
    await user.type(screen.getByRole('textbox'), 'general');
    await user.click(screen.getByRole('button', { name: 'tasks.addProject' }));

    expect(createProject).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('tasks.projectExists:general', 'error');
  });

  it('allows the same project name under a different client', async () => {
    const user = userEvent.setup();
    render(<AddNewProjectButton clientId="c1" />);

    await user.click(screen.getByRole('button', { name: 'tasks.addNewProject' }));
    await user.type(screen.getByRole('textbox'), 'Launch');
    await user.click(screen.getByRole('button', { name: 'tasks.addProject' }));

    expect(createProject).toHaveBeenCalledWith('Launch', 'c1');
  });

  it.each(['enter', 'checkmark'])('creates from an inline last row using %s', async (method) => {
    const user = userEvent.setup();
    render(<AddNewProjectButton clientId="c1" inlineGroupLabel="Client">
      <button>Existing project</button>
    </AddNewProjectButton>);
    await user.click(screen.getByRole('button', { name: 'tasks.addNewProject' }));
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input.closest('form')).toBe(input.closest('.scope-project-content')?.lastElementChild);
    await user.type(input, 'Website');
    if (method === 'enter') await user.keyboard('{Enter}');
    else await user.click(screen.getByRole('button', { name: 'tasks.addProject' }));
    expect(createProject).toHaveBeenCalledExactlyOnceWith('Website', 'c1');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('dismisses the inline draft on an outside click or Escape without saving', async () => {
    const user = userEvent.setup();
    render(<AddNewProjectButton clientId="c1" inlineGroupLabel="Client">
      <button>Existing project</button>
    </AddNewProjectButton>);
    const trigger = screen.getByRole('button', { name: 'tasks.addNewProject' });
    await user.click(trigger);
    await user.type(screen.getByRole('textbox'), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Existing project' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });
});
