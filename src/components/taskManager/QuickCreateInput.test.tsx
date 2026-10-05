import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickCreateInput } from './QuickCreateInput';

const createTask = vi.fn();
const showToast = vi.fn();

const projects = [
  { id: 'p-gen', name: 'General', color: 'c1', clientId: 'c1' },
  { id: 'p-web', name: 'Website', color: 'c1b', clientId: 'c1' },
  { id: 'p-other', name: 'Other', color: 'c2', clientId: 'c2' },
];

let selectedClientId: string | null = 'c1';
let selectedProjectId: string | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector?: (s: {
    createTask: typeof createTask;
    selectedClientId: string | null;
    selectedProjectId: string | null;
  }) => unknown) => {
    const state = { createTask, selectedClientId, selectedProjectId };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector?: (s: { projects: typeof projects }) => unknown) => {
    const state = { projects };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { showToast: typeof showToast }) => unknown) =>
    selector({ showToast }),
}));

describe('QuickCreateInput', () => {
  beforeEach(() => {
    selectedClientId = 'c1';
    selectedProjectId = null;
    createTask.mockReset();
    showToast.mockReset();
    createTask.mockResolvedValue({ id: 't-new' });
  });

  it('lists only the selected client’s projects and has no No project item', async () => {
    const user = userEvent.setup();
    render(<QuickCreateInput />);

    await user.click(screen.getByRole('button', { name: 'No Project' }));

    expect(screen.queryByText('No project')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Website' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument();
  });

  it('creates a task on the resolved General project when none is picked', async () => {
    const user = userEvent.setup();
    render(<QuickCreateInput />);

    await user.type(screen.getByRole('textbox'), 'Buy milk');
    await user.click(screen.getByTitle('Add task'));

    expect(createTask).toHaveBeenCalledWith(
      'Buy milk',
      expect.objectContaining({ projectId: 'p-gen' }),
    );
  });

  it('creates a task on the picked project', async () => {
    const user = userEvent.setup();
    render(<QuickCreateInput />);

    await user.click(screen.getByRole('button', { name: 'No Project' }));
    await user.click(screen.getByRole('button', { name: 'Website' }));
    await user.type(screen.getByRole('textbox'), 'Ship site');
    await user.click(screen.getByTitle('Add task'));

    expect(createTask).toHaveBeenCalledWith(
      'Ship site',
      expect.objectContaining({ projectId: 'p-web' }),
    );
  });

  it('uses the newly selected navigation project even with an older composer project', async () => {
    const user = userEvent.setup();
    const view = render(<QuickCreateInput assignedProject="Website" />);
    selectedProjectId = 'p-gen';
    view.rerender(<QuickCreateInput assignedProject="Website" />);
    expect(screen.getByRole('button', { name: 'Project: General' })).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'New brief');
    await user.click(screen.getByTitle('Add task'));
    expect(createTask).toHaveBeenCalledWith('New brief', expect.objectContaining({ projectId: 'p-gen' }));
  });

  it('toasts when no project can be resolved', async () => {
    selectedClientId = null;
    selectedProjectId = null;
    const user = userEvent.setup();
    render(<QuickCreateInput />);

    await user.type(screen.getByRole('textbox'), 'Orphan task');
    await user.keyboard('{Enter}');

    expect(showToast).toHaveBeenCalledWith('tasks.pickAProject', 'info');
    expect(createTask).not.toHaveBeenCalled();
  });
});
