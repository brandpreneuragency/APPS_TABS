// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { applyTaskDraft, undoTaskDraft } from './taskDraftCommands';
import type { Task, TaskAIDraft } from '../types';

const root: Task = { id: 'root', title: 'Original', content: '', status: 'pending',
  importance: 'medium', date: '2026-09-23', projectId: 'project', assignees: [],
  createdAt: 1, updatedAt: 10, order: 0 };

function draft(operations: TaskAIDraft['operations']): TaskAIDraft {
  return { id: 'draft-1', taskId: root.id, scope: 'active_task', assistantMessage: '',
    summary: 'Draft', operations, createdAt: 11, baselineUpdatedAt: { root: 10 },
    validation: { errors: [], warnings: [], duplicateSubtasks: [], staleTaskIds: [] } };
}

describe('task draft transactions and undo', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.clients.add({ id: 'client', name: 'Client', color: '#fff', createdAt: 1, order: 0 });
    await db.projects.add({ id: 'project', clientId: 'client', name: 'Project', color: '#fff', createdAt: 1, order: 0 });
    await db.tasks.add(root);
  });

  it('applies once and restores exact task and comment effects on undo', async () => {
    const proposed = draft([
      { id: 'child', type: 'create_task', title: 'Follow up', projectId: 'project' },
      { id: 'edit', type: 'update_task', taskId: 'root', updates: { title: 'Updated' } },
      { id: 'comment', type: 'add_comment', taskId: 'root', text: 'Review this' },
    ]);
    const first = await applyTaskDraft('message-1', proposed);
    const second = await applyTaskDraft('message-1', proposed);
    expect(second.id).toBe(first.id);
    expect(await db.tasks.count()).toBe(2);
    expect((await db.tasks.get('child'))?.parentTaskId).toBe('root');
    expect((await db.tasks.get('root'))?.title).toBe('Updated');
    expect(await db.taskComments.count()).toBe(1);
    await undoTaskDraft(first.id);
    expect(await db.tasks.get('child')).toBeUndefined();
    expect((await db.tasks.get('root'))?.title).toBe('Original');
    expect((await db.tasks.get('root'))!.updatedAt).toBeGreaterThan(first.taskEffects!.find((effect) => effect.id === 'root')!.after!.updatedAt);
    expect(await db.taskComments.count()).toBe(0);
    await undoTaskDraft(first.id);
    expect(await db.tasks.count()).toBe(1);
    await expect(applyTaskDraft('message-1', proposed)).rejects.toThrow('already undone');
    expect(await db.tasks.count()).toBe(1);
  });

  it('rolls back every operation when a later operation is invalid', async () => {
    const proposed = draft([
      { id: 'child', type: 'create_task', title: 'Follow up', projectId: 'project' },
      { id: 'bad', type: 'update_task', taskId: 'outside', updates: { title: 'Bad' } },
    ]);
    await expect(applyTaskDraft('message-1', proposed)).rejects.toThrow('Task is unavailable');
    expect(await db.tasks.get('child')).toBeUndefined();
    expect(await db.taskAIChangeBatches.count()).toBe(0);
  });

  it('rejects a stale undo without overwriting later manual work', async () => {
    const saved = await applyTaskDraft('message-1', draft([
      { id: 'edit', type: 'update_task', taskId: 'root', updates: { title: 'Updated' } },
    ]));
    await db.tasks.update('root', { title: 'Later edit', updatedAt: 9999999999999 });
    await expect(undoTaskDraft(saved.id)).rejects.toThrow('changed after this draft');
    expect((await db.tasks.get('root'))?.title).toBe('Later edit');
    expect((await db.taskAIChangeBatches.get(saved.id))?.undoneAt).toBeUndefined();
  });
});
