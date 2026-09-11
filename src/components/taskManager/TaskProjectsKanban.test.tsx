import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../types';
import { TaskProjectsKanban } from './TaskProjectsKanban';

const createProject = vi.fn();
const createTask = vi.fn();
const updateTask = vi.fn();
const openTaskInActiveTab = vi.fn();
const setActiveTaskPage = vi.fn();

function makeTask(partial: Partial<Task> & Pick<Task, 'id' | 'title' | 'projectId'>): Task {
  return {
    content: '',
    status: 'pending',
    importance: 'medium',
    date: '2026-09-11',
    assignees: [],
    createdAt: 1,
    updatedAt: 1,
    order: 0,
    ...partial,
  };
}

const projects = [
  { id: 'p-gen', name: 'General', color: 'text-blue-500', clientId: 'c1' },
  { id: 'p-web', name: 'Website', color: 'text-amber-500', clientId: 'c1' },
  { id: 'p-other', name: 'Other', color: 'text-rose-500', clientId: 'c2' },
];

const tasks: Task[] = [
  makeTask({ id: 't1', title: 'General task', projectId: 'p-gen' }),
  makeTask({ id: 't2', title: 'Website task', projectId: 'p-web' }),
  makeTask({ id: 't3', title: 'Other client task', projectId: 'p-other' }),
  makeTask({ id: 't-del', title: 'Deleted task', projectId: 'p-gen', deletedAt: 100 }),
];

let selectedClientId: string | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector: (s: {
    tasks: Task[];
    selectedClientId: string | null;
    activeTaskId: string | null;
    updateTask: typeof updateTask;
    createTask: typeof createTask;
    openTaskInActiveTab: typeof openTaskInActiveTab;
  }) => unknown) =>
    selector({
      tasks,
      selectedClientId,
      activeTaskId: null,
      updateTask,
      createTask,
      openTaskInActiveTab,
    }),
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector?: (s: {
    projects: typeof projects;
    createProject: typeof createProject;
  }) => unknown) => {
    const state = { projects, createProject };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { setActiveTaskPage: typeof setActiveTaskPage }) => unknown) =>
    selector({ setActiveTaskPage }),
}));

describe('TaskProjectsKanban', () => {
  beforeEach(() => {
    selectedClientId = null;
    createProject.mockReset();
    createTask.mockReset();
    updateTask.mockReset();
    openTaskInActiveTab.mockReset();
    createProject.mockResolvedValue({ id: 'p-new', name: 'Launch' });
    createTask.mockResolvedValue({ id: 't-new', title: 'New card', projectId: 'p-gen' });
  });

  it('asks the user to pick a client when none is selected', () => {
    render(<TaskProjectsKanban />);
    expect(screen.getByRole('status')).toHaveTextContent('tasks.kanbanPickClient');
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(screen.queryByText('General')).not.toBeInTheDocument();
  });

  it('renders living tasks in the selected client’s project columns only', () => {
    selectedClientId = 'c1';
    render(<TaskProjectsKanban />);

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.getByText('General task')).toBeInTheDocument();
    expect(screen.getByText('Website task')).toBeInTheDocument();
    expect(screen.queryByText('Other client task')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted task')).not.toBeInTheDocument();
  });

  it('creates a project for the selected client', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);

    await user.click(screen.getByRole('button', { name: /New project/ }));
    await user.type(screen.getByPlaceholderText('Project name'), 'Launch');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(createProject).toHaveBeenCalledWith('Launch', 'c1');
  });

  it('adds a task with the column project id', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('New card');
    render(<TaskProjectsKanban />);

    const generalCol = document.querySelector('[data-project="p-gen"]');
    expect(generalCol).toBeTruthy();
    await user.click(within(generalCol as HTMLElement).getByRole('button', { name: /Add task/ }));

    expect(createTask).toHaveBeenCalledWith('New card', { projectId: 'p-gen' });
    expect(openTaskInActiveTab).toHaveBeenCalledWith('t-new');
  });

  it('moves a task only onto a real project column', () => {
    selectedClientId = 'c1';
    render(<TaskProjectsKanban />);

    const websiteCol = document.querySelector('[data-project="p-web"] .crm-kanban-column-body');
    expect(websiteCol).toBeTruthy();
    fireEvent.drop(websiteCol as HTMLElement, {
      dataTransfer: {
        getData: (type: string) => (type === 'application/x-task-card' ? 't1' : ''),
      },
    });

    expect(updateTask).toHaveBeenCalledWith('t1', { projectId: 'p-web' });
  });
});
