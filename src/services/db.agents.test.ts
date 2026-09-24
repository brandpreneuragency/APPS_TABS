import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upgrades, transaction, rows, settings, schemas } = vi.hoisted(() => {
  const rows: { id: string; name: string; systemPrompt: string; scope?: string }[] = [];
  const settings = new Map<string, { key: string; value: string }>();
  const transaction = {
    table: (name: string) => {
      if (name !== 'agents' && name !== 'settings') throw new Error('Unexpected table: ' + name);
      return {
        toCollection: () => ({ modify: async (change: (row: typeof rows[number]) => void) => { rows.forEach(change); } }),
        toArray: async () => rows,
        get: async (key: string) => settings.get(key),
        put: async (row: { key: string; value: string }) => { settings.set(row.key, row); },
        delete: async (key: string) => { settings.delete(key); },
      };
    },
  };
  return {
    rows, settings, transaction,
    schemas: new Map<number, Record<string, string | null>>(),
    upgrades: new Map<number, (input: typeof transaction) => Promise<void>>(),
  };
});

vi.mock('dexie', () => ({
  default: class {
    version(version: number) {
      return {
        stores: (schema: Record<string, string | null>) => {
          schemas.set(version, schema);
          return { upgrade: (callback: (input: typeof transaction) => Promise<void>) => upgrades.set(version, callback) };
        },
      };
    }
  },
}));

import './db';

beforeEach(() => {
  rows.splice(0, rows.length,
    { id: 'writer', name: 'My writer', systemPrompt: 'Keep my writing prompt', scope: 'writer' },
    { id: 'task', name: 'My planner', systemPrompt: 'Keep my planning prompt', scope: 'task' },
  );
  settings.clear();
});

describe('agent database migration', () => {
  it('removes categories while preserving agent identities and prompts', async () => {
    settings.set('activeTaskAgentId', { key: 'activeTaskAgentId', value: 'task' });
    await upgrades.get(14)!(transaction);
    expect(schemas.get(14)).toEqual({ agents: 'id, name, isDefault' });
    expect(rows).toEqual([
      { id: 'writer', name: 'My writer', systemPrompt: 'Keep my writing prompt' },
      { id: 'task', name: 'My planner', systemPrompt: 'Keep my planning prompt' },
    ]);
    expect(settings.get('activeAgentId')?.value).toBe('task');
    expect(settings.has('activeTaskAgentId')).toBe(false);
  });

  it('keeps the shared selection when both legacy selections exist', async () => {
    settings.set('activeAgentId', { key: 'activeAgentId', value: 'writer' });
    settings.set('activeTaskAgentId', { key: 'activeTaskAgentId', value: 'task' });
    await upgrades.get(14)!(transaction);
    expect(settings.get('activeAgentId')?.value).toBe('writer');
  });

  it('replaces a stale selection and tolerates an empty agent table', async () => {
    settings.set('activeAgentId', { key: 'activeAgentId', value: 'gone' });
    await upgrades.get(14)!(transaction);
    expect(settings.get('activeAgentId')?.value).toBe('writer');
    rows.length = 0;
    settings.clear();
    await upgrades.get(14)!(transaction);
    expect(settings.has('activeAgentId')).toBe(false);
  });
});

