import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskListItem } from './TaskListItem';
import type { Task } from '../../types';

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
  it('renders client meta before project meta', () => {
    render(<TaskListItem task={makeTask()} isActive={false} onClick={() => undefined} />);

    const client = screen.getByText('Brandpreneur');
    const project = screen.getByText('General');
    expect(client.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
