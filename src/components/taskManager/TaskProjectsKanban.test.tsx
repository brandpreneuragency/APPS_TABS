import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../types';
import { TaskKanbanCard, TaskProjectsKanban } from './TaskProjectsKanban';

const createProject = vi.fn();
const createClient = vi.fn();
const showToast = vi.fn();
const updateProject = vi.fn();
const setSelection = vi.fn();
const clients = [{ id: 'c1', name: 'Client One' }, { id: 'c2', name: 'Client Two' }];
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
    setSelection: typeof setSelection;
    selectedClientId: string | null;
    activeTaskId: string | null;
    updateTask: typeof updateTask;
    createTask: typeof createTask;
    openTaskInActiveTab: typeof openTaskInActiveTab;
  }) => unknown) =>
    selector({
      tasks,
      setSelection,
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
    updateProject: typeof updateProject;
  }) => unknown) => {
    const state = { projects, createProject, updateProject };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/clientStore', () => ({
  useClientStore: (selector: (state: { clients: typeof clients; createClient: typeof createClient }) => unknown) => selector({ clients, createClient }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { setActiveTaskPage: typeof setActiveTaskPage; showToast: typeof showToast }) => unknown) =>
    selector({ setActiveTaskPage, showToast }),
}));

describe('TaskProjectsKanban', () => {
  beforeEach(() => {
    selectedClientId = null;
    createClient.mockReset();
    showToast.mockReset();
    createClient.mockResolvedValue({ id: 'c3', name: 'New client' });
    setSelection.mockReset();
    updateProject.mockReset();
    createProject.mockReset();
    createTask.mockReset();
    updateTask.mockReset();
    openTaskInActiveTab.mockReset();
    createProject.mockResolvedValue({ id: 'p-new', name: 'Launch' });
    createTask.mockResolvedValue({ id: 't-new', title: 'New card', projectId: 'p-gen' });
  });

  it('groups projects into a separate row for each client', () => {
    render(<TaskProjectsKanban />);
    expect(screen.getByText('General', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.getByText('Other', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.queryByText('Total Tasks')).not.toBeInTheDocument();
    const firstRow = screen.getByRole('region', { name: 'Client One' });
    const secondRow = screen.getByRole('region', { name: 'Client Two' });
    expect(within(firstRow).getByText('General', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(within(firstRow).getByText('Website', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(within(firstRow).queryByText('Other', { selector: '.crm-kanban-column-title' })).not.toBeInTheDocument();
    expect(within(secondRow).getByText('Other', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
  });

  it('filters client groups and restores all clients from the toolbar', async () => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    expect(within(screen.getByRole('group', { name: 'tasks.clients' })).queryByRole('combobox')).not.toBeInTheDocument();
    const allClients = screen.getByRole('button', { name: 'tasks.allClients' });
    const clientTwo = screen.getByRole('button', { name: 'Client Two' });
    expect(allClients).toHaveAttribute('aria-pressed', 'true');
    await user.click(clientTwo);
    expect(clientTwo).toHaveAttribute('aria-pressed', 'true');
    expect(allClients).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Client One' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Client Two' })).toBeInTheDocument();
    await user.click(allClients);
    expect(screen.getByRole('region', { name: 'Client One' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Client Two' })).toBeInTheDocument();
    expect(allClients).toHaveAttribute('aria-pressed', 'true');
  });

  it('creates a client from the board toolbar', async () => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const filters = screen.getByRole('group', { name: 'tasks.clients' });
    const addButton = within(filters).getByRole('button', { name: 'tasks.addNewClient' });
    expect(addButton).toHaveTextContent('tasks.addNewClient');
    await user.click(addButton);
    const input = screen.getByRole('textbox', { name: 'tasks.clientNamePlaceholder' });
    expect(input).toHaveFocus();
    await user.type(input, 'New client');
    await user.click(screen.getByRole('button', { name: 'tasks.addClient' }));
    expect(createClient).toHaveBeenCalledWith('New client');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders all clients despite an existing selection and excludes deleted tasks', () => {
    selectedClientId = 'c1';
    render(<TaskProjectsKanban />);

    expect(screen.getByText('General', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.getByText('Website', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(screen.getByText('Other', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.getByText('General task')).toBeInTheDocument();
    expect(screen.getByText('Website task')).toBeInTheDocument();
    expect(screen.getByText('Other client task')).toBeInTheDocument();
    expect(screen.queryByText('Deleted task')).not.toBeInTheDocument();
  });

  it('creates a project for its row client regardless of selection', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);

    await user.click(within(screen.getByRole('region', { name: 'Client Two' })).getByRole('button', { name: /New project/ }));
    expect(within(screen.getByRole('group', { name: 'tasks.clients' })).queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Project name'), 'Launch');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(createProject).toHaveBeenCalledWith('Launch', 'c2');
  });

  it('adds a task with the column project id', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);

    const generalCol = document.querySelector('[data-project="p-gen"]');
    expect(generalCol).toBeTruthy();
    await user.click(within(generalCol as HTMLElement).getByRole('button', { name: 'tasks.addTask' }));
    const input = within(generalCol as HTMLElement).getByRole('textbox', { name: 'tasks.taskTitlePlaceholder' });
    expect(input).toHaveFocus();
    expect(createTask).not.toHaveBeenCalled();
    const addButton = within(generalCol as HTMLElement).getByRole('button', { name: 'tasks.createTask' });
    expect(addButton).toBeDisabled();
    await user.type(input, '   ');
    await user.keyboard('{Enter}');
    expect(createTask).not.toHaveBeenCalled();
    await user.type(input, 'New card   ');
    await user.click(addButton);

    expect(createTask).toHaveBeenCalledWith('New card', { projectId: 'p-gen' });
    expect(openTaskInActiveTab).toHaveBeenCalledWith('t-new');
    expect(screen.queryByRole('textbox', { name: 'tasks.taskTitlePlaceholder' })).not.toBeInTheDocument();
  });

  it('submits with Enter into another client project regardless of selection', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const client = screen.getByRole('region', { name: 'Client Two' });
    await user.click(within(client).getByRole('button', { name: 'tasks.addTask' }));
    const input = within(client).getByRole('textbox', { name: 'tasks.taskTitlePlaceholder' });
    expect(input).toHaveAttribute('maxlength', '80');
    await user.type(input, '  New card  {Enter}');
    expect(createTask).toHaveBeenCalledExactlyOnceWith('New card', { projectId: 'p-other' });
    expect(openTaskInActiveTab).toHaveBeenCalledWith('t-new');
    expect(within(client).queryByRole('form')).not.toBeInTheDocument();
  });

  it.each(['button', 'Escape'])('cancels a draft using %s and restores focus without creating a task', async (cancelWith) => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const client = screen.getByRole('region', { name: 'Client Two' });
    await user.click(within(client).getByRole('button', { name: 'tasks.addTask' }));
    const form = within(client).getByRole('form');
    await user.type(within(form).getByRole('textbox'), 'Discard this draft');
    if (cancelWith === 'Escape') await user.keyboard('{Escape}');
    else await user.click(within(form).getByRole('button', { name: 'confirm.cancel' }));
    expect(createTask).not.toHaveBeenCalled();
    expect(within(client).queryByRole('form')).not.toBeInTheDocument();
    const trigger = within(client).getByRole('button', { name: 'tasks.addTask' });
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(within(client).getByRole('textbox')).toHaveValue('');
  });

  it('keeps the form and draft when saving fails so the user can retry', async () => {
    createTask.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    await user.click(within(screen.getByRole('region', { name: 'Client Two' })).getByRole('button', { name: 'tasks.addTask' }));
    const form = screen.getByRole('form');
    const input = within(form).getByRole('textbox');
    const add = within(form).getByRole('button', { name: 'tasks.createTask' });
    await user.type(input, 'Retry task');
    await user.click(add);
    expect(input).toHaveValue('Retry task');
    expect(input).toHaveFocus();
    expect(add).toBeEnabled();
    expect(openTaskInActiveTab).not.toHaveBeenCalled();
    await user.click(add);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(openTaskInActiveTab).toHaveBeenCalledWith('t-new');
  });

  it('prevents duplicate submissions while saving', async () => {
    let resolveCreate!: (task: Task) => void;
    createTask.mockReturnValueOnce(new Promise<Task>((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    await user.click(within(screen.getByRole('region', { name: 'Client Two' })).getByRole('button', { name: 'tasks.addTask' }));
    const form = screen.getByRole('form');
    const input = within(form).getByRole('textbox');
    await user.type(input, 'New task');
    await user.dblClick(within(form).getByRole('button', { name: 'tasks.createTask' }));
    fireEvent.submit(form);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(input).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'confirm.cancel' })).toBeDisabled();
    await act(async () => { resolveCreate(makeTask({ id: 'saved', title: 'New task', projectId: 'p-other' })); });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(openTaskInActiveTab).toHaveBeenCalledWith('saved');
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

  it('does not render a project picker on the card', () => {
    render(<TaskKanbanCard task={tasks[0]} isActive={false} onClick={openTaskInActiveTab} />);
    expect(screen.queryByRole('combobox', { name: 'tasks.selectProject' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'tasks.selectClient' })).toBeInTheDocument();
  });

  it('keeps the client icon inside the picker container', () => {
    render(<TaskKanbanCard task={tasks[0]} isActive={false} onClick={openTaskInActiveTab} />);
    const picker = screen.getByRole('combobox', { name: 'tasks.selectClient' }).parentElement;
    expect(picker).toHaveClass('task-kanban-card-picker');
    expect(picker?.querySelector(':scope > svg.lucide-user')).toBeInTheDocument();
  });

  it('moves only the task to the chosen client General project', async () => {
    const user = userEvent.setup();
    render(<TaskKanbanCard task={tasks[2]} isActive={false} onClick={openTaskInActiveTab} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'tasks.selectClient' }), 'c1');
    expect(updateTask).toHaveBeenCalledExactlyOnceWith('t3', { projectId: 'p-gen' });
    expect(updateProject).not.toHaveBeenCalled();
    expect(openTaskInActiveTab).not.toHaveBeenCalled();
  });

  it('uses an existing project when the chosen client has no General project', async () => {
    const user = userEvent.setup();
    render(<TaskKanbanCard task={tasks[0]} isActive={false} onClick={openTaskInActiveTab} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'tasks.selectClient' }), 'c2');
    expect(updateTask).toHaveBeenCalledExactlyOnceWith('t1', { projectId: 'p-other' });
  });

  it('keeps an undated card editable without activating it from picker keyboard events', async () => {
    const user = userEvent.setup();
    render(<TaskKanbanCard task={{ ...tasks[0], date: '' }} isActive={false} onClick={openTaskInActiveTab} />);
    const picker = screen.getByRole('combobox', { name: 'tasks.selectClient' });
    fireEvent.keyDown(picker, { key: 'Enter' });
    fireEvent.keyDown(picker, { key: ' ' });
    const date = screen.getByRole('button', { name: 'tasks.dueDateCalendar' });
    date.focus();
    await user.keyboard('{Enter}');
    expect(date).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }));
    expect(updateTask).toHaveBeenCalledWith('t1', { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(openTaskInActiveTab).not.toHaveBeenCalled();
    const card = screen.getByText('General task').closest('[role="button"]');
    fireEvent.keyDown(card as HTMLElement, { key: 'Enter' });
    expect(openTaskInActiveTab).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('keeps the drag handle rescheduling payload and assignee count', () => {
    render(<TaskKanbanCard task={{ ...tasks[0], assignees: ['person'] }} isActive={false} dragLabel="Reschedule" onClick={openTaskInActiveTab} />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTitle('Reschedule'), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 't1');
    expect(setData).toHaveBeenCalledWith('application/x-task-card', 't1');
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
