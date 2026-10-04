import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadTasks,
  projectSetState,
  transaction,
  modify,
  bulkDelete,
  clientsDelete,
  clientsToArray,
  projectsToArray,
  projectsWhereToArray,
} = vi.hoisted(() => ({
  loadTasks: vi.fn(),
  projectSetState: vi.fn(),
  transaction: vi.fn(),
  modify: vi.fn(),
  bulkDelete: vi.fn(),
  clientsDelete: vi.fn(),
  clientsToArray: vi.fn(),
  projectsToArray: vi.fn(),
  projectsWhereToArray: vi.fn(),
}));

vi.mock('../services/db', () => ({
  db: {
    settings: {},
    table: () => ({ get: async () => undefined }),
    transaction: (...args: unknown[]) => transaction(...args),
    clients: {
      delete: (...args: unknown[]) => clientsDelete(...args),
      toArray: (...args: unknown[]) => clientsToArray(...args),
    },
    projects: {
      where: () => ({
        equals: () => ({
          toArray: (...args: unknown[]) => projectsWhereToArray(...args),
        }),
      }),
      bulkDelete: (...args: unknown[]) => bulkDelete(...args),
      toArray: (...args: unknown[]) => projectsToArray(...args),
    },
    tasks: {
      where: () => ({
        equals: () => ({
          modify: (...args: unknown[]) => modify(...args),
        }),
      }),
    },
  },
}));

vi.mock('./uiStore', () => ({
  useUIStore: {
    getState: () => ({ showToast: vi.fn() }),
  },
}));

vi.mock('./projectStore', () => ({
  useProjectStore: Object.assign(vi.fn(), {
    getState: vi.fn(),
    setState: (...args: unknown[]) => projectSetState(...args),
  }),
  repairClientsLayerIfNeeded: vi.fn(),
  seedGeneralClientAndProject: vi.fn(),
}));

vi.mock('./taskStore', () => ({
  useTaskStore: Object.assign(vi.fn(), {
    getState: () => ({ loadTasks }),
  }),
}));

import { useClientStore } from './clientStore';

describe('deleteClient cascade', () => {
  beforeEach(() => {
    loadTasks.mockReset().mockResolvedValue(undefined);
    projectSetState.mockReset();
    modify.mockReset().mockResolvedValue(undefined);
    bulkDelete.mockReset().mockResolvedValue(undefined);
    clientsDelete.mockReset().mockResolvedValue(undefined);
    clientsToArray.mockReset().mockResolvedValue([]);
    projectsToArray.mockReset().mockResolvedValue([]);
    projectsWhereToArray.mockReset().mockResolvedValue([{ id: 'p1', clientId: 'c1' }]);
    transaction.mockReset().mockImplementation(async (...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') return cb();
    });
    useClientStore.setState({
      clients: [{ id: 'c1', name: 'Brandpreneur', color: 'text-blue-500', createdAt: 0, order: 0 }],
      isLoaded: true,
    });
  });

  it('wraps cascade Dexie writes in a transaction', async () => {
    await useClientStore.getState().deleteClient('c1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toBe('rw');
    expect(clientsDelete).toHaveBeenCalledWith('c1');
    expect(bulkDelete).toHaveBeenCalledWith(['p1']);
    expect(modify).toHaveBeenCalled();
    expect(loadTasks).toHaveBeenCalledTimes(1);
  });

  it('reloads clients, projects, and tasks when delete fails', async () => {
    transaction.mockRejectedValue(new Error('boom'));

    await useClientStore.getState().deleteClient('c1');

    expect(clientsToArray).toHaveBeenCalled();
    expect(projectsToArray).toHaveBeenCalled();
    expect(loadTasks).toHaveBeenCalledTimes(1);
    expect(projectSetState).toHaveBeenCalledWith({ projects: [] });
  });
});
