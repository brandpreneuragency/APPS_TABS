import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskListPanel } from './TaskListPanel';

const today = new Date().toISOString().slice(0, 10);

const tasks = [
  {
    id: 't1',
    title: 'General task',
    projectId: 'p-gen',
    date: today,
    status: 'pending' as const,
    importance: 'medium' as const,
    content: '',
    assignees: [] as string[],
    createdAt: 1,
    updatedAt: 1,
    order: 0,
  },
  {
    id: 't2',
    title: 'Website task',
    projectId: 'p-web',
    date: today,
    status: 'pending' as const,
    importance: 'medium' as const,
    content: '',
    assignees: [] as string[],
    createdAt: 1,
    updatedAt: 1,
    order: 1,
  },
  {
    id: 't3',
    title: 'Other task',
    projectId: 'p-other',
    date: today,
    status: 'pending' as const,
    importance: 'medium' as const,
    content: '',
    assignees: [] as string[],
    createdAt: 1,
    updatedAt: 1,
    order: 2,
  },
];

const projects = [
  { id: 'p-gen', name: 'General', color: 'c1', clientId: 'c1' },
  { id: 'p-web', name: 'Website', color: 'c1b', clientId: 'c1' },
  { id: 'p-other', name: 'Other', color: 'c2', clientId: 'c2' },
];

let selectedClientId: string | null = 'c1';
let selectedProjectId: string | null = null;
let activeTaskPage: 'list' | 'calendar' | 'projects' = 'list';
const openTaskInActiveTab = vi.fn();

vi.mock('./ClientProjectTree', () => ({
  ClientProjectTree: () => <div data-testid="client-project-tree" />,
}));

vi.mock('./QuickCreateInput', () => ({
  QuickCreateInput: () => <div data-testid="quick-create" />,
}));

vi.mock('./TaskCalendarView', () => ({
  TaskCalendarView: () => <div data-testid="task-calendar-view" />,
}));

vi.mock('./TaskProjectView', () => ({
  TaskProjectView: () => <div data-testid="task-project-view" />,
}));

vi.mock('./TaskListItem', () => ({
  TaskListItem: ({ task }: { task: { id: string; title: string } }) => (
    <div data-testid={`task-${task.id}`}>{task.title}</div>
  ),
}));

vi.mock('../../stores/taskStore', () => {
  const useTaskStore = Object.assign(
    (selector?: (s: {
      tasks: typeof tasks;
      activeTaskId: string | null;
      selectedClientId: string | null;
      selectedProjectId: string | null;
      openTaskInActiveTab: typeof openTaskInActiveTab;
    }) => unknown) => {
      const state = {
        tasks,
        activeTaskId: null,
        selectedClientId,
        selectedProjectId,
        openTaskInActiveTab,
      };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ openTaskInActiveTab }) },
  );
  return { useTaskStore };
});

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector: (s: { projects: typeof projects }) => unknown) =>
    selector({ projects }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { activeTaskPage: typeof activeTaskPage }) => unknown) =>
    selector({ activeTaskPage }),
}));

describe('TaskListPanel', () => {
  beforeEach(() => {
    selectedClientId = 'c1';
    selectedProjectId = null;
    activeTaskPage = 'list';
    openTaskInActiveTab.mockReset();
  });

  it('always renders the client/project tree and quick create', () => {
    render(<TaskListPanel />);
    expect(screen.getByTestId('client-project-tree')).toBeInTheDocument();
    expect(screen.getByTestId('quick-create')).toBeInTheDocument();
  });

  it('filters the date-grouped list to the selected client', () => {
    render(<TaskListPanel />);
    expect(screen.getByTestId('task-t1')).toBeInTheDocument();
    expect(screen.getByTestId('task-t2')).toBeInTheDocument();
    expect(screen.queryByTestId('task-t3')).not.toBeInTheDocument();
  });

  it('filters the date-grouped list to the selected project', () => {
    selectedProjectId = 'p-web';
    render(<TaskListPanel />);
    expect(screen.getByTestId('task-t2')).toBeInTheDocument();
    expect(screen.queryByTestId('task-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t3')).not.toBeInTheDocument();
  });

  it('keeps the tree above the calendar view', () => {
    activeTaskPage = 'calendar';
    render(<TaskListPanel />);
    expect(screen.getByTestId('client-project-tree')).toBeInTheDocument();
    expect(screen.getByTestId('task-calendar-view')).toBeInTheDocument();
    expect(screen.getByTestId('quick-create')).toBeInTheDocument();
  });
});
