import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../services/db';
import { useTaskStore } from '../../stores/taskStore';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import en from '../../i18n/en';
import { TaskListItem } from './TaskListItem';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, values?: { title: string }) =>
    (en.tasks[key.replace('tasks.', '') as keyof typeof en.tasks] ?? key)
      .replace('{{title}}', values?.title ?? '') }),
}));

vi.mock('./TaskContextMenu', () => ({ TaskContextMenu: () => null }));

function TaskCard() {
  const task = useTaskStore((state) => state.tasks.find((item) => item.id === 'completion-task'));
  return task ? <TaskListItem task={task} isActive={false} onClick={() => undefined} /> : null;
}

describe('TaskListItem persistence', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
    await db.open();
    const client = { id: 'completion-client', name: 'Client', color: '#fff', createdAt: 1, order: 0 };
    const project = { id: 'completion-project', clientId: client.id, name: 'Project', color: '#fff', createdAt: 1, order: 0 };
    await db.clients.add(client);
    await db.projects.add(project);
    await db.tasks.add({
      id: 'completion-task', title: 'Finish the brief', content: '', status: 'in_progress',
      importance: 'medium', date: '2026-10-12', projectId: project.id, assignees: [],
      createdAt: 1, updatedAt: 1, order: 0,
    });
    useClientStore.setState({ clients: [client] });
    useProjectStore.setState({ projects: [project] });
    useTaskStore.setState({ tasks: [], openTabs: [], openTaskIds: [], activeTaskId: null, activeTabId: null });
    vi.spyOn(useUIStore.getState(), 'showToast').mockImplementation(() => undefined);
    await useTaskStore.getState().refreshTasksFromDb();
  });

  it('saves completion, restores the previous status through Undo and keeps Done after reloading the cache', async () => {
    const user = userEvent.setup();
    const view = render(<TaskCard />);
    await user.click(screen.getByRole('button', { name: en.tasks.completeTask }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Completed: Finish the brief'));
    expect((await db.tasks.get('completion-task'))?.status).toBe('completed');
    expect(view.container.querySelector('.task-card')).toHaveClass('task-card--completed');

    await user.click(screen.getByRole('button', { name: en.tasks.reopenTask }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reopened: Finish the brief'));
    expect((await db.tasks.get('completion-task'))?.status).toBe('in_progress');

    await user.click(screen.getByRole('button', { name: en.tasks.completeTask }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Completed: Finish the brief'));
    view.unmount();
    await act(async () => {
      useTaskStore.setState({ tasks: [] });
      await useTaskStore.getState().refreshTasksFromDb();
    });
    const reloaded = render(<TaskCard />);
    expect(reloaded.container.querySelector('.task-card')).toHaveClass('task-card--completed');
    expect(screen.getByRole('button', { name: en.tasks.reopenTask })).toHaveTextContent('Done');
    expect(reloaded.container.querySelector('.task-card--celebrating')).toBeNull();
  });

  it('rolls a failed write back, shows the error and persists a successful retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(db.tasks, 'put').mockImplementationOnce(() => { throw new Error('Write unavailable'); });
    const { container } = render(<TaskCard />);
    await user.click(screen.getByRole('button', { name: en.tasks.completeTask }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.tasks.statusUpdateFailed);
    expect((await db.tasks.get('completion-task'))?.status).toBe('in_progress');
    expect(container.querySelector('.task-card--celebrating')).toBeNull();
    expect(screen.getByRole('button', { name: en.tasks.completeTask })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: en.tasks.completeTask }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Completed: Finish the brief'));
    expect((await db.tasks.get('completion-task'))?.status).toBe('completed');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
