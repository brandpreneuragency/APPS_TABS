// Task store. Local-first using Dexie (Tauri desktop).
// Includes Tauri file system sync for markdown-on-disk.

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Task, TaskStatus } from '../types';
import { TASK_TITLE_MAX_LENGTH } from '../types';
import { db, getSetting, setSetting } from '../services/db';
import * as fsAdapter from '../services/fs-adapter';
import { isTauriRuntime } from '../services/runtime';
import { assertSubtaskParent, assertTaskProjectChange, assertTaskSoftDelete } from '../services/taskRelations';
import { useUIStore } from './uiStore';
import { useProjectStore } from './projectStore';
import { formatProjectIndex, nameKey, projectMirrorDir, sanitizeFsName, taskMirrorDir } from './taskTreeNames';

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
  refreshTasksFromDb: () => Promise<void>;
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
  getDeletedTasks: () => Task[];
  fetchDeletedTasks: () => Promise<Task[]>;
  /**
   * Regenerate INDEX.md on disk for the Tauri desktop bundle.
   * Kept for compatibility; actual implementation in fs-adapter.
   */
  regenerateIndex: () => Promise<void>;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveMirrorNames(
  projectId: string | undefined,
): Promise<{ clientName: string; projectName: string } | null> {
  if (!projectId) return null;
  const project = await db.projects.get(projectId);
  if (!project) return null;
  const client = await db.clients.get(project.clientId);
  if (!client) return null;
  return { clientName: client.name, projectName: project.name };
}

// Helper to sync task to markdown file
async function syncTaskToFile(task: Task): Promise<void> {
  if (!isTauriRuntime() || !task.projectId) return;

  const names = await resolveMirrorNames(task.projectId);
  if (!names) return;

  const taskDir = taskMirrorDir(names.clientName, names.projectName, task.id);

  try {
    if (await fsAdapter.exists(`${taskDir}/task.md`)) return;
    await fsAdapter.mkdir(taskDir, true);
    const taskContent = `# ${task.title}\n\n${task.content}`;
    await fsAdapter.writeTextFile(`${taskDir}/task.md`, taskContent);
  } catch (err) {
    console.warn('[taskStore] Failed to sync task to file:', err);
  }
}

// Helper to regenerate INDEX.md for a project
async function regenerateProjectIndex(projectId: string): Promise<void> {
  if (!isTauriRuntime()) return;

  const names = await resolveMirrorNames(projectId);
  if (!names) return;

  const projectDir = projectMirrorDir(names.clientName, names.projectName);

  try {
    await fsAdapter.mkdir(projectDir, true);
    const tasks = await db.tasks.where('projectId').equals(projectId).filter(t => !t.deletedAt).toArray();
    const indexContent = formatProjectIndex(names.projectName, tasks);
    await fsAdapter.writeTextFile(`${projectDir}/INDEX.md`, indexContent);
  } catch (err) {
    console.warn('[taskStore] Failed to regenerate project index:', err);
  }
}

/** Strict projection for Codex receipts. The database effect remains recorded if disk sync fails. */
export async function syncCodexTaskProjection(task: Task, previousTask?: Task): Promise<void> {
  if (!isTauriRuntime()) return;
  const previousProjectId = previousTask && previousTask.projectId !== task.projectId
    ? previousTask.projectId : undefined;
  const projectIds = new Set([task.projectId, previousProjectId].filter((id): id is string => !!id));
  if (!task.deletedAt) {
    const names = await resolveMirrorNames(task.projectId);
    if (!names) throw new Error('Task project or client is missing');
    const taskDir = taskMirrorDir(names.clientName, names.projectName, task.id);
    const targetFile = `${taskDir}/task.md`;
    const nextContent = `# ${task.title}\n\n${task.content}`;
    let previousFile: string | undefined;
    const previousContent = previousTask ? `# ${previousTask.title}\n\n${previousTask.content}` : undefined;
    if (previousProjectId && previousTask) {
      const oldNames = await resolveMirrorNames(previousProjectId);
      if (!oldNames) throw new Error('Previous task project or client is missing');
      previousFile = `${taskMirrorDir(oldNames.clientName, oldNames.projectName, task.id)}/task.md`;
      if (previousFile === targetFile) throw new Error('Task project mirrors overlap');
      if (await fsAdapter.exists(previousFile)
        && await fsAdapter.readTextFile(previousFile) !== previousContent) {
        throw new Error('Previous task mirror changed outside TABS');
      }
    }
    const existingTarget = await fsAdapter.exists(targetFile)
      ? await fsAdapter.readTextFile(targetFile) : undefined;
    if (existingTarget !== undefined && existingTarget !== nextContent
      && (previousProjectId || !previousTask || existingTarget !== previousContent)) {
      throw new Error('Task mirror already contains different content');
    }
    if (existingTarget !== nextContent) {
      await fsAdapter.mkdir(taskDir, true);
      await fsAdapter.writeTextFile(targetFile, nextContent);
      if (await fsAdapter.readTextFile(targetFile) !== nextContent) {
        throw new Error('Task mirror could not be verified');
      }
    }
    if (previousFile && await fsAdapter.exists(previousFile)) {
      if (await fsAdapter.readTextFile(previousFile) !== previousContent) {
        throw new Error('Previous task mirror changed outside TABS');
      }
      // Only the generated file is removed. The old folder and other files survive.
      await fsAdapter.remove(previousFile);
    }
  } else {
    const names = await resolveMirrorNames(task.projectId);
    if (!names) throw new Error('Task project or client is missing');
    const taskFile = `${taskMirrorDir(names.clientName, names.projectName, task.id)}/task.md`;
    if (await fsAdapter.exists(taskFile)) {
      const before = previousTask ?? task;
      if (await fsAdapter.readTextFile(taskFile) !== `# ${before.title}\n\n${before.content}`) {
        throw new Error('Task mirror changed outside TABS');
      }
      // Soft-delete only the generated mirror. Other files in the task folder survive.
      await fsAdapter.remove(taskFile);
    }
  }
  for (const projectId of projectIds) {
    const names = await resolveMirrorNames(projectId);
    if (!names) throw new Error('Task project or client is missing');
    const projectDir = projectMirrorDir(names.clientName, names.projectName);
    const tasks = await db.tasks.where('projectId').equals(projectId).filter((row) => !row.deletedAt).toArray();
    await fsAdapter.mkdir(projectDir, true);
    await fsAdapter.writeTextFile(`${projectDir}/INDEX.md`, formatProjectIndex(names.projectName, tasks));
  }
}

/** Copy living tasks to TASKS/<client>/<project>/<id>/; leave old TASKS/<project>/ trees in place. */
async function migrateTaskFiles(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    if (task.deletedAt) continue;
    await syncTaskToFile(task);
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
      if (isTauriRuntime()) {
        void migrateTaskFiles(get().tasks);
      }
    } catch (err) {
      set({ isLoaded: true });
      showError(err, 'Failed to load tasks.');
    }
  },

  refreshTasksFromDb: async () => {
    const tasks = await db.tasks.filter((task) => !task.deletedAt).toArray();
    set((state) => ({ tasks,
      openTabs: state.openTabs.map((tab) => tab.taskId && !tasks.some((task) => task.id === tab.taskId)
        ? { ...tab, taskId: null } : tab),
      activeTaskId: state.activeTaskId && tasks.some((task) => task.id === state.activeTaskId)
        ? state.activeTaskId : null,
      openTaskIds: state.openTaskIds.filter((id) => tasks.some((task) => task.id === id)),
    }));
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
      parentTaskId: opts.parentTaskId,
      assignees: opts.assignees ?? [],
      createdAt: now,
      updatedAt: now,
      sourcePath: opts.sourcePath ?? undefined,
      order: get().tasks.length,
      sourceChatMessageId: opts.sourceChatMessageId ?? undefined,
    };
    try {
      await db.transaction('rw', db.tasks, db.projects, async () => {
        if (!await db.projects.get(projectId)) throw new Error('Task project is missing');
        if (task.parentTaskId) {
          assertSubtaskParent(await db.tasks.get(task.parentTaskId), projectId);
        }
        await db.tasks.add(task);
      });
      try {
        await syncCodexTaskProjection(task);
      } catch (error) {
        showError(error, 'Task created, but its file mirror needs attention.');
      }
      
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
    const nextUpdatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
    const optimisticPatch = { ...enforcedUpdates, updatedAt: nextUpdatedAt } as Task;
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...optimisticPatch } : t)),
    }));
    try {
      const { before, after } = await db.transaction('rw', db.tasks, db.projects, async () => {
        const current = await db.tasks.get(id);
        if (!current || current.deletedAt) throw new Error('Task is unavailable');
        const projectId = enforcedUpdates.projectId ?? current.projectId;
        if (projectId !== current.projectId) {
          const [source, target, childCount] = await Promise.all([
            db.projects.get(current.projectId), db.projects.get(projectId),
            db.tasks.where('parentTaskId').equals(id).filter((child) => !child.deletedAt).count(),
          ]);
          if (!source || !target || source.clientId !== target.clientId) {
            throw new Error('Project assignment is outside the task client');
          }
          assertTaskProjectChange(current, projectId, childCount);
          if (nameKey(sanitizeFsName(source.name)) === nameKey(sanitizeFsName(target.name))) {
            throw new Error('Project assignment would overlap the existing task mirror');
          }
        }
        const next: Task = { ...current, ...enforcedUpdates,
          updatedAt: Math.max(nextUpdatedAt, current.updatedAt + 1) };
        await db.tasks.put(next);
        return { before: current, after: next };
      });
      await get().refreshTasksFromDb();
      try {
        await syncCodexTaskProjection(after, before);
      } catch (error) {
        showError(error, 'Task saved, but its file mirror needs attention.');
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
    try {
      const change = await db.transaction('rw', db.tasks, async () => {
        const task = await db.tasks.get(id);
        if (!task || task.deletedAt) throw new Error('Task is unavailable');
        assertTaskSoftDelete(await db.tasks.where('parentTaskId').equals(id)
          .filter((child) => !child.deletedAt).count());
        const after: Task = { ...task, deletedAt: Date.now(),
          updatedAt: Math.max(Date.now(), task.updatedAt + 1) };
        await db.tasks.put(after);
        return { before: task, after };
      });
      await get().refreshTasksFromDb();
      useUIStore.getState().setActiveTaskId(get().activeTaskId);
      try {
        await syncCodexTaskProjection(change.after, change.before);
      } catch (error) {
        showError(error, 'Task deleted, but its file mirror needs attention.');
      }
    } catch (err) {
      showError(err, 'Failed to delete task.');
    }
  },

  restoreTask: async (id) => {
    try {
      const change = await db.transaction('rw', db.tasks, async () => {
        const task = await db.tasks.get(id);
        if (!task?.deletedAt) throw new Error('Deleted task is unavailable');
        if (task.parentTaskId) {
          assertSubtaskParent(await db.tasks.get(task.parentTaskId), task.projectId);
        }
        const after: Task = { ...task, deletedAt: undefined,
          updatedAt: Math.max(Date.now(), task.updatedAt + 1) };
        await db.tasks.put(after);
        return { before: task, after };
      });
      try {
        await syncCodexTaskProjection(change.after, change.before);
      } catch (error) {
        showError(error, 'Task restored, but its file mirror needs attention.');
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
    try {
      const taskToDelete = await db.transaction('rw', db.tasks, async () => {
        const task = await db.tasks.get(id);
        if (!task) throw new Error('Task is unavailable');
        assertTaskSoftDelete(await db.tasks.where('parentTaskId').equals(id).count());
        await db.tasks.delete(id);
        return task;
      });
      await get().refreshTasksFromDb();
      useUIStore.getState().setActiveTaskId(get().activeTaskId);
      try {
        await syncCodexTaskProjection({ ...taskToDelete, deletedAt: taskToDelete.deletedAt ?? Date.now() }, taskToDelete);
      } catch (error) {
        showError(error, 'Task removed, but its file mirror needs attention.');
      }
    } catch (err) {
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
