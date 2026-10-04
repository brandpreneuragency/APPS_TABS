import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskListPanel } from './TaskListPanel';
import en from '../../i18n/en';

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
  {
    id: 'child', title: 'Child brief', parentTaskId: 't1', projectId: 'p-gen', date: today,
    status: 'pending' as const, importance: 'medium' as const, content: '', assignees: [] as string[],
    createdAt: 1, updatedAt: 1, order: 3,
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => en.tasks[key.replace('tasks.', '') as keyof typeof en.tasks] ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('./QuickCreateInput', () => ({
  QuickCreateInput: () => <textarea aria-label="Add a task" data-testid="quick-create" />,
}));

vi.mock('./TaskCalendarView', () => ({
  TaskCalendarView: () => <div data-testid="task-calendar-view" />,
}));

vi.mock('./TaskProjectView', () => ({
  TaskProjectView: () => <div data-testid="task-project-view" />,
}));

vi.mock('./TaskListItem', () => ({
  TaskListItem: ({ task, onClick, subtasks }: {
    task: { id: string; title: string }; onClick: () => void; subtasks: { id: string; title: string }[];
  }) => (
    <div>
      <button data-testid={`task-${task.id}`} onClick={onClick}>{task.title}</button>
      {subtasks.map((subtask) => <span key={subtask.id} data-testid={`child-of-${task.id}`}>{subtask.title}</span>)}
    </div>
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

  it('passes subtasks to their parent instead of rendering standalone task cards', () => {
    render(<TaskListPanel />);
    expect(screen.queryByTestId('task-child')).not.toBeInTheDocument();
    expect(screen.getByTestId('child-of-t1')).toHaveTextContent('Child brief');
  });

  it('shows the scoped task list immediately without another client tab', async () => {
    const user = userEvent.setup();
    render(<TaskListPanel />);
    expect(screen.queryByRole('tab', { name: 'Clients' })).not.toBeInTheDocument();
    expect(screen.getByTestId('task-t1')).toBeVisible();
    expect(screen.getByTestId('task-t2')).toBeVisible();
    expect(screen.queryByTestId('task-t3')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('task-t1'));
    expect(openTaskInActiveTab).toHaveBeenCalledWith('t1');
  });

  it('filters to a project selected in the second column', () => {
    selectedProjectId = 'p-web';
    render(<TaskListPanel />);
    expect(screen.getByTestId('task-t2')).toBeVisible();
    expect(screen.queryByTestId('task-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t3')).not.toBeInTheDocument();
  });

  it('shows every client when Everything is selected', () => {
    selectedClientId = null;
    render(<TaskListPanel />);
    expect(screen.getByTestId('task-t1')).toBeVisible();
    expect(screen.getByTestId('task-t3')).toBeVisible();
  });

  it('hides the composer on Calendar and preserves its draft between views', async () => {
    const user = userEvent.setup();
    const view = render(<TaskListPanel />);
    const composer = screen.getByRole('textbox', { name: 'Add a task' });
    const calendar = screen.getByTestId('task-calendar-view');
    expect(composer).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(composer, 'Keep this draft');
    activeTaskPage = 'calendar';
    view.rerender(<TaskListPanel />);
    expect(calendar).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-t1')).not.toBeVisible();
    expect(screen.getByTestId('quick-create')).toBe(composer);
    expect(composer).not.toBeVisible();
    expect(composer.closest('#task-quick-create-footer')).not.toBeVisible();
    expect(composer).toHaveValue('Keep this draft');
    activeTaskPage = 'list';
    view.rerender(<TaskListPanel />);
    expect(calendar).not.toBeVisible();
    expect(composer).toBeVisible();
    expect(composer).toHaveValue('Keep this draft');
  });

  it('shows the live clock on Task List and removes it on Calendar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 23, 59, 58));
    try {
      const view = render(<TaskListPanel />);
      expect(screen.getByText('Sep 15. Tue. 23:59:58')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByText('Sep 16. Wed. 00:00:00')).toBeInTheDocument();

      activeTaskPage = 'calendar';
      view.rerender(<TaskListPanel />);
      expect(screen.queryByText('Sep 16. Wed. 00:00:00')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
