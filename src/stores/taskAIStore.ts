import { create } from 'zustand';
import type { TaskAIChangeBatch, TaskAIDraft } from '../types';
import { db } from '../services/db';
import { applyTaskDraft, undoTaskDraft } from '../services/taskDraftCommands';
import { useTaskStore } from './taskStore';
import { useTaskCommentStore } from './taskCommentStore';

export interface ApplyResult {
  batch: TaskAIChangeBatch | null;
  error?: string;
  staleTaskIds?: string[];
}

interface TaskAIStore {
  historyByTask: Record<string, TaskAIChangeBatch[]>;
  loadHistory: (taskId: string) => Promise<void>;
  getHistory: (taskId: string) => TaskAIChangeBatch[];
  applyDraft: (messageId: string, draft: TaskAIDraft) => Promise<ApplyResult>;
  undoBatch: (batchId: string) => Promise<void>;
}

async function refresh(taskId: string): Promise<void> {
  await useTaskStore.getState().loadTasks();
  await useTaskCommentStore.getState().loadComments(taskId);
}

export const useTaskAIStore = create<TaskAIStore>((set, get) => ({
  historyByTask: {},
  loadHistory: async (taskId) => {
    const history = await db.taskAIChangeBatches.where('taskId').equals(taskId)
      .filter((batch) => batch.undoneAt === undefined).reverse().toArray();
    set((state) => ({ historyByTask: { ...state.historyByTask, [taskId]: history } }));
  },
  getHistory: (taskId) => get().historyByTask[taskId] ?? [],
  applyDraft: async (messageId, draft) => {
    try {
      const batch = await applyTaskDraft(messageId, draft);
      await refresh(draft.taskId);
      await get().loadHistory(draft.taskId);
      return { batch };
    } catch (error) {
      const saved = await db.taskAIChangeBatches.get(draft.id);
      if (saved?.appliedByMessageId === messageId) {
        await refresh(draft.taskId);
        await get().loadHistory(draft.taskId);
        return { batch: saved, error: error instanceof Error ? error.message : 'Task mirror needs attention' };
      }
      return { batch: null, error: error instanceof Error ? error.message : 'Failed to apply task draft' };
    }
  },
  undoBatch: async (batchId) => {
    try {
      const batch = await undoTaskDraft(batchId);
      await refresh(batch.taskId);
      await get().loadHistory(batch.taskId);
    } catch (error) {
      // The database undo can commit before its file projection reports a failure.
      const saved = await db.taskAIChangeBatches.get(batchId);
      if (saved?.undoneAt) {
        await refresh(saved.taskId);
        await get().loadHistory(saved.taskId);
      }
      throw error;
    }
  },
}));
