// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../services/db';
import { useUIStore } from './uiStore';
import { useTaskStore } from './taskStore';

describe('manual task relationships', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.clients.add({ id: 'c1', name: 'Client', color: '#fff', createdAt: 1, order: 0 });
    await db.projects.bulkAdd([
      { id: 'p1', clientId: 'c1', name: 'First', color: '#fff', createdAt: 1, order: 0 },
      { id: 'p2', clientId: 'c1', name: 'Second', color: '#fff', createdAt: 1, order: 1 },
    ]);
    useTaskStore.setState({ tasks: [], openTabs: [], openTaskIds: [],
      activeTaskId: null, activeTabId: null });
    vi.spyOn(useUIStore.getState(), 'showToast').mockImplementation(() => undefined);
  });

  it('persists a new one-level subtask and rejects an unsupported grandchild', async () => {
    const parent = await useTaskStore.getState().createTask('Parent', { projectId: 'p1' });
    expect(parent).not.toBeNull();
    const child = await useTaskStore.getState().createTask('Child', {
      projectId: 'p1', parentTaskId: parent!.id,
    });
    expect((await db.tasks.get(child!.id))?.parentTaskId).toBe(parent!.id);
    expect(await useTaskStore.getState().createTask('Grandchild', {
      projectId: 'p1', parentTaskId: child!.id,
    })).toBeNull();
    expect(await db.tasks.count()).toBe(2);
  });

  it('preserves project and deletion invariants and persists update revisions', async () => {
    const parent = await useTaskStore.getState().createTask('Parent', { projectId: 'p1' });
    const child = await useTaskStore.getState().createTask('Child', {
      projectId: 'p1', parentTaskId: parent!.id,
    });
    await useTaskStore.getState().updateTask(parent!.id, { projectId: 'p2' });
    await useTaskStore.getState().deleteTask(parent!.id);
    expect((await db.tasks.get(parent!.id))?.projectId).toBe('p1');
    expect((await db.tasks.get(parent!.id))?.deletedAt).toBeUndefined();
    const before = (await db.tasks.get(child!.id))!.updatedAt;
    await useTaskStore.getState().updateTask(child!.id, { title: 'Edited' });
    expect((await db.tasks.get(child!.id))?.updatedAt).toBeGreaterThan(before);
    expect((await db.tasks.get(child!.id))?.title).toBe('Edited');
    await useTaskStore.getState().deleteTask(child!.id);
    await useTaskStore.getState().deleteTask(parent!.id);
    expect((await db.tasks.get(parent!.id))?.deletedAt).toBeTypeOf('number');
  });
});
