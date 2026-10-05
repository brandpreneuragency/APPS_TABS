// Project store. Local-first using Dexie (Tauri desktop).
// IndexedDB is the offline cache when VPS task authority is connected.

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Client, Project, Task } from '../types';
import { db } from '../services/db';
import { readMetadata, recordTaskDeletion } from '../services/taskAuthority/cache';
import i18n from '../i18n';
import { useUIStore } from './uiStore';
import { useTaskStore } from './taskStore';
import { useClientStore } from './clientStore';
import { migrateProjectsToClients, type LegacyTask } from './migrateProjectsToClients';
import {
  TREE_COLORS,
  ensureGeneralProjectRecord,
  isNameTaken,
  nameKey,
  normalizeTreeName,
  shouldRepairClientsLayer,
  shouldSeedEmptyClientsLayer,
} from './taskTreeNames';

function showError(err: unknown, fallback: string): void {
  const msg = err instanceof Error ? err.message : fallback;
  useUIStore.getState().showToast(msg, 'error');
}

export async function repairClientsLayerIfNeeded(): Promise<void> {
  if (await readMetadata(db)) return;
  const clients = await db.clients.toArray();
  const projects = await db.projects.toArray();
  if (!shouldRepairClientsLayer(clients, projects)) return;
  const tasks = await db.tasks.toArray();
  const out = migrateProjectsToClients(projects, tasks as unknown as LegacyTask[], {
    id: () => nanoid(8),
    now: Date.now(),
  });
  if (out.clients.length === 0) return;
  await db.transaction('rw', db.clients, db.projects, db.tasks, async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.tasks.clear();
    await db.clients.bulkAdd(out.clients);
    await db.projects.bulkAdd(out.projects);
    await db.tasks.bulkAdd(out.tasks as unknown as Task[]);
  });
}

export async function seedGeneralClientAndProject(): Promise<{ client: Client; project: Project }> {
  const now = Date.now();
  const client: Client = {
    id: nanoid(8),
    name: 'General',
    color: TREE_COLORS[0],
    createdAt: now,
    order: 0,
  };
  const { project } = ensureGeneralProjectRecord(client.id, [], {
    id: () => nanoid(8),
    now,
    color: client.color,
  });
  await db.clients.add(client);
  await db.projects.add(project);
  return { client, project };
}

interface ProjectStore {
  projects: Project[];
  isLoaded: boolean;

  loadProjects: () => Promise<void>;
  createProject: (name: string, clientId: string) => Promise<Project | null>;
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'color' | 'clientId'>>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  reorderProject: (id: string, targetId: string, after: boolean) => Promise<void>;
  getProjectById: (id: string | null) => Project | undefined;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  isLoaded: false,

  loadProjects: async () => {
    try {
      await repairClientsLayerIfNeeded();
      let projects = await db.projects.toArray();
      const clients = await db.clients.toArray();
      const tasks = await db.tasks.toArray();
      if (!await readMetadata(db) && shouldSeedEmptyClientsLayer(clients, projects, tasks)) {
        const seeded = await seedGeneralClientAndProject();
        projects = [seeded.project];
      }
      set({ projects, isLoaded: true });
    } catch (err) {
      set({ isLoaded: true });
      showError(err, 'Failed to load projects.');
    }
  },

  createProject: async (name, clientId) => {
    if (!clientId) return null;
    const trimmed = normalizeTreeName(name);
    if (!trimmed) return null;
    const siblings = get().projects.filter((p) => p.clientId === clientId);
    if (isNameTaken(trimmed, siblings.map((p) => p.name))) return null;
    const id = nanoid(8);
    const color = TREE_COLORS[get().projects.length % TREE_COLORS.length];
    const now = Date.now();
    const project: Project = {
      id,
      name: trimmed,
      color,
      clientId,
      createdAt: now,
      order: siblings.reduce((maximum, sibling) => Math.max(maximum, sibling.order), -1) + 1,
    };
    try {
      await db.projects.add(project);
      set((s) => ({ projects: [...s.projects, project] }));
      return project;
    } catch (err) {
      showError(err, 'Failed to create project.');
      return null;
    }
  },

  updateProject: async (id, updates) => {
    const previous = get().projects.find((p) => p.id === id);
    if (!previous) return;
    const next = updates.name !== undefined
      ? { ...updates, name: normalizeTreeName(updates.name) }
      : updates;
    if (next.name !== undefined && !next.name) return;
    if (next.clientId !== undefined && !useClientStore.getState().clients.some((client) => client.id === next.clientId)) return;
    if (next.name !== undefined || next.clientId !== undefined) {
      const others = get().projects
        .filter((p) => p.clientId === (next.clientId ?? previous.clientId) && p.id !== id)
        .map((p) => p.name);
      if (isNameTaken(next.name ?? previous.name, others)) {
        useUIStore.getState().showToast(i18n.t('tasks.projectClientConflict'), 'error');
        return;
      }
    }
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...next } : p)),
    }));
    try {
      await db.projects.update(id, next);
    } catch (err) {
      if (previous) {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? previous : p)),
        }));
      }
      showError(err, 'Failed to update project.');
    }
  },

  reorderProject: async (id, targetId, after) => {
    if (id === targetId) return;
    try {
      const orders = await db.transaction('rw', db.projects, async () => {
        const source = await db.projects.get(id);
        const target = await db.projects.get(targetId);
        if (!source || !target || source.clientId !== target.clientId) return null;
        const siblings = (await db.projects.toArray())
          .filter((project) => project.clientId === source.clientId && project.id !== id)
          .sort((left, right) => left.order - right.order);
        const targetIndex = siblings.findIndex((project) => project.id === targetId);
        siblings.splice(targetIndex + (after ? 1 : 0), 0, source);
        const nextOrders = new Map(siblings.map((project, order) => [project.id, order]));
        await Promise.all(siblings.map((project, order) => db.projects.update(project.id, { order })));
        return nextOrders;
      });
      if (orders) set((state) => ({ projects: state.projects.map((project) =>
        orders.has(project.id) ? { ...project, order: orders.get(project.id)! } : project) }));
    } catch (err) {
      showError(err, 'Failed to reorder projects.');
    }
  },

  deleteProject: async (id) => {
    const project = get().projects.find((p) => p.id === id);
    if (!project) return;
    try {
      let createdGeneral: Project | null = null;
      await db.transaction('rw', db.projects, db.tasks, db.settings, async () => {
        const isGeneral = nameKey(project.name) === 'general';
        if (isGeneral) {
          const now = Date.now();
          await db.tasks.where('projectId').equals(id).modify((t) => {
            if (!t.deletedAt) t.deletedAt = now;
          });
        } else {
          const { project: general, created } = ensureGeneralProjectRecord(
            project.clientId,
            get().projects,
            { id: () => nanoid(8), now: Date.now(), color: project.color },
          );
          if (created) {
            await db.projects.add(general);
            createdGeneral = general;
          }
          await db.tasks.where('projectId').equals(id).modify({ projectId: general.id });
        }
        await recordTaskDeletion(db, [{ table: 'projects', id }]);
        await db.projects.delete(id);
      });
      set((s) => ({
        projects: [
          ...s.projects.filter((p) => p.id !== id),
          ...(createdGeneral ? [createdGeneral] : []),
        ],
      }));
      await useTaskStore.getState().loadTasks();
    } catch (err) {
      useClientStore.setState({ clients: await db.clients.toArray() });
      set({ projects: await db.projects.toArray() });
      await useTaskStore.getState().loadTasks();
      showError(err, 'Failed to delete project.');
    }
  },

  getProjectById: (id) => {
    if (!id) return undefined;
    return get().projects.find((p) => p.id === id);
  },
}));
