import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskListItem } from './TaskListItem';
import type { Task } from '../../types';

const { activeTask, openTask, updateTask } = vi.hoisted(() => ({
  activeTask: { id: 'child' as string | null }, openTask: vi.fn(), updateTask: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: { title: string }) =>
    key === 'tasks.subtasks' ? 'Subtasks' : `Complete subtask: ${values?.title}` }),
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector: (state: object) => unknown) => selector({
    activeTaskId: activeTask.id, openTaskInActiveTab: openTask, updateTask,
  }),
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
  it('keeps subtasks attached and collapses without opening the parent', () => {
    const onClick = vi.fn();
    const { container } = render(<TaskListItem task={makeTask()} isActive={false} onClick={onClick}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1' })]} />);
    const disclosure = screen.getByRole('button', { name: 'Subtasks 0/1' });
    expect(disclosure.parentElement).toHaveClass('task-item-footer');
    expect(disclosure.closest('.task-card')).not.toBeNull();
    expect(container.querySelectorAll('.task-item')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Child brief' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Child brief' })).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(disclosure);
    expect(screen.getByRole('button', { name: 'Child brief' })).toBeVisible();
  });

  it('opens and completes the child independently of the parent', async () => {
    openTask.mockClear();
    updateTask.mockClear();
    const onClick = vi.fn();
    render(<TaskListItem task={makeTask()} isActive={false} onClick={onClick}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Child brief' }));
    expect(openTask).toHaveBeenCalledWith('child');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete subtask: Child brief' }));
    expect(updateTask).toHaveBeenCalledWith('child', { status: 'completed' });
    expect(onClick).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  });

  it('updates the counter when a subtask is added and allows reopening a completed subtask', async () => {
    updateTask.mockClear();
    const view = render(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Subtasks/ })).not.toBeInTheDocument();
    view.rerender(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1', status: 'completed' })]} />);
    expect(screen.getByRole('button', { name: 'Subtasks 1/1' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(updateTask).toHaveBeenCalledWith('child', { status: 'pending' });
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  });

  it('collapses subtasks when another task becomes active', async () => {
    activeTask.id = 't1';
    const view = render(<TaskListItem task={makeTask()} isActive={true} onClick={() => undefined}
      subtasks={[makeTask({ id: 'other-child', title: 'Child brief', parentTaskId: 't1' })]} />);
    const disclosure = screen.getByRole('button', { name: 'Subtasks 0/1' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    activeTask.id = 'other-task';
    view.rerender(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1' })]} />);

    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'false'));
  });

  it('keeps subtasks expanded when a subtask becomes active', () => {
    activeTask.id = 't1';
    const view = render(<TaskListItem task={makeTask()} isActive={true} onClick={() => undefined}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1' })]} />);
    const disclosure = screen.getByRole('button', { name: 'Subtasks 0/1' });

    activeTask.id = 'child';
    view.rerender(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1' })]} />);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    activeTask.id = 'other-task';
    view.rerender(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined}
      subtasks={[makeTask({ id: 'child', title: 'Child brief', parentTaskId: 't1' })]} />);

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
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
