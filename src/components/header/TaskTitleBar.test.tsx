import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('TaskTitleBar', () => {
  it.each(['pending', 'completed'] as const)('omits completion controls for a %s task', (status) => {
    state.task = task({ status });
    render(<TaskTitleBar />);
    expect(screen.queryByRole('button', { name: /Mark as/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write brief' })).toBeInTheDocument();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('still renames the selected task', () => {
    render(<TaskTitleBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Write brief' }));
    const input = screen.getByRole('textbox', { name: 'Task title' });
    fireEvent.change(input, { target: { value: 'Updated brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateTask).toHaveBeenCalledWith('parent', { title: 'Updated brief' });
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
