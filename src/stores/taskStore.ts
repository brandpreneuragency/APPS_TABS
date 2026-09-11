// Task store. Local-first using Dexie (Tauri desktop).
// Includes Tauri file system sync for markdown-on-disk.

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Task, TaskStatus } from '../types';
import { TASK_TITLE_MAX_LENGTH } from '../types';
import { db, getSetting, setSetting } from '../services/db';
import * as fsAdapter from '../services/fs-adapter';
import { isTauriRuntime } from '../services/runtime';
import { useUIStore } from './uiStore';
import { useProjectStore } from './projectStore';

function showError(err: unknown, fallback: string): void {
  const msg = err instanceof Error ? err.message : fallback;
  useUIStore.getState().showToast(msg, 'error');
}

function settingId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function persistSelection(clientId: string | null, projectId: string | null): void {
  void setSetting('selectedClientId', clientId ?? '');
  void setSetting('selectedProjectId', projectId ?? '');
}

function restoreSelection(
  storedClientId: string,
  storedProjectId: string,
  clients: readonly { id: string }[],
  projects: readonly { id: string; clientId: string }[],
): { selectedClientId: string | null; selectedProjectId: string | null } {
  const project = storedProjectId
    ? projects.find((p) => p.id === storedProjectId)
    : undefined;
  if (project && clients.some((c) => c.id === project.clientId)) {
    return { selectedClientId: project.clientId, selectedProjectId: project.id };
  }
  if (storedClientId && clients.some((c) => c.id === storedClientId)) {
    return { selectedClientId: storedClientId, selectedProjectId: null };
  }
  return { selectedClientId: clients[0]?.id ?? null, selectedProjectId: null };
}

interface TaskTab {
  tabId: string;
  taskId: string | null;
  colorIndex: number; // 0-5 for rainbow colors
}

interface TaskStore {
  tasks: Task[];
  activeTaskId: string | null; // derived from active tab
  openTaskIds: string[]; // derived
  openTabs: TaskTab[];
  activeTabId: string | null;
  isLoaded: boolean;
  selectedClientId: string | null;
  selectedProjectId: string | null;

  loadTasks: () => Promise<void>;
  setSelection: (clientId: string | null, projectId: string | null) => void;
  createTask: (title: string, opts?: Partial<Task>) => Promise<Task | null>;
  updateTask: (id: string, updates: Partial<Pick<Task,
    'title' | 'content' | 'status' | 'importance' | 'date' |
    'projectId' | 'assignees' | 'sourcePath' |
    'sourceChatMessageId'>>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  permanentlyDeleteTask: (id: string) => Promise<void>;
  setActiveTask: (id: string | null) => void; // legacy: opens in new tab or replaces active
  openTaskInActiveTab: (taskId: string) => void; // task-list click: focus existing tab or open a new one
  createEmptyTab: () => void;
  closeTaskTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  getActiveTask: () => Task | null;
  getActiveTabColorIndex: () => number;
  getTabColorIndexByTaskId: (taskId: string) => number;
  getTasksByProject: (projectId: string) => Task[];
  getTasksByStatus: (status: TaskStatus) => Task[];
  getSubtasks: (parentId: string) => Task[];
  getDeletedTasks: () => Task[];
  fetchDeletedTasks: () => Promise<Task[]>;
  createSubtask: (parentId: string, title: string, sourceChatMessageId?: string, date?: string) => Promise<Task | null>;
  /**
   * Regenerate INDEX.md on disk for the Tauri desktop bundle.
   * Kept for compatibility; actual implementation in fs-adapter.
   */
  regenerateIndex: () => Promise<void>;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Helper to sync task to markdown file
async function syncTaskToFile(task: Task): Promise<void> {
  if (!isTauriRuntime() || !task.projectId) return;
  
  const project = await db.projects.get(task.projectId);
  if (!project) return;
  
  const projectName = project.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'); // eslint-disable-line no-control-regex -- Sanitize for filesystem
  const taskDir = `TASKS/${projectName}/${task.id}`;
  
  try {
    await fsAdapter.mkdir(taskDir, true);
    const taskContent = `# ${task.title}\n\n${task.content}`;
    await fsAdapter.writeTextFile(`${taskDir}/task.md`, taskContent);
  } catch (err) {
    console.warn('[taskStore] Failed to sync task to file:', err);
  }
}

// Helper to delete task markdown file
async function deleteTaskFile(task: Task): Promise<void> {
  if (!isTauriRuntime() || !task.projectId) return;
  
  const project = await db.projects.get(task.projectId);
  if (!project) return;
  
  const projectName = project.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'); // eslint-disable-line no-control-regex -- Sanitize for filesystem
  const taskDir = `TASKS/${projectName}/${task.id}`;
  
  try {
    await fsAdapter.remove(taskDir, true);
  } catch (err) {
    console.warn('[taskStore] Failed to delete task file:', err);
  }
}

// Helper to regenerate INDEX.md for a project
async function regenerateProjectIndex(projectId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const project = await db.projects.get(projectId);
  if (!project) return;
  
  const projectName = project.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'); // eslint-disable-line no-control-regex -- Sanitize for filesystem
  const projectDir = `TASKS/${projectName}`;
  
  try {
    await fsAdapter.mkdir(projectDir, true);
    const tasks = await db.tasks.where('projectId').equals(projectId).filter(t => !t.deletedAt).toArray();
    const taskList = tasks.map(t => `- [${t.id}] ${t.title}`).join('\n');
    const indexContent = `# ${project.name} Tasks\n\n${taskList}`;
    await fsAdapter.writeTextFile(`${projectDir}/INDEX.md`, indexContent);
  } catch (err) {
    console.warn('[taskStore] Failed to regenerate project index:', err);
  }
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTaskId: null,
  openTaskIds: [],
  openTabs: [],
  activeTabId: null,
  isLoaded: false,
  selectedClientId: null,
  selectedProjectId: null,

  loadTasks: async () => {
    try {
      // Load non-deleted tasks by default
      const [tasks, storedClientId, storedProjectId, clients, projects] = await Promise.all([
        db.tasks.filter(t => !t.deletedAt).toArray(),
        getSetting<string>('selectedClientId', ''),
        getSetting<string>('selectedProjectId', ''),
        db.clients.toArray(),
        db.projects.toArray(),
      ]);
      const selection = restoreSelection(
        settingId(storedClientId),
        settingId(storedProjectId),
        clients,
        projects,
      );

      // Initialize with a single empty tab if none exist
      let tabs = get().openTabs.length > 0 ? get().openTabs : [{ tabId: nanoid(8), taskId: null, colorIndex: 0 }];
      const activeTabId = get().activeTabId ?? tabs[0].tabId;

      // Filter out tabs whose tasks no longer exist, and ensure colorIndex exists
      tabs = tabs.map((t) => {
        const taskMissing = t.taskId && !tasks.some((tsk: Task) => tsk.id === t.taskId);
        return { ...t, taskId: taskMissing ? null : t.taskId, colorIndex: t.colorIndex ?? 0 };
      });

      const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? tabs[0];
      const derivedActiveTaskId = activeTab.taskId;
      const derivedOpenTaskIds = tabs.map((t) => t.taskId).filter(Boolean) as string[];

      set({
        tasks,
        openTabs: tabs,
        activeTabId: activeTab.tabId,
        activeTaskId: derivedActiveTaskId,
        openTaskIds: derivedOpenTaskIds,
        isLoaded: true,
        ...selection,
      });
    } catch (err) {
      set({ isLoaded: true });
      showError(err, 'Failed to load tasks.');
    }
  },

  setSelection: (clientId, projectId) => {
    let nextClientId = clientId;
    let nextProjectId = projectId;
    if (nextProjectId) {
      const project = useProjectStore.getState().getProjectById(nextProjectId);
      if (project) {
        nextClientId = project.clientId;
      } else {
        nextProjectId = null;
      }
    } else {
      nextProjectId = null;
    }
    set({ selectedClientId: nextClientId, selectedProjectId: nextProjectId });
    persistSelection(nextClientId, nextProjectId);
  },

  createTask: async (title, opts = {}) => {
    const trimmed = title.trim().slice(0, TASK_TITLE_MAX_LENGTH);
    if (!trimmed) return null;
    const projectId = opts.projectId?.trim() ?? '';
    if (!projectId) {
      showError('Missing project', 'Failed to create task.');
      return null;
    }
    const id = nanoid(8);
    const now = Date.now();
    const task: Task = {
      id,
      title: trimmed,
      content: opts.content ?? '',
      status: opts.status ?? 'pending',
      importance: opts.importance ?? 'medium',
      date: opts.date ?? todayIso(),
      projectId,
      assignees: opts.assignees ?? [],
      createdAt: now,
      updatedAt: now,
      sourcePath: opts.sourcePath ?? undefined,
      order: get().tasks.length,
      sourceChatMessageId: opts.sourceChatMessageId ?? undefined,
    };
    try {
      await db.tasks.add(task);
      // Sync to markdown file
      await syncTaskToFile(task);
      
      set((s) => {
        // Open new task in active tab if possible, else append new tab
        let tabs = [...s.openTabs];
        let activeTabId = s.activeTabId;
        // Cycle colors based on tab count (modulo 6)
        const nextColor = tabs.length % 6;

        if (activeTabId) {
          tabs = tabs.map((t) => (t.tabId === activeTabId ? { ...t, taskId: task.id } : t));
        } else {
          const newTab = { tabId: nanoid(8), taskId: task.id, colorIndex: nextColor };
          tabs = [...tabs, newTab];
          activeTabId = newTab.tabId;
        }
        const derivedOpen = tabs.map((t) => t.taskId).filter(Boolean) as string[];
        return {
          tasks: [...s.tasks, task],
          openTabs: tabs,
          activeTabId,
          activeTaskId: task.id,
          openTaskIds: derivedOpen,
        };
      });
      return task;
    } catch (err) {
      showError(err, 'Failed to create task.');
      return null;
    }
  },

  updateTask: async (id, updates) => {
    const previous = get().tasks.find((t) => t.id === id);
    // Enforce max title length
    const enforcedUpdates =
      updates.title !== undefined
        ? { ...updates, title: updates.title.slice(0, TASK_TITLE_MAX_LENGTH) }
        : updates;
    // Optimistic local update with an `updatedAt` tick so the UI shows the
    // new "last modified" immediately.
    const optimisticPatch = { ...enforcedUpdates, updatedAt: Date.now() } as Task;
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...optimisticPatch } : t)),
    }));
    try {
      await db.tasks.update(id, enforcedUpdates);
      // Sync to markdown file if projectId or content changed
      const updatedTask = await db.tasks.get(id);
      if (updatedTask) {
        await syncTaskToFile(updatedTask);
        // Regenerate project index if projectId changed
        if (enforcedUpdates.projectId !== undefined && enforcedUpdates.projectId !== previous?.projectId) {
          if (previous?.projectId) await regenerateProjectIndex(previous.projectId);
          if (enforcedUpdates.projectId) await regenerateProjectIndex(enforcedUpdates.projectId);
        }
      }
    } catch (err) {
      if (previous) {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? previous : t)),
        }));
      }
      showError(err, 'Failed to update task.');
    }
  },

  deleteTask: async (id) => {
    const previous = get().tasks;
    // Soft-delete locally: drop from the active list, pick a neighbour as
    // the new active task if necessary, close the tab. Matches the
    // previous Dexie behaviour.
    set((s) => {
      const remaining = s.tasks.filter((t) => t.id !== id);
      const stillOpen = s.openTaskIds.filter((tid) => tid !== id);
      let nextActive = s.activeTaskId;
      if (nextActive === id) {
        nextActive = stillOpen[stillOpen.length - 1] ?? null;
      }
      return {
        tasks: remaining,
        openTaskIds: stillOpen,
        activeTaskId: nextActive,
      };
    });
    useUIStore.getState().setActiveTaskId(get().activeTaskId);
    try {
      const taskToDelete = await db.tasks.get(id);
      if (taskToDelete) {
        await db.tasks.update(id, { deletedAt: Date.now() });
        // Delete markdown file
        await deleteTaskFile(taskToDelete);
        // Regenerate project index
        if (taskToDelete.projectId) await regenerateProjectIndex(taskToDelete.projectId);
      }
    } catch (err) {
      set({ tasks: previous });
      showError(err, 'Failed to delete task.');
    }
  },

  restoreTask: async (id) => {
    try {
      const task = await db.tasks.get(id);
      if (task) {
        await db.tasks.update(id, { deletedAt: undefined });
        // Regenerate project index
        if (task.projectId) await regenerateProjectIndex(task.projectId);
      }
      // Re-fetch the active list so the restored task reappears with
      // the canonical server `order` and `updatedAt`.
      const tasks = await db.tasks.filter(t => !t.deletedAt).toArray();
      set((s) => {
        // Restore into active tab if empty, else append new tab
        let tabs = [...s.openTabs];
        let act = s.activeTabId;
        const activeTab = tabs.find((t) => t.tabId === act);
        if (activeTab && activeTab.taskId === null) {
          tabs = tabs.map((t) => (t.tabId === act ? { ...t, taskId: id } : t));
        } else {
          const nt = { tabId: nanoid(8), taskId: id, colorIndex: 0 };
          tabs = [...tabs, nt];
          act = nt.tabId;
        }
        const derived = tabs.map((t) => t.taskId).filter(Boolean) as string[];
        return { tasks, openTabs: tabs, activeTabId: act, activeTaskId: id, openTaskIds: derived };
      });
      useUIStore.getState().setActiveTaskId(id);
    } catch (err) {
      showError(err, 'Failed to restore task.');
    }
  },

  permanentlyDeleteTask: async (id) => {
    const previous = get().tasks;
    set((s) => {
      const remaining = s.tasks.filter((t) => t.id !== id);
      const tabs = s.openTabs.map((t) => (t.taskId === id ? { ...t, taskId: null } : t));
      const nextActiveTab = s.activeTabId;
      let nextActiveTask: string | null = null;
      if (s.activeTaskId === id) {
        const actTab = tabs.find((t) => t.tabId === nextActiveTab);
        nextActiveTask = actTab?.taskId ?? null;
      }
      const derivedOpen = tabs.map((t) => t.taskId).filter(Boolean) as string[];
      return {
        tasks: remaining,
        openTabs: tabs,
        openTaskIds: derivedOpen,
        activeTaskId: nextActiveTask,
      };
    });
    try {
      const taskToDelete = await db.tasks.get(id);
      if (taskToDelete) {
        await db.tasks.delete(id);
        // Delete markdown file
        await deleteTaskFile(taskToDelete);
        // Regenerate project index
        if (taskToDelete.projectId) await regenerateProjectIndex(taskToDelete.projectId);
      }
    } catch (err) {
      set({ tasks: previous });
      showError(err, 'Failed to permanently delete task.');
    }
  },

  setActiveTask: (id) => {
    // Legacy: treat as "open in new tab" for backward compat with some call sites
    if (!id) {
      set({ activeTaskId: null });
      return;
    }
    const { openTabs, activeTabId } = get();
    // If already open somewhere, just activate that tab
    const existing = openTabs.find((t) => t.taskId === id);
    if (existing) {
      const derivedOpen = openTabs.map((t) => t.taskId).filter(Boolean) as string[];
      set({ activeTabId: existing.tabId, activeTaskId: id, openTaskIds: derivedOpen });
      useUIStore.getState().setActiveTaskId(id);
      return;
    }
    // Replace active tab or append
    let tabs = [...openTabs];
    let newActive = activeTabId;
    if (activeTabId) {
      tabs = tabs.map((t) => (t.tabId === activeTabId ? { ...t, taskId: id } : t));
    } else {
      const nt = { tabId: nanoid(8), taskId: id, colorIndex: 0 };
      tabs.push(nt);
      newActive = nt.tabId;
    }
    const derivedOpen = tabs.map((t) => t.taskId).filter(Boolean) as string[];
    set({ openTabs: tabs, activeTabId: newActive, activeTaskId: id, openTaskIds: derivedOpen });
    useUIStore.getState().setActiveTaskId(id);
  },

  openTaskInActiveTab: (taskId) => {
    const { openTabs, activeTabId } = get();
    const existing = openTabs.find((t) => t.taskId === taskId);
    if (existing) {
      const derivedOpen = openTabs.map((t) => t.taskId).filter(Boolean) as string[];
      set({ activeTabId: existing.tabId, activeTaskId: taskId, openTaskIds: derivedOpen });
      useUIStore.getState().setActiveTaskId(taskId);
      return;
    }

    const activeTab = openTabs.find((t) => t.tabId === activeTabId) ?? null;
    let tabs = [...openTabs];
    let nextActiveTabId = activeTabId;

    if (activeTab && activeTab.taskId === null) {
      tabs = tabs.map((t) => (t.tabId === activeTabId ? { ...t, taskId } : t));
    } else if (!activeTabId) {
      // No tab at all - create one
      const nt = { tabId: nanoid(8), taskId, colorIndex: 0 };
      tabs = [nt];
      nextActiveTabId = nt.tabId;
    } else {
      // Replace the task in the active tab instead of creating a new tab
      tabs = tabs.map((t) => (t.tabId === activeTabId ? { ...t, taskId } : t));
    }

    const derivedOpen = tabs.map((t) => t.taskId).filter(Boolean) as string[];
    set({ openTabs: tabs, activeTabId: nextActiveTabId, activeTaskId: taskId, openTaskIds: derivedOpen });
    useUIStore.getState().setActiveTaskId(taskId);
  },

  createEmptyTab: () => {
    set((s) => {
      // Cycle colors based on tab count (modulo 6)
      const nextColor = s.openTabs.length % 6;
      const nt = { tabId: nanoid(8), taskId: null, colorIndex: nextColor };
      const tabs = [...s.openTabs, nt];
      return {
        openTabs: tabs,
        activeTabId: nt.tabId,
        activeTaskId: null,
        openTaskIds: s.openTaskIds,
      };
    });
  },

  closeTaskTab: (tabId) => {
    const { openTabs, activeTabId, activeTaskId } = get();
    const remaining = openTabs.filter((t) => t.tabId !== tabId);
    let nextActiveTabId = activeTabId;
    let nextActiveTask: string | null = activeTaskId;
    if (activeTabId === tabId) {
      const nextTab = remaining[remaining.length - 1] ?? null;
      nextActiveTabId = nextTab?.tabId ?? null;
      nextActiveTask = nextTab?.taskId ?? null;
      useUIStore.getState().setActiveTaskId(nextActiveTask);
    }
    const replacementTabs = remaining.length > 0 ? remaining : [{ tabId: nanoid(8), taskId: null, colorIndex: 0 }];
    const derivedOpen = replacementTabs.map((t) => t.taskId).filter(Boolean) as string[];
    set({
      openTabs: replacementTabs,
      activeTabId: nextActiveTabId ?? replacementTabs[0].tabId,
      activeTaskId: nextActiveTask,
      openTaskIds: derivedOpen,
    });
  },

  setActiveTab: (tabId: string) => {
    const { openTabs } = get();
    const tab = openTabs.find((t) => t.tabId === tabId);
    if (!tab) return;
    const derivedOpen = openTabs.map((t) => t.taskId).filter(Boolean) as string[];
    set({ activeTabId: tabId, activeTaskId: tab.taskId, openTaskIds: derivedOpen });
    useUIStore.getState().setActiveTaskId(tab.taskId);
  },

  getActiveTask: () => {
    const { tasks, activeTaskId } = get();
    return tasks.find((t) => t.id === activeTaskId) ?? null;
  },

  getActiveTabColorIndex: () => {
    const { openTabs, activeTabId } = get();
    const tab = openTabs.find((t) => t.tabId === activeTabId);
    return tab?.colorIndex ?? 0;
  },

  getTabColorIndexByTaskId: (taskId: string) => {
    const { openTabs } = get();
    const tab = openTabs.find((t) => t.taskId === taskId);
    return tab?.colorIndex ?? 0;
  },

  getTasksByProject: (projectId) => {
    return get().tasks.filter((t) => t.projectId === projectId && !t.deletedAt);
  },

  getTasksByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status && !t.deletedAt);
  },

  getSubtasks: (_parentId) => [],

  getDeletedTasks: () => {
    return [] as Task[]; // Sync placeholder — use fetchDeletedTasks() instead
  },

  fetchDeletedTasks: async (): Promise<Task[]> => {
    try {
      const tasks = await db.tasks.filter((t: Task) => Boolean(t.deletedAt)).toArray();
      return tasks.filter((t) => Boolean(t.deletedAt));
    } catch (err) {
      showError(err, 'Failed to load deleted tasks.');
      return [];
    }
  },

  createSubtask: async (parentId, title, sourceChatMessageId, date) => {
    const parent = get().tasks.find((t) => t.id === parentId);
    if (!parent) {
      showError(new Error('Parent task not found'), 'Parent task not found');
      return null;
    }
    return get().createTask(title, {
      projectId: parent.projectId,
      sourceChatMessageId,
      date: date ?? parent.date,
    });
  },

  regenerateIndex: async () => {
    // Regenerate INDEX.md files for all projects
    try {
      const projects = await db.projects.toArray();
      for (const project of projects) {
        await regenerateProjectIndex(project.id);
      }
    } catch (err) {
      console.warn('[taskStore] Failed to regenerate indexes:', err);
    }
  },
}));
