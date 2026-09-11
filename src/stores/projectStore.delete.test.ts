import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';

const {
  loadTasks,
  clientSetState,
  transaction,
  tasksModify,
  projectsAdd,
  projectsDelete,
  projectsToArray,
  clientsToArray,
} = vi.hoisted(() => ({
  loadTasks: vi.fn(),
  clientSetState: vi.fn(),
  transaction: vi.fn(),
  tasksModify: vi.fn(),
  projectsAdd: vi.fn(),
  projectsDelete: vi.fn(),
  projectsToArray: vi.fn(),
  clientsToArray: vi.fn(),
}));

vi.mock('../services/db', () => ({
  db: {
    transaction: (...args: unknown[]) => transaction(...args),
    clients: {
      toArray: (...args: unknown[]) => clientsToArray(...args),
    },
    projects: {
      add: (...args: unknown[]) => projectsAdd(...args),
      delete: (...args: unknown[]) => projectsDelete(...args),
      toArray: (...args: unknown[]) => projectsToArray(...args),
    },
    tasks: {
      where: () => ({
        equals: () => ({
          modify: (...args: unknown[]) => tasksModify(...args),
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

vi.mock('./taskStore', () => ({
  useTaskStore: Object.assign(vi.fn(), {
    getState: () => ({ loadTasks }),
  }),
}));

vi.mock('./clientStore', () => ({
  useClientStore: Object.assign(vi.fn(), {
    setState: (...args: unknown[]) => clientSetState(...args),
  }),
}));

import { useProjectStore } from './projectStore';

function project(partial: Partial<Project> & Pick<Project, 'id' | 'name' | 'clientId'>): Project {
  return {
    color: 'text-blue-500',
    createdAt: 1,
    order: 0,
    ...partial,
  };
}

describe('deleteProject cascade', () => {
  beforeEach(() => {
    loadTasks.mockReset().mockResolvedValue(undefined);
    clientSetState.mockReset();
    tasksModify.mockReset().mockResolvedValue(undefined);
    projectsAdd.mockReset().mockResolvedValue(undefined);
    projectsDelete.mockReset().mockResolvedValue(undefined);
    projectsToArray.mockReset().mockResolvedValue([]);
    clientsToArray.mockReset().mockResolvedValue([]);
    transaction.mockReset().mockImplementation(async (...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') return cb();
    });
    useProjectStore.setState({
      projects: [
        project({ id: 'p-gen', name: 'General', clientId: 'c1' }),
        project({ id: 'p-web', name: 'Website', clientId: 'c1', order: 1 }),
      ],
      isLoaded: true,
    });
  });

  it('wraps cascade Dexie writes in a transaction', async () => {
    await useProjectStore.getState().deleteProject('p-web');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toBe('rw');
    expect(projectsDelete).toHaveBeenCalledWith('p-web');
    expect(tasksModify).toHaveBeenCalledWith({ projectId: 'p-gen' });
    expect(projectsAdd).not.toHaveBeenCalled();
    expect(loadTasks).toHaveBeenCalledTimes(1);
  });

  it('reloads clients, projects, and tasks when delete fails', async () => {
    transaction.mockRejectedValue(new Error('boom'));

    await useProjectStore.getState().deleteProject('p-web');

    expect(clientsToArray).toHaveBeenCalled();
    expect(projectsToArray).toHaveBeenCalled();
    expect(loadTasks).toHaveBeenCalledTimes(1);
    expect(clientSetState).toHaveBeenCalledWith({ clients: [] });
  });
});
