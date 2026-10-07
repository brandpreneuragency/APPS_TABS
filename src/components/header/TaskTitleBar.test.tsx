import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../types';
import en from '../../i18n/en';
import { TaskTitleBar } from './TaskTitleBar';

const { state, updateTask, toggleSubtaskSection, showToast } = vi.hoisted(() => ({
  state: { task: null as Task | null, taskMode: true, activeTaskPage: 'list', collapsed: false },
  updateTask: vi.fn(),
  toggleSubtaskSection: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => en.tasks[key.replace('tasks.', '') as keyof typeof en.tasks] ?? key }),
}));
vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector: (store: { tasks: Task[]; activeTaskId: string | null; updateTask: typeof updateTask }) => unknown) => selector({
    tasks: state.task ? [state.task] : [], activeTaskId: state.task?.id ?? null, updateTask,
  }),
}));
vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector?: (store: object) => unknown) => {
    const store = { taskMode: state.taskMode, activeTaskPage: state.activeTaskPage,
      subtaskSectionCollapsed: state.collapsed, toggleSubtaskSection, showToast };
    return selector ? selector(store) : store;
  },
}));
vi.mock('../taskManager/TaskMetadataControls', () => ({
  TaskClientProjectControls: () => null,
  TaskDueDateControl: () => null,
}));

function task(overrides: Partial<Task> = {}): Task {
  return { id: 'parent', title: 'Write brief', content: '', status: 'pending', importance: 'medium',
    date: '', projectId: 'project', assignees: [], createdAt: 1, updatedAt: 1, order: 0, ...overrides };
}

beforeEach(() => {
  state.task = task();
  state.taskMode = true;
  state.activeTaskPage = 'list';
  state.collapsed = false;
  updateTask.mockReset().mockResolvedValue(undefined);
  toggleSubtaskSection.mockReset();
  showToast.mockReset();
});

describe('TaskTitleBar completion', () => {
  it('completes the selected task without subtask controls', async () => {
    render(<TaskTitleBar />);
    const complete = screen.getByRole('button', { name: 'Mark as completed' });
    expect(complete).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(complete);
    expect(updateTask).toHaveBeenCalledWith('parent', { status: 'completed' });
    expect(toggleSubtaskSection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Collapse subtasks' })).not.toBeInTheDocument();
    await waitFor(() => expect(complete).toBeEnabled());
  });

  it('reopens a completed parent with the previous in-progress behavior using the keyboard', async () => {
    state.task = task({ status: 'completed' });
    const user = userEvent.setup();
    render(<TaskTitleBar />);
    const reopen = screen.getByRole('button', { name: 'Mark as incomplete' });
    expect(reopen).toHaveAttribute('aria-pressed', 'true');
    reopen.focus();
    await user.keyboard('{Enter}');
    expect(updateTask).toHaveBeenCalledWith('parent', { status: 'in_progress' });
    await waitFor(() => expect(reopen).toBeEnabled());
  });

  it('reflects the selected task status after a store refresh', async () => {
    const view = render(<TaskTitleBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as completed' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as completed' })).toBeEnabled());
    state.task = task({ status: 'completed' });
    view.rerender(<TaskTitleBar />);
    expect(screen.getByRole('button', { name: 'Mark as incomplete' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables duplicate completion writes while a status update is pending', async () => {
    let finish: () => void = () => undefined;
    updateTask.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<TaskTitleBar />);
    const complete = screen.getByRole('button', { name: 'Mark as completed' });
    fireEvent.click(complete);
    expect(complete).toBeDisabled();
    fireEvent.click(complete);
    expect(updateTask).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(complete).toBeEnabled();
  });

  it('keeps pending status writes scoped to the task selected when each action starts', async () => {
    const finishers: Array<() => void> = [];
    updateTask.mockImplementation(() => new Promise<void>((resolve) => { finishers.push(() => resolve()); }));
    const view = render(<TaskTitleBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as completed' }));

    state.task = task({ id: 'next' });
    view.rerender(<TaskTitleBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as completed' }));

    expect(updateTask).toHaveBeenNthCalledWith(1, 'parent', { status: 'completed' });
    expect(updateTask).toHaveBeenNthCalledWith(2, 'next', { status: 'completed' });
    await act(async () => { finishers.forEach((finish) => finish()); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as completed' })).toBeEnabled());
  });

  it('shows a local error and unlocks the status action when a write rejects', async () => {
    updateTask.mockRejectedValueOnce(new Error('Task storage unavailable'));
    render(<TaskTitleBar />);
    const complete = screen.getByRole('button', { name: 'Mark as completed' });

    fireEvent.click(complete);

    await waitFor(() => expect(complete).toBeEnabled());
    expect(showToast).toHaveBeenCalledWith('Task storage unavailable', 'error');
  });

  it('lets a selected subtask change status without rendering a parent disclosure', async () => {
    state.task = task({ id: 'child', parentTaskId: 'parent' });
    render(<TaskTitleBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as completed' }));
    expect(updateTask).toHaveBeenCalledWith('child', { status: 'completed' });
    expect(screen.queryByRole('button', { name: 'Collapse subtasks' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as completed' })).toBeEnabled());
  });

  it('does not offer a completion action without a selected task', () => {
    state.task = null;
    render(<TaskTitleBar />);
    expect(screen.queryByRole('button', { name: /Mark as/ })).not.toBeInTheDocument();
  });

  it('does not render task actions outside the task detail scope', () => {
    state.taskMode = false;
    const view = render(<TaskTitleBar />);
    expect(view.container).toBeEmptyDOMElement();
    state.taskMode = true;
    state.activeTaskPage = 'projects';
    view.rerender(<TaskTitleBar />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
