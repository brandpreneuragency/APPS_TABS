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
const deleteTask = vi.fn();
const openTaskInActiveTab = vi.fn();
const setActiveTaskPage = vi.fn();
const setTaskMode = vi.fn();
const setContextPanelOpen = vi.fn();

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
    deleteTask: typeof deleteTask;
    createTask: typeof createTask;
    openTaskInActiveTab: typeof openTaskInActiveTab;
  }) => unknown) =>
    selector({
      tasks,
      setSelection,
      selectedClientId,
      activeTaskId: null,
      updateTask,
      deleteTask,
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
  useUIStore: (selector: (s: { setActiveTaskPage: typeof setActiveTaskPage; setTaskMode: typeof setTaskMode; setContextPanelOpen: typeof setContextPanelOpen; showToast: typeof showToast }) => unknown) =>
    selector({ setActiveTaskPage, setTaskMode, setContextPanelOpen, showToast }),
}));

describe('TaskProjectsKanban', () => {
  beforeEach(() => {
    selectedClientId = null;
    createClient.mockReset();
    showToast.mockReset();
    createClient.mockResolvedValue({ id: 'c3', name: 'New client' });
    setSelection.mockReset();
    setSelection.mockImplementation((clientId: string | null) => { selectedClientId = clientId; });
    updateProject.mockReset();
    createProject.mockReset();
    createTask.mockReset();
    updateTask.mockReset();
    updateTask.mockResolvedValue(undefined);
    deleteTask.mockReset();
    openTaskInActiveTab.mockReset();
    setActiveTaskPage.mockReset();
    setTaskMode.mockReset();
    setContextPanelOpen.mockReset();
    createProject.mockResolvedValue({ id: 'p-new', name: 'Launch' });
    createTask.mockResolvedValue({ id: 't-new', title: 'New card', projectId: 'p-gen' });
  });

  it('uses calendar columns for projects with header creation and card actions', () => {
    render(<TaskProjectsKanban />);
    const column = screen.getByRole('region', { name: 'Client One / General' });
    expect(column.parentElement).toHaveClass('task-calendar-board');
    expect(column).toHaveClass('task-calendar-day');
    expect(within(column).getByRole('button', { name: 'tasks.addTask General' })).toBeInTheDocument();
    expect(within(column).getByRole('button', { name: 'tasks.actions' })).toBeInTheDocument();
    fireEvent.click(within(column).getByText('General task'));
    expect(openTaskInActiveTab).toHaveBeenCalledWith('t1');
    expect(setActiveTaskPage).toHaveBeenCalledWith('list');
    expect(setTaskMode).toHaveBeenCalledWith(true);
    expect(setContextPanelOpen).toHaveBeenCalledWith('tasks', true);
  });

  it('places every project in one board and identifies its client', () => {
    render(<TaskProjectsKanban />);
    expect(screen.getByText('General', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.getByText('Other', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.queryByText('Total Tasks')).not.toBeInTheDocument();
    const general = screen.getByRole('region', { name: 'Client One / General' });
    const website = screen.getByRole('region', { name: 'Client One / Website' });
    const other = screen.getByRole('region', { name: 'Client Two / Other' });
    expect(general.parentElement).toBe(website.parentElement);
    expect(general.parentElement).toBe(other.parentElement);
    expect(document.querySelector('.task-kanban-client-row')).toBeNull();
  });

  it('shows only client and project creation actions in the toolbar', () => {
    render(<TaskProjectsKanban />);
    const actions = screen.getByRole('group', { name: 'navigation.projects' });
    expect(actions.parentElement?.querySelectorAll('button')).toHaveLength(2);
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
    expect(within(actions).getByRole('button', { name: 'tasks.addNewClient' })).toHaveClass('ui-button');
    expect(within(actions).getByRole('button', { name: 'tasks.addNewProject' })).toHaveClass('ui-button');
    expect(within(actions).queryByRole('button', { name: 'tasks.allClients' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Client Two' })).not.toBeInTheDocument();
  });

  it('creates a client from the board toolbar', async () => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const actions = screen.getByRole('group', { name: 'navigation.projects' });
    const addButton = within(actions).getByRole('button', { name: 'tasks.addNewClient' });
    await user.click(addButton);
    const input = screen.getByRole('textbox', { name: 'tasks.clientNamePlaceholder' });
    expect(input).toHaveFocus();
    await user.type(input, 'New client');
    await user.click(screen.getByRole('button', { name: 'tasks.addClient' }));
    expect(createClient).toHaveBeenCalledWith('New client');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('replaces the inline creation form when switching between client and project', async () => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const clientButton = screen.getByRole('button', { name: 'tasks.addNewClient' });
    const projectButton = screen.getByRole('button', { name: 'tasks.addNewProject' });

    await user.click(projectButton);
    const projectForm = screen.getByRole('dialog', { name: 'tasks.addNewProject' });
    const formClass = projectForm.className;
    const formParent = projectForm.parentElement;
    await user.click(clientButton);
    const clientForm = screen.getByRole('dialog', { name: 'tasks.addNewClient' });
    expect(clientForm.className).toBe(formClass);
    expect(clientForm.parentElement).toBe(formParent);
    expect(within(clientForm).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(projectButton).toHaveAttribute('aria-expanded', 'false');
    expect(clientButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(clientForm).getByRole('textbox')).toHaveFocus();
    expect(within(clientForm).getByRole('button', { name: 'tasks.addClient' })).toBeDisabled();

    await user.click(projectButton);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'tasks.addNewClient' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'tasks.projectNamePlaceholder' })).toHaveFocus();
    expect(clientButton).toHaveAttribute('aria-expanded', 'false');
    expect(projectButton).toHaveAttribute('aria-expanded', 'true');
  });

  it.each(['button', 'Escape'])('dismisses inline client creation using %s', async (cancelWith) => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    await user.click(screen.getByRole('button', { name: 'tasks.addNewClient' }));
    await user.type(screen.getByRole('textbox', { name: 'tasks.clientNamePlaceholder' }), 'Draft');
    if (cancelWith === 'button') await user.click(screen.getByRole('button', { name: 'confirm.cancel' }));
    else await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('filters projects and tasks by the navbar client selection and excludes deleted tasks', () => {
    selectedClientId = 'c1';
    render(<TaskProjectsKanban />);

    expect(screen.getByText('General', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.getByText('Website', { selector: '.crm-kanban-column-title' })).toBeInTheDocument();
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(screen.queryByText('Other', { selector: '.crm-kanban-column-title' })).not.toBeInTheDocument();
    expect(screen.getByText('General task')).toBeInTheDocument();
    expect(screen.getByText('Website task')).toBeInTheDocument();
    expect(screen.queryByText('Other client task')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted task')).not.toBeInTheDocument();
  });

  it('updates columns and tasks when the navbar selection changes and restores everything', () => {
    selectedClientId = 'c1';
    const { rerender } = render(<TaskProjectsKanban />);

    selectedClientId = 'c2';
    rerender(<TaskProjectsKanban />);
    expect(screen.queryByRole('region', { name: 'Client One / General' })).not.toBeInTheDocument();
    expect(screen.queryByText('Website task')).not.toBeInTheDocument();
    expect(screen.getByText('Other client task')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Client Two' })).not.toBeInTheDocument();

    selectedClientId = null;
    rerender(<TaskProjectsKanban />);
    expect(screen.getByText('General task')).toBeInTheDocument();
    expect(screen.getByText('Website task')).toBeInTheDocument();
    expect(screen.getByText('Other client task')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tasks.allClients' })).not.toBeInTheDocument();
  });

  it('shows no projects for a navbar client with no projects', () => {
    selectedClientId = 'c-empty';
    render(<TaskProjectsKanban />);

    expect(screen.getByText('navigation.noProjects')).toBeInTheDocument();
    expect(screen.queryByText('General task')).not.toBeInTheDocument();
    expect(screen.queryByText('Other client task')).not.toBeInTheDocument();
  });

  it('creates a project for the shared client selection', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);

    await user.click(screen.getByRole('button', { name: 'tasks.addNewProject' }));
    const clientSelect = screen.getByRole('combobox', { name: 'tasks.selectClient' });
    expect(clientSelect).toHaveValue('c1');
    await user.selectOptions(clientSelect, 'c2');
    await user.type(screen.getByPlaceholderText('tasks.projectNamePlaceholder'), 'Launch');
    await user.click(screen.getByRole('button', { name: 'tasks.addProject' }));

    expect(createProject).toHaveBeenCalledWith('Launch', 'c2');
  });

  it('adds a task with the column project id', async () => {
    selectedClientId = 'c1';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);

    const generalCol = document.querySelector('[data-project="p-gen"]');
    expect(generalCol).toBeTruthy();
    await user.click(within(generalCol as HTMLElement).getByRole('button', { name: 'tasks.addTask General' }));
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

    expect(createTask).toHaveBeenCalledWith('New card', { projectId: 'p-gen', date: undefined });
    expect(openTaskInActiveTab).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'tasks.taskTitlePlaceholder' })).not.toBeInTheDocument();
  });

  it('creates tasks in their project column without assignment pickers', async () => {
    selectedClientId = 'c2';
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const client = screen.getByRole('region', { name: 'Client Two / Other' });
    await user.click(within(client).getByRole('button', { name: 'tasks.addTask Other' }));
    const input = within(client).getByRole('textbox', { name: 'tasks.taskTitlePlaceholder' });
    expect(input).toHaveAttribute('maxlength', '80');
    expect(within(client).queryByRole('button', { name: 'tasks.selectClient' })).not.toBeInTheDocument();
    expect(within(client).queryByRole('button', { name: 'tasks.selectProject' })).not.toBeInTheDocument();
    await user.type(input, '  New card  ');
    await user.click(within(client).getByRole('button', { name: 'tasks.createTask' }));
    expect(createTask).toHaveBeenCalledExactlyOnceWith('New card', { projectId: 'p-other', date: undefined });
    expect(within(client).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it.each(['button', 'Escape'])('cancels a draft using %s without creating a task', async (cancelWith) => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const client = screen.getByRole('region', { name: 'Client Two / Other' });
    const trigger = within(client).getByRole('button', { name: 'tasks.addTask Other' });
    await user.click(trigger);
    await user.type(within(client).getByRole('textbox'), 'Discard this draft');
    if (cancelWith === 'Escape') await user.keyboard('{Escape}');
    else await user.click(trigger);
    expect(createTask).not.toHaveBeenCalled();
    expect(within(client).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(within(client).getByRole('textbox')).toHaveValue('');
  });

  it('keeps the form and draft when saving fails so the user can retry', async () => {
    createTask.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    await user.click(screen.getByRole('button', { name: 'tasks.addTask Other' }));
    const input = screen.getByRole('textbox');
    const add = screen.getByRole('button', { name: 'tasks.createTask' });
    await user.type(input, 'Retry task');
    await user.click(add);
    expect(input).toHaveValue('Retry task');
    expect(add).toBeEnabled();
    expect(openTaskInActiveTab).not.toHaveBeenCalled();
    await user.click(add);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('prevents duplicate submissions while saving', async () => {
    let resolveCreate!: (task: Task) => void;
    createTask.mockReturnValueOnce(new Promise<Task>((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    await user.click(screen.getByRole('button', { name: 'tasks.addTask Other' }));
    const input = screen.getByRole('textbox');
    await user.type(input, 'New task');
    await user.dblClick(screen.getByRole('button', { name: 'tasks.createTask' }));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'tasks.createTask' })).toBeDisabled();
    await act(async () => { resolveCreate(makeTask({ id: 'saved', title: 'New task', projectId: 'p-other' })); });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
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

    expect(updateTask).toHaveBeenCalledWith('t1', { projectId: 'p-web' }, { field: 'projectId', beforeId: null });
  });

  it('does not render a project picker on the card', () => {
    render(<TaskKanbanCard task={tasks[0]} isActive={false} onClick={openTaskInActiveTab} />);
    expect(screen.queryByRole('combobox', { name: 'tasks.selectProject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'tasks.selectClient' })).not.toBeInTheDocument();
  });

  it('ignores deleted, unknown and filtered-out tasks when dropping', async () => {
    selectedClientId = 'c2';
    render(<TaskProjectsKanban />);
    const column = screen.getByRole('region', { name: 'Client Two / Other' });
    for (const id of ['t-del', 'unknown', 't1']) {
      fireEvent.drop(column, { dataTransfer: { getData: () => id } });
    }
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('shows failed moves and clears the error on a successful retry', async () => {
    updateTask.mockRejectedValueOnce(new Error('Move failed'));
    render(<TaskProjectsKanban />);
    const column = screen.getByRole('region', { name: 'Client One / Website' });
    const dataTransfer = { getData: () => 't1' };
    fireEvent.drop(column, { dataTransfer });
    expect(await screen.findByRole('alert')).toHaveTextContent('tasks.moveFailed');
    fireEvent.drop(column, { dataTransfer });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(updateTask).toHaveBeenLastCalledWith('t1', { projectId: 'p-web' }, { field: 'projectId', beforeId: null });
  });

  it('offers the same edit, complete and delete actions as Calendar', async () => {
    const user = userEvent.setup();
    render(<TaskProjectsKanban />);
    const column = screen.getByRole('region', { name: 'Client One / General' });
    await user.click(within(column).getByRole('button', { name: 'tasks.actions' }));
    expect(screen.getByRole('menuitem', { name: 'tasks.edit' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'tasks.done' }));
    expect(updateTask).toHaveBeenCalledWith('t1', { status: 'completed' });
    expect(openTaskInActiveTab).not.toHaveBeenCalled();
    await user.click(within(column).getByRole('button', { name: 'tasks.actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'tasks.delete' }));
    expect(deleteTask).toHaveBeenCalledWith('t1');
  });

  it('indicates and uses the exact card position when moving projects', () => {
    render(<TaskProjectsKanban />);
    const card = screen.getByText('Website task').closest<HTMLElement>('.crm-kanban-card')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 160, height: 60 } as DOMRect);
    const dataTransfer = { types: ['application/x-task-card'], getData: () => 't1', dropEffect: '' };
    for (const type of ['dragover', 'drop']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 110 });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      fireEvent(card, event);
      if (type === 'dragover') expect(card.parentElement?.querySelector('.kanban-drop-indicator')).toBeInTheDocument();
    }
    expect(updateTask).toHaveBeenCalledWith('t1', { projectId: 'p-web' }, { field: 'projectId', beforeId: 't2' });
    expect(document.querySelector('.kanban-drop-indicator')).toBeNull();
  });

  it('uses the task list top row with client, project and date', () => {
    render(<TaskKanbanCard task={tasks[0]} isActive={false} onClick={openTaskInActiveTab} />);
    const top = screen.getByText('General task').closest('[role="button"]')!.querySelector('.task-kanban-card-top')!;
    expect(top).toHaveClass('row-xs');
    expect(within(top as HTMLElement).getByText('Client One')).toBeInTheDocument();
    expect(within(top as HTMLElement).getByText('General')).toBeInTheDocument();
    expect(within(top as HTMLElement).getByText('11.Eyl')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(top.querySelector('button, .crm-kanban-card-drag')).toBeNull();
  });

  it.each([
    { ...tasks[0], date: '' },
    { ...tasks[0], status: 'completed' as const },
  ])('hides the date for undated or completed cards', (task) => {
    render(<TaskKanbanCard task={task} isActive={false} onClick={openTaskInActiveTab} />);
    expect(screen.queryByText('11.Eyl')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(openTaskInActiveTab).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('keeps whole-card rescheduling payload and assignee count', () => {
    render(<TaskKanbanCard task={{ ...tasks[0], assignees: ['person'] }} isActive={false} dragLabel="Reschedule" onClick={openTaskInActiveTab} />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTitle('Reschedule'), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 't1');
    expect(setData).toHaveBeenCalledWith('application/x-task-card', 't1');
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
