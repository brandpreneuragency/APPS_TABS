// Task comment store. Local-first using Dexie (Tauri desktop).
// Uses attachmentDataUrl for local file attachments (Tauri filesystem).

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { TaskComment } from '../types';
import { db } from '../services/db';
import { recordTaskDeletion } from '../services/taskAuthority/cache';
import { useUIStore } from './uiStore';
import { getFileCategory, inferMimeTypeFromDataUrl } from '../utils/fileType';
import { generateVideoThumbnailDataUrl } from '../utils/fileData';

export type CommentCreateInput = {
  id?: string;
  sender?: string;
  text?: string;
  replyTo?: TaskComment['replyTo'];
  createdAt?: number;
};

export interface AddCommentOptions {
  /** Optional upload progress callback (0..1). */
  onProgress?: (loaded: number, total: number) => void;
  /** Abort signal — store it on the upload so the caller can cancel. */
  signal?: AbortSignal;
}

export interface AddCommentResult {
  comment: TaskComment | null;
  // For local-first, we don't return file metadata separately
  // as it's embedded in the comment via attachmentDataUrl
}

function showError(err: unknown, fallback: string): void {
  const msg = err instanceof Error ? err.message : fallback;
  useUIStore.getState().showToast(msg, 'error');
}

function buildReplyData(source: TaskComment | null | undefined): { id: string; text: string; sender: string } | undefined {
  if (!source) return undefined;
  return {
    id: source.id,
    text: source.text.slice(0, 200),
    sender: 'You',
  };
}

function localCommentFromInput(
  taskId: string,
  input: Omit<CommentCreateInput, 'id'>,
  createdAt: number,
): TaskComment {
  return {
    id: nanoid(8),
    taskId,
    sender: input.sender ?? 'You',
    text: input.text ?? '',
    replyTo: input.replyTo ?? undefined,
    createdAt,
    // For local-first, attachmentDataUrl comes from the file input
    attachmentDataUrl: undefined,
    attachmentName: undefined,
    attachmentMimeType: undefined,
    attachmentSizeBytes: undefined,
    attachmentPreviewDataUrl: undefined,
  };
}

interface TaskCommentStore {
  commentsByTask: Record<string, TaskComment[]>;

  loadComments: (taskId: string) => Promise<void>;
  /**
   * Create a comment. For local-first, handles file attachment via
   * attachmentDataUrl. Returns the created comment.
   */
  addComment: (
    taskId: string,
    input: CommentCreateInput,
    file?: File,
    options?: AddCommentOptions,
  ) => Promise<AddCommentResult>;
  updateComment: (id: string, updates: Partial<Pick<TaskComment, 'text'>>) => Promise<void>;
  deleteComment: (id: string, taskId: string) => Promise<void>;
  clearComments: (taskId: string) => Promise<void>;
  getComments: (taskId: string) => TaskComment[];
}

export const useTaskCommentStore = create<TaskCommentStore>((set, get) => ({
  commentsByTask: {},

  loadComments: async (taskId) => {
    try {
      const comments = await db.taskComments.where('taskId').equals(taskId).toArray();
      set((s) => ({ commentsByTask: { ...s.commentsByTask, [taskId]: comments } }));
    } catch (err) {
      showError(err, 'Failed to load comments.');
    }
  },

  addComment: async (taskId, input, file, options) => {
    const id = input.id ?? nanoid(8);
    const now = input.createdAt ?? Date.now();
    
    // Handle file attachment for local-first
    let attachmentDataUrl: string | undefined = undefined;
    let attachmentMimeType: string | undefined = undefined;
    let attachmentPreviewDataUrl: string | undefined = undefined;
    if (file) {
      try {
        // Convert File to data URL for local storage
        attachmentDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onprogress = (event) => {
            if (event.lengthComputable) {
              options?.onProgress?.(event.loaded, event.total);
            }
          };
          reader.onerror = () => reject(reader.error);
          options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          reader.readAsDataURL(file);
        });
      } catch (err) {
        showError(err, 'Failed to process file attachment.');
        return { comment: null };
      }

      attachmentMimeType = file.type || inferMimeTypeFromDataUrl(attachmentDataUrl);
      if (getFileCategory(file.name, attachmentMimeType) === 'video') {
        attachmentPreviewDataUrl = await generateVideoThumbnailDataUrl(file).catch(() => undefined);
      }
    }

    const comment: TaskComment = {
      id,
      taskId,
      sender: input.sender ?? 'You',
      text: input.text ?? '',
      replyTo: input.replyTo ?? undefined,
      attachmentDataUrl, // Local-first: store data URL directly
      attachmentName: file?.name,
      attachmentMimeType,
      attachmentSizeBytes: file?.size,
      attachmentPreviewDataUrl,
      createdAt: now,
    };

    try {
      await db.taskComments.add(comment);
      set((s) => ({
        commentsByTask: {
          ...s.commentsByTask,
          [taskId]: [...(s.commentsByTask[taskId] ?? []), comment],
        },
      }));
      return { comment };
    } catch (err) {
      showError(err, 'Failed to send comment.');
      return { comment: null };
    }
  },

  updateComment: async (id, updates) => {
    const previous = get().commentsByTask;
    // Optimistic local update.
    set((s) => {
      const updated: Record<string, TaskComment[]> = {};
      for (const [taskId, comments] of Object.entries(s.commentsByTask)) {
        updated[taskId] = comments.map((c) => (c.id === id ? { ...c, ...updates } : c));
      }
      return { commentsByTask: updated };
    });
    try {
      await db.taskComments.update(id, updates);
    } catch (err) {
      set({ commentsByTask: previous });
      showError(err, 'Failed to update comment.');
    }
  },

  deleteComment: async (id, taskId) => {
    const previous = get().commentsByTask[taskId] ?? [];
    set((s) => ({
      commentsByTask: {
        ...s.commentsByTask,
        [taskId]: previous.filter((c) => c.id !== id),
      },
    }));
    try {
      await db.transaction('rw', db.taskComments, db.settings, async () => {
        await recordTaskDeletion(db, [{ table: 'taskComments', id }]);
        await db.taskComments.delete(id);
      });
    } catch (err) {
      set((s) => ({
        commentsByTask: {
          ...s.commentsByTask,
          [taskId]: previous,
        },
      }));
      showError(err, 'Failed to delete comment.');
    }
  },

  clearComments: async (taskId) => {
    // Bulk-delete is not part of the v1 comment API; we leave this as a
    // client-side clear so callers that used it (e.g. bulk resets) keep
    // working. The actual rows are deleted from Dexie.
    await db.transaction('rw', db.taskComments, db.settings, async () => {
      const comments = await db.taskComments.where('taskId').equals(taskId).toArray();
      await recordTaskDeletion(db, comments.map(comment => ({ table: 'taskComments', id: comment.id })));
      await db.taskComments.bulkDelete(comments.map(comment => comment.id));
    });
    set((s) => ({ commentsByTask: { ...s.commentsByTask, [taskId]: [] } }));
  },

  getComments: (taskId) =>
    (get().commentsByTask[taskId] ?? [])
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt),
}));

/**
 * Re-export the helper that builds the `replyTo` payload from a source
 * comment. The comment input component uses this to keep the reply
 * metadata in the same shape the server expects.
 */
export { buildReplyData, localCommentFromInput };
