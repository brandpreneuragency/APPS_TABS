import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../services/db';
import { useTaskStore } from './taskStore';
import { useUIStore } from './uiStore';

describe('kanban task placement', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.clients.add({ id: 'client', name: 'Client', color: '#fff', createdAt: 1, order: 0 });
    await db.projects.bulkAdd(['first', 'second'].map((id, order) => ({
      id, name: id, clientId: 'client', color: '#fff', createdAt: 1, order,
    })));
    useTaskStore.setState({ tasks: [], openTabs: [], activeTabId: null });
    vi.spyOn(useUIStore.getState(), 'showToast').mockImplementation(() => undefined);
  });

  it('persists same-column and cross-column placement with duplicate existing orders', async () => {
    const store = useTaskStore.getState();
    const first = (await store.createTask('First', { projectId: 'first' }))!;
    const second = (await store.createTask('Second', { projectId: 'first' }))!;
    const third = (await store.createTask('Third', { projectId: 'second' }))!;
    await db.tasks.update(second.id, { order: 0 });
    const [earlier, later] = [first, second].sort((left, right) => left.id.localeCompare(right.id));
    await store.updateTask(third.id, { projectId: 'first' }, { field: 'projectId', beforeId: later.id });
    const ordered = async () => (await db.tasks.toArray()).sort((left, right) => left.order - right.order).map((task) => task.id);
    expect(await ordered()).toEqual([earlier.id, third.id, later.id]);
    await store.updateTask(later.id, {}, { field: 'projectId', beforeId: earlier.id });
    expect(await ordered()).toEqual([later.id, earlier.id, third.id]);
    await store.refreshTasksFromDb();
    expect(useTaskStore.getState().tasks.find((task) => task.id === later.id)?.order).toBe(0);
  });

  it('reschedules and orders by day without changing project assignments or deleted tasks', async () => {
    const store = useTaskStore.getState();
    const first = (await store.createTask('First', { projectId: 'first', date: '2026-10-18' }))!;
    const second = (await store.createTask('Second', { projectId: 'second', date: '2026-10-19' }))!;
    const deleted = (await store.createTask('Deleted', { projectId: 'second', date: '2026-10-19' }))!;
    await db.tasks.update(deleted.id, { deletedAt: 1 });
    const deletedBefore = await db.tasks.get(deleted.id);
    await store.updateTask(first.id, { date: '2026-10-19' }, { field: 'date', beforeId: second.id });
    expect(await db.tasks.get(first.id)).toMatchObject({ projectId: 'first', date: '2026-10-19', order: 0 });
    expect(await db.tasks.get(second.id)).toMatchObject({ projectId: 'second', order: 1 });
    expect(await db.tasks.get(deleted.id)).toEqual(deletedBefore);
  });
});
