// Client store. Local-first using Dexie (Tauri desktop).
// Tasks-module entity — not CRM.

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Client } from '../types';
import { db } from '../services/db';
import { useUIStore } from './uiStore';
import { useProjectStore, repairClientsLayerIfNeeded } from './projectStore';
import { useTaskStore } from './taskStore';
import {
  TREE_COLORS,
  ensureGeneralProjectRecord,
  isNameTaken,
  normalizeTreeName,
} from './taskTreeNames';

function showError(err: unknown, fallback: string): void {
  const msg = err instanceof Error ? err.message : fallback;
  useUIStore.getState().showToast(msg, 'error');
}

interface ClientStore {
  clients: Client[];
  isLoaded: boolean;

  loadClients: () => Promise<void>;
  createClient: (name: string) => Promise<Client | null>;
  updateClient: (id: string, updates: Partial<Pick<Client, 'name' | 'color'>>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  getClientById: (id: string | null) => Client | undefined;
}

export const useClientStore = create<ClientStore>((set, get) => ({
  clients: [],
  isLoaded: false,

  loadClients: async () => {
    try {
      await repairClientsLayerIfNeeded();
      let clients = await db.clients.toArray();
      if (clients.length === 0 && (await db.projects.count()) === 0) {
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
        clients = [client];
      }
      set({ clients, isLoaded: true });
    } catch (err) {
      set({ isLoaded: true });
      showError(err, 'Failed to load clients.');
    }
  },

  createClient: async (name) => {
    const trimmed = normalizeTreeName(name);
    if (!trimmed) return null;
    if (isNameTaken(trimmed, get().clients.map((c) => c.name))) return null;
    const id = nanoid(8);
    const color = TREE_COLORS[get().clients.length % TREE_COLORS.length];
    const now = Date.now();
    const client: Client = {
      id,
      name: trimmed,
      color,
      createdAt: now,
      order: get().clients.length,
    };
    try {
      await db.clients.add(client);
      set((s) => ({ clients: [...s.clients, client] }));
      await useProjectStore.getState().createProject('General', client.id);
      return client;
    } catch (err) {
      showError(err, 'Failed to create client.');
      return null;
    }
  },

  updateClient: async (id, updates) => {
    const previous = get().clients.find((c) => c.id === id);
    if (!previous) return;
    const next = updates.name !== undefined
      ? { ...updates, name: normalizeTreeName(updates.name) }
      : updates;
    if (next.name !== undefined && !next.name) return;
    if (next.name !== undefined) {
      const others = get().clients.filter((c) => c.id !== id).map((c) => c.name);
      if (isNameTaken(next.name, others)) return;
    }
    set((s) => ({
      clients: s.clients.map((c) => (c.id === id ? { ...c, ...next } : c)),
    }));
    try {
      await db.clients.update(id, next);
    } catch (err) {
      set((s) => ({
        clients: s.clients.map((c) => (c.id === id ? previous : c)),
      }));
      showError(err, 'Failed to update client.');
    }
  },

  deleteClient: async (id) => {
    if (!get().clients.some((c) => c.id === id)) return;
    try {
      const projects = await db.projects.where('clientId').equals(id).toArray();
      const now = Date.now();
      for (const project of projects) {
        await db.tasks.where('projectId').equals(project.id).modify((t) => {
          if (!t.deletedAt) t.deletedAt = now;
        });
      }
      const projectIds = projects.map((p) => p.id);
      if (projectIds.length > 0) {
        await db.projects.bulkDelete(projectIds);
      }
      await db.clients.delete(id);
      set((s) => ({ clients: s.clients.filter((c) => c.id !== id) }));
      await useProjectStore.getState().loadProjects();
      await useTaskStore.getState().loadTasks();
      set({ clients: await db.clients.toArray() });
    } catch (err) {
      set({ clients: await db.clients.toArray() });
      showError(err, 'Failed to delete client.');
    }
  },

  getClientById: (id) => {
    if (!id) return undefined;
    return get().clients.find((c) => c.id === id);
  },
}));
