// Chat store. Local-first using Dexie (Tauri desktop).
// Threads and messages stored in IndexedDB.

import { create } from 'zustand';
import type { ChatMessage, ChatProviderId, ChatThreadMeta } from '../types';
import { db } from '../services/db';
import { nanoid } from 'nanoid';

/** Context key for lastViewedPerContext map. */
function contextKey(params: { workspaceId?: string; taskId?: string; settingsTab?: string }): string | null {
  if (params.workspaceId) return `ws:${params.workspaceId}`;
  if (params.taskId) return `task:${params.taskId}`;
  if (params.settingsTab) return `settings:${params.settingsTab}`;
  return null;
}

interface ChatStore {
  threads: ChatThreadMeta[];
  activeThreadId: string | null;
  messagesByThread: Record<string, ChatMessage[]>;

  // Context tracking
  currentContext: { workspaceId?: string; taskId?: string; settingsTab?: string } | null;
  lastViewedPerContext: Record<string, string>;

  loadThreadsForContext: (params: { workspaceId?: string; taskId?: string; settingsTab?: string }) => Promise<void>;
  setActiveContext: (params: { workspaceId?: string; taskId?: string; settingsTab?: string }) => void;
  newChat: (params: { mode: 'writer' | 'task'; workspaceId?: string; taskId?: string; settingsTab?: string; origin?: ChatProviderId }) => Promise<void>;
  /** Changes an empty local thread before it receives its first message. */
  setEmptyThreadOrigin: (threadId: string, origin: ChatProviderId) => Promise<boolean>;
  selectThread: (threadId: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  addMessage: (msg: ChatMessage) => Promise<void>;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  syncThreadMessages: (threadId: string) => Promise<void>;
  getActiveThreadMessages: () => ChatMessage[];
  /** Set the AI tool permission mode for a thread (persisted). */
  setPermissionMode: (threadId: string, mode: 'ask' | 'bypass') => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messagesByThread: {},
  currentContext: null,
  lastViewedPerContext: {},

  loadThreadsForContext: async (params) => {
    try {
      let threads: ChatThreadMeta[] = [];
      if (params.workspaceId) {
        threads = await db.chatThreads
          .where('workspaceId')
          .equals(params.workspaceId)
          .toArray();
      } else if (params.taskId) {
        threads = await db.chatThreads
          .where('taskId')
          .equals(params.taskId)
          .toArray();
      } else if (params.settingsTab) {
        threads = await db.chatThreads
          .where('settingsTab')
          .equals(params.settingsTab)
          .toArray();
      }

      set({ threads, currentContext: params });

      // Auto-select the thread already associated with this context when possible.
      const key = contextKey(params);
      if (key) {
        const lastViewed = get().lastViewedPerContext[key];
        const currentActiveThreadId = get().activeThreadId;
        const preferredThreadId = lastViewed ?? currentActiveThreadId;
        const match = preferredThreadId && threads.find((t) => t.id === preferredThreadId);
        if (match) {
          set({ activeThreadId: match.id });
          if (lastViewed !== match.id) {
            set((s) => ({
              lastViewedPerContext: { ...s.lastViewedPerContext, [key]: match.id },
            }));
          }
          // Load messages for the auto-selected thread
          try {
            const messages = await db.chatMessages
              .where('threadId')
              .equals(match.id)
              .toArray();
            set(s => ({
              messagesByThread: { ...s.messagesByThread, [match.id]: messages },
            }));
          } catch {
            // Will load on demand
          }
        } else {
          set({ activeThreadId: null });
        }
      } else {
        set({ activeThreadId: null });
      }
    } catch {
      // Keep the previous list on transient errors.
    }
  },

  setActiveContext: (params) => {
    const current = get().currentContext;
    const changed =
      !current ||
      current.workspaceId !== params.workspaceId ||
      current.taskId !== params.taskId ||
      current.settingsTab !== params.settingsTab;
    if (changed) {
      get().loadThreadsForContext(params);
    }
  },

  newChat: async (params) => {
    const savedProvider = params.origin ?? await loadActiveChatProvider();
    const id = nanoid(8);
    const nowMs = Date.now();
    const key = contextKey(params);
    // Generate date-prefixed title: YY-MM-DD-chat
    const now = new Date();
    const datePrefix = `${String(now.getFullYear()).slice(2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const seq = get().threads.length + 1;
    const title = `${datePrefix}-chat-${String(seq).padStart(2, '0')}`;
    const optimistic: ChatThreadMeta = {
      id,
      origin: savedProvider,
      mode: params.mode,
      workspaceId: params.workspaceId ?? undefined,
      taskId: params.taskId ?? undefined,
      settingsTab: params.settingsTab ?? undefined,
      title,
      createdAt: nowMs,
      updatedAt: nowMs,
      permissionMode: 'ask',
    };
    set((s) => ({
      threads: [optimistic, ...s.threads],
      activeThreadId: id,
      messagesByThread: { ...s.messagesByThread, [id]: [] },
      lastViewedPerContext: key
        ? { ...s.lastViewedPerContext, [key]: id }
        : s.lastViewedPerContext,
    }));
    try {
      await db.chatThreads.add(optimistic);
      
      // Load messages for the new thread (should be empty)
      set((s) => ({
        messagesByThread: { ...s.messagesByThread, [id]: [] },
      }));
    } catch {
      // Roll back the optimistic insert on failure.
      set((s) => ({
        threads: s.threads.filter((t) => t.id !== id),
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId,
        messagesByThread: Object.fromEntries(
          Object.entries(s.messagesByThread).filter(([tid]) => tid !== id),
        ),
      }));
    }
  },

  selectThread: async (threadId) => {
    set((s) => ({
      activeThreadId: threadId,
      messagesByThread: { ...s.messagesByThread, [threadId]: s.messagesByThread[threadId] ?? [] },
    }));
    // Remember this as the last viewed thread for the current context
    const ctx = get().currentContext;
    if (ctx) {
      const key = contextKey(ctx);
      if (key) {
        set(s => ({
          lastViewedPerContext: { ...s.lastViewedPerContext, [key]: threadId },
        }));
      }
    }
    try {
      const messages = await db.chatMessages
        .where('threadId')
        .equals(threadId)
        .toArray();
      set((s) => ({ messagesByThread: { ...s.messagesByThread, [threadId]: messages } }));
    } catch {
      // Keep whatever we already had cached.
    }
  },

  addMessage: async (msg) => {
    // Optimistic insert: the UI sees the message immediately, then we
    // reconcile with the server response (which may carry a server-set
    // `timestamp`).
    set((s) => ({
      messagesByThread: {
        ...s.messagesByThread,
        [msg.threadId]: [...(s.messagesByThread[msg.threadId] ?? []), msg],
      },
    }));
    try {
      await db.chatMessages.add(msg);

      // Keep the thread's updatedAt timestamp in sync with message activity
      // so the context window can show an accurate "Last Activity" value.
      const now = Date.now();
      await db.chatThreads.update(msg.threadId, { updatedAt: now });
      set((s) => ({
        threads: s.threads.map((t) => (t.id === msg.threadId ? { ...t, updatedAt: now } : t)),
      }));

      // The server may have renamed the thread on the first user message.
      // We refresh the thread list so the sidebar title updates.
      if (msg.role === 'user') {
        const ctx = get().currentContext;
        if (ctx) {
          await get().loadThreadsForContext(ctx);
        }
      }
    } catch {
      // Roll back the optimistic insert.
      set((s) => ({
        messagesByThread: {
          ...s.messagesByThread,
          [msg.threadId]: (s.messagesByThread[msg.threadId] ?? []).filter((m) => m.id !== msg.id),
        },
      }));
    }
  },

  updateMessage: async (id, updates) => {
    // Apply optimistically across every thread cache that holds this id.
    set((s) => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [tid, msgs] of Object.entries(s.messagesByThread)) {
        next[tid] = msgs.map((m) => (m.id === id ? { ...m, ...updates } : m));
      }
      return { messagesByThread: next };
    });
    try {
      await db.chatMessages.update(id, updates);
      
      // We don't have a direct get-by-id endpoint, so reload each thread
      // cache that referenced this id. Simpler: just refetch the active
      // thread.
      const { activeThreadId } = get();
      if (activeThreadId) {
        try {
          const messages = await db.chatMessages
            .where('threadId')
            .equals(activeThreadId)
            .toArray();
          set((s) => ({ messagesByThread: { ...s.messagesByThread, [activeThreadId]: messages } }));
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Re-fetch the message from the server to recover authoritative state.
      // We don't have a direct get-by-id endpoint, so reload each thread
      // cache that referenced this id. Simpler: just refetch the active
      // thread.
      const { activeThreadId } = get();
      if (activeThreadId) {
        try {
          const messages = await db.chatMessages
            .where('threadId')
            .equals(activeThreadId)
            .toArray();
          set((s) => ({ messagesByThread: { ...s.messagesByThread, [activeThreadId]: messages } }));
        } catch {
          /* ignore */
        }
      }
    }
  },

  deleteThread: async (id) => {
    // Optimistically remove from local state.
    const prev = get().threads;
    const prevActive = get().activeThreadId;
    set((s) => {
      const nextThreads = s.threads.filter((t) => t.id !== id);
      const { [id]: _removed, ...rest } = s.messagesByThread; // eslint-disable-line @typescript-eslint/no-unused-vars
      return {
        threads: nextThreads,
        activeThreadId: s.activeThreadId === id ? (nextThreads[0]?.id ?? null) : s.activeThreadId,
        messagesByThread: rest,
      };
    });
    try {
      await db.chatThreads.delete(id);
      // Delete associated messages
      await db.chatMessages.where('threadId').equals(id).delete();
      
      // Refresh to get authoritative list using current context
      const ctx = get().currentContext;
      if (ctx) await get().loadThreadsForContext(ctx);
    } catch {
      // Roll back
      set((s) => ({
        threads: prev,
        activeThreadId: prevActive,
        messagesByThread: {
          ...s.messagesByThread,
          [id]: s.messagesByThread[id] ?? [],
        },
      }));
    }
  },

  deleteMessage: async (id) => {
    set((s) => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [tid, msgs] of Object.entries(s.messagesByThread)) {
        next[tid] = replaceOrRemoveMessage(msgs, id);
      }
      return { messagesByThread: next };
    });
    try {
      await db.chatMessages.delete(id);
      
      // Refetch active thread to recover.
      const { activeThreadId } = get();
      if (activeThreadId) {
        try {
          const messages = await db.chatMessages
            .where('threadId')
            .equals(activeThreadId)
            .toArray();
          set((s) => ({ messagesByThread: { ...s.messagesByThread, [activeThreadId]: messages } }));
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Refetch active thread to recover.
      const { activeThreadId } = get();
      if (activeThreadId) {
        try {
          const messages = await db.chatMessages
            .where('threadId')
            .equals(activeThreadId)
            .toArray();
          set((s) => ({ messagesByThread: { ...s.messagesByThread, [activeThreadId]: messages } }));
        } catch {
          /* ignore */
        }
      }
    }
  },


  syncThreadMessages: async (threadId) => {
    const messages = await db.chatMessages.where('threadId').equals(threadId).toArray();
    set((state) => ({
      messagesByThread: { ...state.messagesByThread, [threadId]: messages },
    }));
  },

  setEmptyThreadOrigin: async (threadId, origin) => {
    const thread = get().threads.find((item) => item.id === threadId);
    if (!thread || thread.origin === 'legacy_api') return false;
    try {
      const changed = await db.transaction('rw', db.chatThreads, db.chatMessages, async () => {
        const persisted = await db.chatThreads.get(threadId);
        if (!persisted || persisted.origin === 'legacy_api') return false;
        const messageCount = await db.chatMessages.where('threadId').equals(threadId).count();
        if (messageCount > 0) return false;
        await db.chatThreads.update(threadId, { origin });
        return true;
      });
      if (changed) {
        set((state) => ({
          threads: state.threads.map((item) => item.id === threadId ? { ...item, origin } : item),
        }));
      }
      return changed;
    } catch {
      return false;
    }
  },

  getActiveThreadMessages: () => {
    const { activeThreadId, messagesByThread } = get();
    if (!activeThreadId) return [];
    const messages = messagesByThread[activeThreadId] ?? [];
    // Dexie's `.where('threadId').equals().toArray()` returns rows in index
    // order, not insertion/chronological order, which interleaves user and
    // assistant bubbles incorrectly. Sort by timestamp (stable on ties) so the
    // conversation always renders oldest -> newest.
    return [...messages].sort((a, b) => a.timestamp - b.timestamp);
  },

  setPermissionMode: (threadId, mode) => {
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, permissionMode: mode } : t)),
    }));
    try {
      void db.chatThreads.update(threadId, { permissionMode: mode });
    } catch {
      /* ignore */
    }
  },
}));

function replaceOrRemoveMessage(messages: ChatMessage[], id: string): ChatMessage[] {
  return messages.filter((m) => m.id !== id);
}

const chatProviderIds: ChatProviderId[] = ['codex', 'grok', 'commandCode', 'openCode', 'mockEcho', 'mockTools'];

function isChatProviderId(value: unknown): value is ChatProviderId {
  return typeof value === 'string' && chatProviderIds.includes(value as ChatProviderId);
}

async function loadActiveChatProvider(): Promise<ChatProviderId> {
  const saved = await db.settings.get('activeChatProviderId');
  return isChatProviderId(saved?.value) ? saved.value : 'codex';
}
