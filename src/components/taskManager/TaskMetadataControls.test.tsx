import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskMetadataControls } from './TaskMetadataControls';

const updateTask = vi.fn();

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

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector?: (s: { activeTaskId: string }) => unknown) => {
    const state = { activeTaskId: 't1' };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector?: (s: {
    activeTaskId: string;
    tasks: typeof tasks;
    updateTask: typeof updateTask;
  }) => unknown) => {
    const state = { activeTaskId: 't1', tasks, updateTask };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector?: (s: { projects: typeof projects }) => unknown) => {
    const state = { projects };
    return selector ? selector(state) : state;
  },
}));

describe('TaskMetadataControls', () => {
  beforeEach(() => {
    updateTask.mockReset();
  });

  it('lists only projects for the task’s current client', async () => {
    const user = userEvent.setup();
    render(<TaskMetadataControls />);

    await user.click(screen.getByTitle('Change project'));

    expect(screen.getByRole('button', { name: 'Website' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uniforms' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'General' })).toHaveLength(2);
  });

  it('assigns a sibling project on the same client', async () => {
    const user = userEvent.setup();
    render(<TaskMetadataControls />);

    await user.click(screen.getByTitle('Change project'));
    await user.click(screen.getByRole('button', { name: 'Website' }));

    expect(updateTask).toHaveBeenCalledWith('t1', { projectId: 'p-web' });
    expect(updateTask).not.toHaveBeenCalledWith('t1', { projectId: 'p-gen-2' });
    expect(updateTask).not.toHaveBeenCalledWith('t1', { projectId: 'p-other' });
  });
});
