import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../../services/db';
import { useTaskAIStore } from '../../stores/taskAIStore';
import type { TaskAIChangeBatch, TaskAIDraft } from '../../types';
import { TaskDraftPreview } from './TaskDraftPreview';

afterEach(cleanup);

it('offers undo after reload of an applied draft and shows the persisted result', async () => {
  await db.delete();
  await db.open();
  const draft: TaskAIDraft = {
    id: 'saved-draft', taskId: 'task-1', scope: 'active_task', summary: 'Rename',
    assistantMessage: '', createdAt: 1, baselineUpdatedAt: {},
    operations: [{ id: 'operation-1', type: 'update_task', taskId: 'task-1', updates: { title: 'New title' } }],
    validation: { errors: [], warnings: [], duplicateSubtasks: [], staleTaskIds: [] },
  };
  const batch: TaskAIChangeBatch = {
    id: draft.id, taskId: draft.taskId, summary: draft.summary,
    operations: draft.operations, inverseOperations: [], appliedByMessageId: 'message-1',
    taskEffects: [], commentEffects: [], projectionState: 'complete',
    createdAt: Date.now(), expiresAt: Date.now() + 60_000,
  };
  await db.taskAIChangeBatches.put(batch);
  const undoBatch = vi.fn(async (id: string) => {
    await db.taskAIChangeBatches.update(id, { undoneAt: Date.now(), undoProjectionState: 'complete' });
  });
  useTaskAIStore.setState({ undoBatch });
  render(<TaskDraftPreview messageId="message-1" draft={draft} status="applied" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.getByText('Undone')).toBeInTheDocument());
  expect(undoBatch).toHaveBeenCalledWith(draft.id);
});
