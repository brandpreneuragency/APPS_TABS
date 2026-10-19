import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskListItem } from './TaskListItem';
import type { Task } from '../../types';
import en from '../../i18n/en';

const { activeTask, openTask, updateTask, taskState } = vi.hoisted(() => ({
  activeTask: { id: 'child' as string | null }, openTask: vi.fn(), updateTask: vi.fn(),
  taskState: { tasks: [] as Task[] },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: { title: string }) =>
    (en.tasks[key.replace('tasks.', '') as keyof typeof en.tasks] ?? key)
      .replace('{{title}}', values?.title ?? '') }),
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: Object.assign(
    (selector: (state: object) => unknown) => selector({
      activeTaskId: activeTask.id, openTaskInActiveTab: openTask, updateTask,
    }),
    { getState: () => taskState },
  ),
}));

const clients = [
  { id: 'c1', name: 'Brandpreneur', color: 'text-blue-500', createdAt: 0, order: 0 },
];

const projects = [
  { id: 'p-gen', name: 'General', color: 'text-blue-500', clientId: 'c1', createdAt: 0, order: 0 },
];

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: () => ({
    getProjectById: (id: string | null) => projects.find((p) => p.id === id),
  }),
}));

vi.mock('../../stores/clientStore', () => ({
  useClientStore: () => ({
    getClientById: (id: string | null) => clients.find((c) => c.id === id),
  }),
}));

vi.mock('./TaskContextMenu', () => ({
  TaskContextMenu: () => null,
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Write brief',
    content: '',
    status: 'pending',
    importance: 'medium',
    date: '2026-09-14',
    projectId: 'p-gen',
    assignees: [],
    createdAt: 0,
    updatedAt: 0,
    order: 0,
    ...overrides,
  };
}

describe('TaskListItem', () => {
  beforeEach(() => {
    taskState.tasks = [makeTask()];
    updateTask.mockReset().mockImplementation(async (id: string, updates: Partial<Task>) => {
      taskState.tasks = taskState.tasks.map((task) => task.id === id ? { ...task, ...updates } : task);
    });
  });

  it('completes the task without opening the card or nesting buttons', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(<TaskListItem task={makeTask()} isActive={false} onClick={onClick} />);
    const doneButton = screen.getByRole('button', { name: 'Mark as completed' });
    expect(doneButton).toHaveTextContent('Done');
    expect(doneButton.querySelector('svg')).toBeNull();
    await user.click(doneButton);
    expect(updateTask).toHaveBeenCalledExactlyOnceWith('t1', { status: 'completed' });
    expect(onClick).not.toHaveBeenCalled();
    expect(container.querySelector('button button')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Completed: Write brief');
  });

  it('supports completing the task from the keyboard', async () => {
    updateTask.mockClear();
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<TaskListItem task={makeTask()} isActive={false} onClick={onClick} />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Mark as completed' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(updateTask).toHaveBeenCalledExactlyOnceWith('t1', { status: 'completed' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses a single text-only Done toggle on completed cards', () => {
    const { container } = render(<TaskListItem task={makeTask({ status: 'completed' })} isActive={false} onClick={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Mark as completed' })).not.toBeInTheDocument();
    expect(container.querySelector('.task-card')).toHaveClass('task-card--completed');
    expect(screen.getAllByText('Done')).toHaveLength(1);
    const doneButton = screen.getByRole('button', { name: 'Mark as incomplete' });
    expect(doneButton).toHaveTextContent('Done');
    expect(doneButton).toHaveAttribute('aria-pressed', 'true');
    expect(doneButton.querySelector('svg')).toBeNull();
    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
  });

  it('waits for persistence before celebrating and blocks repeat clicks during an optimistic update', async () => {
    const user = userEvent.setup();
    let finishUpdate: () => void = () => undefined;
    updateTask.mockImplementation(() => new Promise<void>((resolve) => {
      finishUpdate = resolve;
    }));
    const view = render(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined} />);
    const doneButton = screen.getByRole('button', { name: 'Mark as completed' });
    await user.click(doneButton);
    expect(doneButton).toBeDisabled();
    expect(doneButton).toHaveTextContent('Saving...');
    view.rerender(<TaskListItem task={makeTask({ status: 'completed' })} isActive={false} onClick={() => undefined} />);
    expect(view.container.querySelector('.task-card--celebrating')).toBeNull();
    await user.click(doneButton);
    expect(updateTask).toHaveBeenCalledTimes(1);

    taskState.tasks = [makeTask({ status: 'completed' })];
    await act(async () => finishUpdate());
    expect(view.container.querySelector('.task-card')).toHaveClass('task-card--completed', 'task-card--celebrating');
    expect(screen.getByRole('status')).toHaveTextContent('Completed: Write brief');
  });

  it('restores the previous in-progress status by clicking Done again without opening the task', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const task = makeTask({ status: 'in_progress' });
    taskState.tasks = [task];
    const view = render(<TaskListItem task={task} isActive={false} onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Mark as completed' }));
    view.rerender(<TaskListItem task={taskState.tasks[0]} isActive={false} onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Mark as incomplete' }));
    expect(updateTask).toHaveBeenLastCalledWith('t1', { status: 'in_progress' });
    expect(screen.getByRole('status')).toHaveTextContent('Reopened: Write brief');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps completion available and shows an error when the store rolls the update back', async () => {
    const user = userEvent.setup();
    updateTask.mockResolvedValue(undefined);
    const { container } = render(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Mark as completed' }));
    expect(screen.getByRole('alert')).toHaveTextContent(en.tasks.statusUpdateFailed);
    expect(screen.getByRole('button', { name: 'Mark as completed' })).toBeEnabled();
    expect(container.querySelector('.task-card--celebrating')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    updateTask.mockImplementation(async () => {
      taskState.tasks = [makeTask({ status: 'completed' })];
    });
    await user.click(screen.getByRole('button', { name: 'Mark as completed' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Completed: Write brief');
  });

  it('handles a rejected update without announcing success', async () => {
    const user = userEvent.setup();
    updateTask.mockRejectedValue(new Error('Storage unavailable'));
    render(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Mark as completed' }));
    expect(screen.getByRole('alert')).toHaveTextContent(en.tasks.statusUpdateFailed);
    expect(screen.getByRole('button', { name: 'Mark as completed' })).toBeEnabled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('opens the task once from the title, metadata, due date and empty card space', () => {
    const onClick = vi.fn();
    const { container } = render(<TaskListItem task={makeTask()} isActive={false} onClick={onClick} />);
    const card = container.querySelector('.task-card')!;
    const dueDate = container.querySelector('.task-item-due-date')!;
    expect(dueDate.parentElement).toHaveClass('row-xs');
    expect(dueDate.parentElement).toContainElement(screen.getByText('General'));
    expect(container.querySelector('.task-item-footer')).not.toBeInTheDocument();

    for (const target of [screen.getByText('Write brief'), screen.getByText('General'), dueDate, card]) {
      onClick.mockClear();
      fireEvent.click(target);
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  });

  it('formats due dates with Turkish abbreviated months', () => {
    render(<TaskListItem task={makeTask({ date: '2026-08-03' })} isActive={false} onClick={() => undefined} />);
    expect(screen.getByText('3.Ağu')).toBeInTheDocument();
  });

  it('keeps the task button accessible through Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<TaskListItem task={makeTask()} isActive={false} onClick={onClick} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Write brief/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('renders legacy children as ordinary task cards without subtask controls', () => {
    render(<TaskListItem task={makeTask({ parentTaskId: 'old-parent' })} isActive={false} onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: /Write brief/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Subtasks/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders client meta before project meta', () => {
    render(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined} />);

    const client = screen.getByText('Brandpreneur');
    const separator = screen.getByText('/');
    const project = screen.getByText('General');
    expect(client.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('falls back to Uncategorized when the project is missing', () => {
    render(
      <TaskListItem
        task={makeTask({ projectId: 'missing' })}
        isActive={false}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.queryByText('Brandpreneur')).not.toBeInTheDocument();
    expect(screen.queryByText('General')).not.toBeInTheDocument();
  });
});
