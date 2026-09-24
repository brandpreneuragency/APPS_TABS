import { db } from './db';
import { assertSubtaskParent, assertTaskSoftDelete } from './taskRelations';
import { syncCodexTaskProjection } from '../stores/taskStore';
import { TASK_TITLE_MAX_LENGTH } from '../types';
import type { Task, TaskAIChangeBatch, TaskAIDraft, TaskComment } from '../types';

type TaskEffect = NonNullable<TaskAIChangeBatch['taskEffects']>[number];
type CommentEffect = NonNullable<TaskAIChangeBatch['commentEffects']>[number];

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function revision(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

function validTitle(value: string): string {
  const title = value.trim();
  if (!title || title.length > TASK_TITLE_MAX_LENGTH) throw new Error('Invalid task title');
  return title;
}

function inDraftScope(task: Task, root: Task): void {
  if (task.projectId !== root.projectId || (task.id !== root.id && task.parentTaskId !== root.id)) {
    throw new Error('Task is outside this draft’s active task');
  }
}

function validPatch(updates: Record<string, unknown>): Partial<Task> {
  const keys = Object.keys(updates);
  if (!keys.length || keys.some((key) => !['title', 'content', 'status', 'importance', 'date', 'projectId', 'assignees'].includes(key))) {
    throw new Error('Unsupported task draft update');
  }
  const patch: Partial<Task> = {};
  if (updates.title !== undefined) {
    if (typeof updates.title !== 'string') throw new Error('Invalid task title');
    patch.title = validTitle(updates.title);
  }
  if (updates.content !== undefined) {
    if (typeof updates.content !== 'string' || updates.content.length > 256 * 1024) throw new Error('Invalid task content');
    patch.content = updates.content;
  }
  if (updates.status !== undefined) {
    if (!['pending', 'in_progress', 'completed'].includes(String(updates.status))) throw new Error('Invalid task status');
    patch.status = updates.status as Task['status'];
  }
  if (updates.importance !== undefined) {
    if (!['low', 'medium', 'high'].includes(String(updates.importance))) throw new Error('Invalid task importance');
    patch.importance = updates.importance as Task['importance'];
  }
  if (updates.date !== undefined) {
    if (typeof updates.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(updates.date)) throw new Error('Invalid task date');
    patch.date = updates.date;
  }
  if (updates.assignees !== undefined) {
    if (!Array.isArray(updates.assignees) || updates.assignees.some((id) => typeof id !== 'string')) {
      throw new Error('Invalid task assignees');
    }
    patch.assignees = updates.assignees;
  }
  if (updates.projectId !== undefined) {
    if (typeof updates.projectId !== 'string') throw new Error('Invalid task project');
    patch.projectId = updates.projectId;
  }
  return patch;
}

async function projectBatch(batch: TaskAIChangeBatch, undo: boolean): Promise<void> {
  const field = undo ? 'undoProjectionState' : 'projectionState';
  if (batch[field] === 'complete') return;
  for (const effect of batch.taskEffects ?? []) {
    const desired = undo ? await db.tasks.get(effect.id) : effect.after;
    const previous = undo ? effect.after : effect.before;
    if (desired) await syncCodexTaskProjection(desired, previous ?? undefined);
    else if (previous) {
      await syncCodexTaskProjection({ ...previous, deletedAt: Date.now() }, previous);
    }
  }
  if (undo) await db.taskAIChangeBatches.update(batch.id, { undoProjectionState: 'complete' });
  else await db.taskAIChangeBatches.update(batch.id, { projectionState: 'complete' });
}

/** Persist a legacy visible draft and its exact undo data in one database transaction. */
export async function applyTaskDraft(messageId: string, draft: TaskAIDraft): Promise<TaskAIChangeBatch> {
  if (draft.validation.errors.length || draft.needsScopeConfirmation || !draft.operations.length) {
    throw new Error('This task draft is not ready to apply');
  }
  const batch = await db.transaction('rw', db.tasks, db.taskComments, db.taskAIChangeBatches, db.projects, async () => {
    const existing = await db.taskAIChangeBatches.get(draft.id);
    if (existing) {
      if (existing.appliedByMessageId !== messageId || !same(existing.operations, draft.operations)) {
        throw new Error('A different task draft already uses this ID');
      }
      if (existing.undoneAt) throw new Error('This task draft was already undone');
      return existing;
    }
    const root = await db.tasks.get(draft.taskId);
    if (!root || root.deletedAt || root.parentTaskId || !await db.projects.get(root.projectId)) {
      throw new Error('The active task is unavailable');
    }
    for (const [id, expected] of Object.entries(draft.baselineUpdatedAt)) {
      const current = await db.tasks.get(id);
      if (!current || current.updatedAt !== expected) throw new Error('Task data changed; regenerate the draft');
    }
    const taskEffects = new Map<string, TaskEffect>();
    const commentEffects = new Map<string, CommentEffect>();
    const markTask = (id: string, before: Task | null, after: Task | null) => {
      const first = taskEffects.get(id);
      taskEffects.set(id, { id, before: first ? first.before : before, after });
    };
    const markComment = (id: string, before: TaskComment | null, after: TaskComment | null) => {
      const first = commentEffects.get(id);
      commentEffects.set(id, { id, before: first ? first.before : before, after });
    };
    const operationIds = new Set<string>();
    for (const operation of draft.operations) {
      if (operationIds.has(operation.id)) throw new Error('Duplicate draft operation ID');
      operationIds.add(operation.id);
      if (operation.type === 'create_task') {
        if (operation.projectId !== root.projectId || await db.tasks.get(operation.id)) {
          throw new Error('New subtask conflicts with the active task');
        }
        assertSubtaskParent(await db.tasks.get(root.id), operation.projectId);
        const now = Date.now();
        const task: Task = { id: operation.id, title: validTitle(operation.title),
          content: operation.content ?? '', status: operation.status ?? 'pending',
          importance: operation.importance ?? 'medium', date: operation.date ?? new Date().toISOString().slice(0, 10),
          projectId: root.projectId, parentTaskId: root.id, assignees: operation.assignees ?? [],
          createdAt: now, updatedAt: now, order: await db.tasks.where('projectId').equals(root.projectId).count(),
          sourceChatMessageId: messageId };
        if (typeof task.content !== 'string' || task.content.length > 256 * 1024
          || !['pending', 'in_progress', 'completed'].includes(task.status)
          || !['low', 'medium', 'high'].includes(task.importance)
          || !/^\d{4}-\d{2}-\d{2}$/.test(task.date)
          || !Array.isArray(task.assignees) || task.assignees.some((id) => typeof id !== 'string')) {
          throw new Error('Invalid new subtask');
        }
        await db.tasks.add(task);
        markTask(task.id, null, task);
      } else if (operation.type === 'add_comment') {
        const task = await db.tasks.get(operation.taskId);
        if (!task || task.deletedAt) throw new Error('Comment target is unavailable');
        inDraftScope(task, root);
        if (!operation.text.trim() || operation.text.length > 8 * 1024) throw new Error('Invalid comment');
        const id = `${draft.id}:${operation.id}`;
        if (await db.taskComments.get(id)) throw new Error('Comment ID already exists');
        const comment: TaskComment = { id, taskId: task.id, text: operation.text, sender: 'Assistant', createdAt: Date.now() };
        await db.taskComments.add(comment);
        markComment(id, null, comment);
      } else if (operation.type === 'delete_comment') {
        const comment = await db.taskComments.get(operation.commentId);
        if (!comment || comment.taskId !== operation.taskId) throw new Error('Comment is unavailable');
        const task = await db.tasks.get(comment.taskId);
        if (!task) throw new Error('Comment task is unavailable');
        inDraftScope(task, root);
        await db.taskComments.delete(comment.id);
        markComment(comment.id, comment, null);
      } else {
        const task = await db.tasks.get(operation.taskId);
        if (!task) throw new Error('Task is unavailable');
        inDraftScope(task, root);
        if (draft.baselineUpdatedAt[task.id] === undefined && !taskEffects.has(task.id)) {
          throw new Error('Task revision is missing from the draft');
        }
        let after: Task;
        if (operation.type === 'update_task') {
          if (task.deletedAt) throw new Error('Task is deleted');
          const patch = validPatch(operation.updates);
          if (patch.projectId !== undefined && patch.projectId !== root.projectId) {
            throw new Error('This draft cannot move a task outside the active project');
          }
          after = { ...task, ...patch, updatedAt: revision(task.updatedAt) };
        } else if (operation.type === 'soft_delete_task') {
          if (task.deletedAt) throw new Error('Task is already deleted');
          assertTaskSoftDelete(await db.tasks.where('parentTaskId').equals(task.id)
            .filter((child) => !child.deletedAt).count());
          after = { ...task, deletedAt: Date.now(), updatedAt: revision(task.updatedAt) };
        } else {
          if (!task.deletedAt) throw new Error('Task is already active');
          if (task.parentTaskId) assertSubtaskParent(await db.tasks.get(task.parentTaskId), task.projectId);
          after = { ...task, deletedAt: undefined, updatedAt: revision(task.updatedAt) };
        }
        await db.tasks.put(after);
        markTask(task.id, task, after);
      }
    }
    const now = Date.now();
    const saved: TaskAIChangeBatch = { id: draft.id, taskId: root.id, summary: draft.summary,
      operations: draft.operations, inverseOperations: [], appliedByMessageId: messageId,
      taskEffects: [...taskEffects.values()], commentEffects: [...commentEffects.values()],
      projectionState: 'pending', createdAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000 };
    await db.taskAIChangeBatches.add(saved);
    return saved;
  });
  await projectBatch(batch, false);
  return (await db.taskAIChangeBatches.get(batch.id))!;
}

/** Undo only while every affected row still matches the recorded result. */
export async function undoTaskDraft(batchId: string): Promise<TaskAIChangeBatch> {
  const batch = await db.transaction('rw', db.tasks, db.taskComments, db.taskAIChangeBatches, async () => {
    const current = await db.taskAIChangeBatches.get(batchId);
    if (!current) throw new Error('Task draft history is missing');
    if (!current.taskEffects || !current.commentEffects) {
      throw new Error('This older draft has no safe undo snapshot');
    }
    if (current.undoneAt) return current;
    if (current.expiresAt < Date.now()) throw new Error('The task draft undo window expired');
    for (const effect of current.taskEffects) {
      if (!same((await db.tasks.get(effect.id)) ?? null, effect.after)) {
        throw new Error('A task changed after this draft; undo requires review');
      }
    }
    for (const effect of current.commentEffects) {
      if (!same((await db.taskComments.get(effect.id)) ?? null, effect.after)) {
        throw new Error('A comment changed after this draft; undo requires review');
      }
    }
    for (const effect of [...current.commentEffects].reverse()) {
      if (effect.before) await db.taskComments.put(effect.before);
      else await db.taskComments.delete(effect.id);
    }
    for (const effect of [...current.taskEffects].reverse()) {
      if (effect.before) {
        await db.tasks.put({ ...effect.before, updatedAt: revision(effect.after?.updatedAt ?? effect.before.updatedAt) });
      } else await db.tasks.delete(effect.id);
    }
    const undoneAt = Date.now();
    await db.taskAIChangeBatches.update(batchId, { undoneAt, undoProjectionState: 'pending' });
    return { ...current, undoneAt, undoProjectionState: 'pending' as const };
  });
  // A failed original projection is reconciled by the inverse projection;
  // replaying the original here would overwrite the reverted state.
  await projectBatch(batch, true);
  return (await db.taskAIChangeBatches.get(batch.id))!;
}
