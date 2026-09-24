import { create } from 'zustand';
import type { Agent } from '../types';
import { db } from '../services/db';
import { runCodexMigration } from '../services/codex/migration';
import { useUIStore } from './uiStore';

const DEFAULT_AGENT: Agent = {
  id: 'default_agent',
  name: 'Assistant',
  avatarUrl: '',
  systemPrompt: 'Help with writing, planning, tasks, and local work using the captured context. Propose clear changes for review before applying them.',
  isDefault: true,
};

interface AIStore {
  agents: Agent[];
  activeAgentId: string;
  systemInstructions: string;
  isLoaded: boolean;
  loadAISettings: () => Promise<void>;
  saveAgent: (agent: Agent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  setActiveAgent: (id: string) => void;
  getActiveAgent: () => Agent;
  saveSystemInstructions: (text: string) => Promise<void>;
}

function showError(error: unknown, fallback: string): void {
  useUIStore.getState().showToast(error instanceof Error ? error.message : fallback, 'error');
}

export const useAIStore = create<AIStore>((set, get) => ({
  agents: [DEFAULT_AGENT],
  activeAgentId: DEFAULT_AGENT.id,
  systemInstructions: '',
  isLoaded: false,

  loadAISettings: async () => {
    try {
      // Ordinary workspaces and preserved personas still load if credential
      // cleanup is pending. Codex startup has its own migration gate.
      await runCodexMigration().catch(() => undefined);
      const [savedAgents, active, instructions] = await Promise.all([
        db.agents.toArray(), db.settings.get('activeAgentId'), db.settings.get('systemInstructions'),
      ]);
      const agents = savedAgents.length ? savedAgents : [DEFAULT_AGENT];
      const activeAgentId = typeof active?.value === 'string'
        && agents.some((agent) => agent.id === active.value) ? active.value : agents[0].id;
      set({ agents, activeAgentId, systemInstructions: typeof instructions?.value === 'string'
        ? instructions.value : '', isLoaded: true });
    } catch (error) {
      set({ isLoaded: true });
      showError(error, 'Could not load assistant personas');
    }
  },

  saveAgent: async (agent) => {
    try {
      const saved: Agent = { id: agent.id, name: agent.name, avatarUrl: agent.avatarUrl,
        systemPrompt: agent.systemPrompt, isDefault: agent.isDefault };
      await db.agents.put(saved);
      set((state) => ({ agents: state.agents.some((item) => item.id === saved.id)
        ? state.agents.map((item) => item.id === saved.id ? saved : item)
        : [...state.agents, saved] }));
    } catch (error) { showError(error, 'Could not save assistant persona'); }
  },

  deleteAgent: async (id) => {
    const target = get().agents.find((agent) => agent.id === id);
    if (!target || target.isDefault) return;
    try {
      await db.transaction('rw', db.agents, db.settings, async () => {
        await db.agents.delete(id);
        if (get().activeAgentId === id) {
          const next = get().agents.find((agent) => agent.id !== id) ?? DEFAULT_AGENT;
          await db.settings.put({ key: 'activeAgentId', value: next.id });
        }
      });
      const agents = get().agents.filter((agent) => agent.id !== id);
      set({ agents: agents.length ? agents : [DEFAULT_AGENT],
        activeAgentId: get().activeAgentId === id ? (agents[0]?.id ?? DEFAULT_AGENT.id) : get().activeAgentId });
    } catch (error) { showError(error, 'Could not delete assistant persona'); }
  },

  setActiveAgent: (id) => {
    if (!get().agents.some((agent) => agent.id === id)) return;
    set({ activeAgentId: id });
    void db.settings.put({ key: 'activeAgentId', value: id }).catch((error: unknown) => {
      showError(error, 'Could not save active assistant persona');
    });
  },

  getActiveAgent: () => get().agents.find((agent) => agent.id === get().activeAgentId)
    ?? get().agents[0] ?? DEFAULT_AGENT,

  saveSystemInstructions: async (text) => {
    try {
      await db.settings.put({ key: 'systemInstructions', value: text });
      set({ systemInstructions: text });
    } catch (error) { showError(error, 'Could not save assistant instructions'); }
  },
}));
