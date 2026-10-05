import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
