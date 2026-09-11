// Task AI store. Local-first using Dexie (Tauri desktop).
// All task AI operations happen locally with undo history.

import { create } from 'zustand';
import type { Task, TaskAIChangeBatch, TaskAIDraft, TaskAIOperation } from '../types';
import { db } from '../services/db';
import { useTaskStore } from './taskStore';
import { useTaskCommentStore } from './taskCommentStore';
import { nanoid } from 'nanoid';

export interface ApplyResult {
  batch: TaskAIChangeBatch | null;
  error?: string;
  /** Detected stale task ids. Surfaced so the UI can show "stale, regenerate" hints. */
  staleTaskIds?: string[];
}

interface TaskAIStore {
  historyByTask: Record<string, TaskAIChangeBatch[]>;
  loadHistory: (taskId: string) => Promise<void>;
  getHistory: (taskId: string) => TaskAIChangeBatch[];
  applyDraft: (messageId: string, draft: TaskAIDraft) => Promise<ApplyResult>;
  undoBatch: (batchId: string) => Promise<void>;
}

/**
 * Detect which task ids have changed since the draft was generated.
 * Mirrors the server-side check so the client can short-circuit before the request.
 */
function detectStaleTaskIds(draft: TaskAIDraft, tasks: Task[]): string[] {
  const stale: string[] = [];
  for (const [taskId, updatedAt] of Object.entries(draft.baselineUpdatedAt)) {
    const current = tasks.find((task) => task.id === taskId);
    if (current && current.updatedAt !== updatedAt) {
      stale.push(taskId);
    }
  }
  return stale;
}

// Helper to apply operations to tasks
function applyOperationsToTasks(tasks: Task[], operations: TaskAIOperation[]): Task[] {
  // Create a copy of tasks to work with
  const taskMap = new Map(tasks.map(task => [task.id, { ...task }]));
  
  for (const operation of operations) {
    switch (operation.type) {
      case 'create_task': {
        const newTask: Task = {
          id: operation.id,
          title: operation.title,
          content: operation.content ?? '',
          status: operation.status ?? 'pending',
          importance: operation.importance ?? 'medium',
          date: operation.date ?? new Date().toISOString().slice(0, 10),
          projectId: operation.projectId ?? '',
          assignees: operation.assignees ?? [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sourceChatMessageId: undefined,
          order: 0, // Will be set properly below
        };
        taskMap.set(newTask.id, newTask);
        break;
      }
      
      case 'update_task': {
        const task = taskMap.get(operation.taskId);
        if (task) {
          Object.assign(task, operation.updates);
          task.updatedAt = Date.now();
        }
        break;
      }
      
      case 'soft_delete_task': {
        const task = taskMap.get(operation.taskId);
        if (task) {
          task.deletedAt = Date.now();
        }
        break;
      }
      
      case 'restore_task': {
        const task = taskMap.get(operation.taskId);
        if (task) {
          task.deletedAt = undefined;
        }
        break;
      }
      
      case 'add_comment': {
        // Comments are handled separately in taskCommentStore
        break;
      }
      
      case 'delete_comment': {
        // Comments are handled separately in taskCommentStore
        break;
      }
    }
  }
  
  // Recalculate order for tasks within each project
  const tasksByProject: Map<string, Task[]> = new Map();
  for (const task of taskMap.values()) {
    if (!task.deletedAt) {
      const projectId = task.projectId ?? 'null';
      if (!tasksByProject.has(projectId)) {
        tasksByProject.set(projectId, []);
      }
      tasksByProject.get(projectId)?.push(task);
    }
  }
  
  // Sort each project's tasks by title and assign order
  for (const [, projectTasks] of tasksByProject) {
    projectTasks.sort((a, b) => a.title.localeCompare(b.title));
    projectTasks.forEach((task, index) => {
      task.order = index;
    });
  }
  
  return Array.from(taskMap.values());
}

export const useTaskAIStore = create<TaskAIStore>((set, get) => ({
  historyByTask: {},
  
  loadHistory: async (taskId) => {
    try {
      const history = await db.taskAIChangeBatches
        .where('taskId')
        .equals(taskId)
        .filter(batch => batch.undoneAt === undefined)
        .reverse()
        .toArray();
      
      set((state) => ({
        historyByTask: { ...state.historyByTask, [taskId]: history },
      }));
    } catch (err) {
      // History is best-effort. A failure here shouldn't blow up the UI.
      if (!(err instanceof Error && err.message.includes('Unauthorized'))) {
        set((state) => ({
          historyByTask: { ...state.historyByTask, [taskId]: [] },
        }));
      }
    }
  },
  
  getHistory: (taskId) => get().historyByTask[taskId] ?? [],
  
  applyDraft: async (_messageId, draft) => {
    // Client-side pre-flight. This gives better UX and avoids unnecessary work.
    const tasks = useTaskStore.getState().tasks;
    const staleTaskIds = detectStaleTaskIds(draft, tasks);
    if (staleTaskIds.length > 0) {
      return {
        batch: null,
        staleTaskIds,
        error:
          'Task data changed since this draft was generated. Please regenerate the draft before applying.',
      };
    }
    if (draft.validation.errors.length > 0) {
      return {
        batch: null,
        error: 'This draft has validation errors and cannot be applied.',
      };
    }

    try {
      // Apply operations to get new state
      const currentTasks = [...useTaskStore.getState().tasks];
      const newTasks = applyOperationsToTasks(currentTasks, draft.operations);
      
      // Create inverse operations for undo
      const inverseOperations: TaskAIOperation[] = [];
      // Process operations in reverse order to create proper inverses
      for (let i = draft.operations.length - 1; i >= 0; i--) {
        const op = draft.operations[i];
        let inverseOp: TaskAIOperation | null = null;
        
        switch (op.type) {
          case 'create_task':
            inverseOp = {
              id: op.id,
              type: 'soft_delete_task',
              taskId: op.id,
            };
            break;
            
          case 'update_task':
            inverseOp = {
              id: op.taskId,
              type: 'update_task',
              taskId: op.taskId,
              updates: {}, // Would need to store original values - simplified for now
            };
            // In a real implementation, we'd store the original values
            break;
            
          case 'soft_delete_task':
            inverseOp = {
              id: op.taskId,
              type: 'restore_task',
              taskId: op.taskId,
            };
            break;
            
          case 'restore_task':
            inverseOp = {
              id: op.taskId,
              type: 'soft_delete_task',
              taskId: op.taskId,
            };
            break;
            
          case 'add_comment':
            // Inverse of add_comment is delete_comment - but we don't have the comment id yet
            // This is simplified; a real implementation would track created comment IDs
            break;
            
          case 'delete_comment':
            // Inverse of delete_comment is add_comment - but we don't have the original text
            // This is simplified; a real implementation would store original comment data
            break;
        }
        
        if (inverseOp) {
          inverseOperations.push(inverseOp);
        }
      }
      
      // Create the batch
      const batchId = nanoid(8);
      const now = Date.now();
      const batch: TaskAIChangeBatch = {
        id: batchId,
        taskId: draft.taskId,
        summary: draft.summary,
        operations: draft.operations,
        inverseOperations,
        createdAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days from now
      };
      
      // Save batch to Dexie
      await db.taskAIChangeBatches.add(batch);
      
      // Update tasks in Dexie
      for (const task of newTasks) {
        await db.tasks.put(task);
      }
      
      // Update comments if any were added (would need to handle comment operations)
      // For now, we'll just refresh the task comment store
      await useTaskCommentStore.getState().loadComments(draft.taskId);
      
      // Refresh local caches
      await useTaskStore.getState().loadTasks();
      await get().loadHistory(draft.taskId);
      
      return { batch };
    } catch (err) {
      if (err instanceof Error && err.message.includes('stale_task')) {
        // Extract stale task ids from error if possible
        const staleTaskIds: string[] = [];
        return {
          batch: null,
          staleTaskIds,
          error: err.message,
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to apply draft.';
      return { batch: null, error: message };
    }
  },
  
  undoBatch: async (batchId) => {
    try {
      // Get the batch
      const batch = await db.taskAIChangeBatches.get(batchId);
      if (!batch) {
        throw new Error('Batch not found');
      }
      
      // Apply inverse operations to get previous state
      const currentTasks = [...useTaskStore.getState().tasks];
      const previousTasks = applyOperationsToTasks(currentTasks, batch.inverseOperations);
      
      // Mark batch as undone
      await db.taskAIChangeBatches.update(batchId, { undoneAt: Date.now() });
      
      // Update tasks in Dexie
      for (const task of previousTasks) {
        await db.tasks.put(task);
      }
      
      // Refresh local caches
      await useTaskStore.getState().loadTasks();
      await useTaskCommentStore.getState().loadComments(batch.taskId);
      await get().loadHistory(batch.taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Undo failed.';
      throw new Error(message);
    }
  },
}));