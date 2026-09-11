import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskContextMenu } from './TaskContextMenu';

const updateTask = vi.fn();
const deleteTask = vi.fn();
const createProject = vi.fn();

const tasks = [
  {
    id: 't1',
    title: 'Write brief',
    content: '',
    status: 'pending',
    importance: 'medium',
    date: '',
    projectId: 'p-gen',
    assignees: [],
    createdAt: 0,
    updatedAt: 0,
    order: 0,
  },
];

const projects = [
  { id: 'p-gen', name: 'General', color: 'text-blue-500', clientId: 'c1', createdAt: 0, order: 0 },
  { id: 'p-web', name: 'Website', color: 'text-amber-500', clientId: 'c1', createdAt: 0, order: 1 },
  { id: 'p-gen-2', name: 'General', color: 'text-emerald-500', clientId: 'c2', createdAt: 0, order: 0 },
  { id: 'p-other', name: 'Uniforms', color: 'text-rose-500', clientId: 'c2', createdAt: 0, order: 1 },
];

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector?: (s: {
    tasks: typeof tasks;
    updateTask: typeof updateTask;
    deleteTask: typeof deleteTask;
  }) => unknown) => {
    const state = { tasks, updateTask, deleteTask };
    return selector ? selector(state) : state;
  },
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

describe('TaskContextMenu', () => {
  beforeEach(() => {
    updateTask.mockReset();
    deleteTask.mockReset();
    createProject.mockReset();
  });

  it('lists only projects for the task’s current client', async () => {
    const user = userEvent.setup();
    render(<TaskContextMenu taskId="t1" x={0} y={0} onClose={() => undefined} />);

    await user.click(screen.getByRole('button', { name: /Assign Project/ }));

    expect(screen.getByRole('button', { name: /Website/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Uniforms/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /General/ })).toHaveLength(1);
  });

  it('does not assign a project from another client', async () => {
    const user = userEvent.setup();
    render(<TaskContextMenu taskId="t1" x={0} y={0} onClose={() => undefined} />);

    await user.click(screen.getByRole('button', { name: /Assign Project/ }));
    await user.click(screen.getByRole('button', { name: /Website/ }));

    expect(updateTask).toHaveBeenCalledWith('t1', { projectId: 'p-web' });
    expect(updateTask).not.toHaveBeenCalledWith('t1', { projectId: 'p-gen-2' });
    expect(updateTask).not.toHaveBeenCalledWith('t1', { projectId: 'p-other' });
  });
});
