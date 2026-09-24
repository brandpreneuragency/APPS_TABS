import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Task } from '../../types';
import { TaskCalendarView } from './TaskCalendarView';

const updateTask = vi.fn().mockResolvedValue(undefined);
const openTaskInActiveTab = vi.fn();
const setActiveTaskPage = vi.fn();
const toggleAssistantWrapper = vi.fn();
const scrollIntoView = vi.fn();
vi.mock('../../stores/uiStore', () => ({ useUIStore: (selector?: (state: { setActiveTaskPage: typeof setActiveTaskPage; assistantWrapperOpen: boolean; toggleAssistantWrapper: typeof toggleAssistantWrapper; showToast: ReturnType<typeof vi.fn> }) => unknown) => {
  const state = { setActiveTaskPage, assistantWrapperOpen: true, toggleAssistantWrapper, showToast: vi.fn() };
  return selector ? selector(state) : state;
} }));
let selectedProjectId: string | null = null;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../../stores/taskStore', () => ({ useTaskStore: (selector?: (state: { activeTaskId: null; selectedClientId: null; selectedProjectId: string | null; updateTask: typeof updateTask; openTaskInActiveTab: typeof openTaskInActiveTab; createTask: ReturnType<typeof vi.fn> }) => unknown) => {
  const state = { activeTaskId: null, selectedClientId: null, selectedProjectId, updateTask, openTaskInActiveTab, createTask: vi.fn() };
  return selector ? selector(state) : state;
} }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (selector?: (state: { projects: unknown[] }) => unknown) => {
  const state = { projects: [] };
  return selector ? selector(state) : state;
} }));
vi.mock('../../stores/clientStore', () => ({ useClientStore: (selector?: (state: { clients: unknown[] }) => unknown) => {
  const state = { clients: [] };
  return selector ? selector(state) : state;
} }));
vi.mock('./TaskProjectsKanban', () => ({ TaskKanbanCard: ({ task, onClick }: { task: Task; onClick: (id: string) => void }) => <button onClick={() => onClick(task.id)}>{task.title}</button> }));
const task: Task = { id: 'task-1', title: 'Scheduled task', content: '', date: '2026-09-15', projectId: 'project-1', status: 'pending', importance: 'medium', assignees: [], createdAt: 1, updatedAt: 1, order: 0 };
const setup = (tasks = [task]) => {
  const onSetDate = vi.fn();
  render(<TaskCalendarView tasks={tasks} onPrefillText={vi.fn()} onSetDate={onSetDate} />);
  return onSetDate;
};

const chooseDate = (monthsAhead: number, dateLabel: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'calendar.chooseDate' }));
  const popup = screen.getByRole('dialog', { name: 'calendar.chooseDate' });
  for (let month = 0; month < monthsAhead; month++) {
    fireEvent.click(within(popup).getByRole('button', { name: 'calendar.nextMonth' }));
  }
  fireEvent.click(within(popup).getByRole('button', { name: dateLabel }));
};

describe('TaskCalendarView', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 15, 12)); selectedProjectId = null; vi.clearAllMocks(); });
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.useRealTimers();
  });

  it('places the shared assistant toggle beside the calendar view switch', () => {
    setup();
    const toggle = screen.getByRole('button', { name: 'Hide assistant' });
    expect(toggle).toHaveAttribute('id', 'task-calendar-btn-assistant');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'calendar.view' }).nextElementSibling).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggleAssistantWrapper).toHaveBeenCalledTimes(1);
  });

  it('starts with seven Monday-first days and opens and adds tasks on the exact local date', () => {
    const add = setup();
    expect(screen.getAllByRole('region')).toHaveLength(8);
    expect(screen.getByRole('region', { name: '2026-09-14' })).toBeInTheDocument();
    const day = screen.getByRole('region', { name: '2026-09-15' });
    fireEvent.click(within(day).getByText(task.title));
    expect(openTaskInActiveTab).toHaveBeenCalledWith(task.id);
    expect(setActiveTaskPage).toHaveBeenCalledWith('list');
    fireEvent.click(within(day).getByRole('button', { name: 'calendar.addTask 2026-09-15' }));
    expect(within(day).getByRole('textbox', { name: 'tasks.taskTitlePlaceholder' })).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('navigates weeks across year boundaries and returns to today', () => {
    setup();
    chooseDate(3, 'Thursday, December 31, 2026');
    expect(screen.getByRole('region', { name: '2027-01-03' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('calendar.nextWeek'));
    expect(screen.getByRole('region', { name: '2027-01-04' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'navigation.today' }));
    expect(screen.getByRole('region', { name: '2026-09-15' })).toBeInTheDocument();
  });

  it('shows complete month weeks including leap day and moves one month from month end', () => {
    setup();
    chooseDate(16, 'Monday, January 31, 2028');
    fireEvent.click(screen.getByText('calendar.month'));
    fireEvent.click(screen.getByLabelText('calendar.nextMonth'));
    expect(screen.getByRole('region', { name: '2028-02-29' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(36);
    fireEvent.click(screen.getByLabelText('calendar.previousMonth'));
    expect(screen.getByRole('region', { name: '2028-01-01' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'navigation.today' }));
    expect(screen.getByRole('button', { name: 'calendar.month' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('region')).toHaveLength(36);
    expect(screen.getByRole('region', { name: '2026-09-15' })).toHaveClass('task-calendar-day--today');
    expect(scrollIntoView.mock.instances.at(-1)).toBe(screen.getByRole('region', { name: '2026-09-15' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    fireEvent.click(screen.getByRole('button', { name: 'navigation.today' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('updates the live clock and current-day highlight and returns to today', () => {
    vi.setSystemTime(new Date(2026, 8, 15, 23, 59, 58));
    setup();
    expect(screen.getByRole('button', { name: 'navigation.today' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'navigation.today' })).getByText('Sep 15. Tue. 23:59:58')).toHaveAttribute('datetime', new Date().toISOString());

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Sep 15. Tue. 23:59:59')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Sep 16. Wed. 00:00:00')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '2026-09-15' })).not.toHaveClass('task-calendar-day--today');
    expect(screen.getByRole('region', { name: '2026-09-16' })).toHaveClass('task-calendar-day--today');

    fireEvent.click(screen.getByLabelText('calendar.nextWeek'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('region', { name: '2026-09-16' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'navigation.today' }));
    fireEvent.click(screen.getByRole('button', { name: 'calendar.chooseDate' }));
    expect(screen.getByRole('button', { name: 'Wednesday, September 16, 2026' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reschedules only recognized live tasks and changes only their date', () => {
    setup();
    const day = screen.getByRole('region', { name: '2026-09-16' });
    fireEvent.drop(day, { dataTransfer: { getData: () => task.id } });
    expect(updateTask).toHaveBeenCalledWith(task.id, { date: '2026-09-16' });
    fireEvent.drop(day, { dataTransfer: { getData: () => 'unknown' } });
    expect(updateTask).toHaveBeenCalledTimes(1);
  });

  it('preserves project scope and excludes deleted and undated tasks', () => {
    selectedProjectId = 'project-1';
    setup([task, { ...task, id: 'other', title: 'Other project', projectId: 'other' }, { ...task, id: 'deleted', title: 'Deleted', deletedAt: 1 }, { ...task, id: 'undated', title: 'Undated', date: '' }]);
    expect(screen.getByText(task.title)).toBeInTheDocument();
    expect(screen.queryByText('Other project')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
    expect(screen.queryByText('Undated')).not.toBeInTheDocument();
  });
});
