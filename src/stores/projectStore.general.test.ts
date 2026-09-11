import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import {
  ensureGeneralProjectRecord,
  findProjectByNameInClient,
  isNameTaken,
  shouldRepairClientsLayer,
  shouldSeedEmptyClientsLayer,
} from './taskTreeNames';

function project(partial: Partial<Project> & Pick<Project, 'id' | 'name' | 'clientId'>): Project {
  return {
    color: 'text-blue-500',
    createdAt: 1,
    order: 0,
    ...partial,
  };
}

describe('ensureGeneralProjectRecord', () => {
  it('returns the existing General project for that client (name key general)', () => {
    const existing = [
      project({ id: 'g1', name: 'GENERAL', clientId: 'c1' }),
      project({ id: 'g2', name: 'General', clientId: 'c2' }),
    ];
    const out = ensureGeneralProjectRecord('c1', existing, {
      id: () => 'new-id',
      now: 99,
      color: 'text-rose-500',
    });
    expect(out.created).toBe(false);
    expect(out.project).toBe(existing[0]);
  });

  it('creates a General project when the client has none', () => {
    const existing = [
      project({ id: 'p1', name: 'Launch', clientId: 'c1', order: 1 }),
    ];
    const out = ensureGeneralProjectRecord('c1', existing, {
      id: () => 'gen-1',
      now: 50,
      color: 'text-amber-500',
    });
    expect(out.created).toBe(true);
    expect(out.project).toEqual({
      id: 'gen-1',
      name: 'General',
      color: 'text-amber-500',
      clientId: 'c1',
      createdAt: 50,
      order: 0,
    });
  });

  it('does not reuse another client\'s General', () => {
    const existing = [project({ id: 'g2', name: 'General', clientId: 'c2' })];
    const out = ensureGeneralProjectRecord('c1', existing, {
      id: () => 'n',
      now: 1,
      color: 'c',
    });
    expect(out.created).toBe(true);
    expect(out.project.clientId).toBe('c1');
    expect(out.project.id).toBe('n');
    expect(out.project.name).toBe('General');
    expect(out.project.order).toBe(0);
  });
});

describe('shouldRepairClientsLayer', () => {
  it('is true only when clients are empty and every project lacks clientId', () => {
    expect(shouldRepairClientsLayer([], [{ clientId: '' }, {}])).toBe(true);
    expect(shouldRepairClientsLayer([], [{ clientId: undefined }])).toBe(true);
  });

  it('is false when clients exist, projects already have clientId, or there are no projects', () => {
    expect(shouldRepairClientsLayer([{ id: 'c' }], [{ clientId: '' }])).toBe(false);
    expect(shouldRepairClientsLayer([], [{ clientId: 'c1' }])).toBe(false);
    expect(shouldRepairClientsLayer([], [])).toBe(false);
    expect(shouldRepairClientsLayer([], [{ clientId: 'c1' }, { clientId: '' }])).toBe(false);
  });
});

describe('shouldSeedEmptyClientsLayer', () => {
  it('is true only when clients, projects, and tasks are all empty', () => {
    expect(shouldSeedEmptyClientsLayer([], [], [])).toBe(true);
  });

  it('does not seed when leftover tasks exist (including trash)', () => {
    expect(shouldSeedEmptyClientsLayer([], [], [{ id: 't' }])).toBe(false);
  });

  it('does not seed when a client or project remains', () => {
    expect(shouldSeedEmptyClientsLayer([{ id: 'c' }], [], [])).toBe(false);
    expect(shouldSeedEmptyClientsLayer([], [{ id: 'p' }], [])).toBe(false);
  });
});

describe('findProjectByNameInClient', () => {
  it('matches by name key within the given client only', () => {
    const projects = [
      project({ id: 'g1', name: 'General', clientId: 'c1' }),
      project({ id: 'g2', name: 'General', clientId: 'c2' }),
      project({ id: 'p1', name: 'Launch', clientId: 'c1' }),
    ];
    expect(findProjectByNameInClient('GENERAL', 'c1', projects)?.id).toBe('g1');
    expect(findProjectByNameInClient('Launch', 'c2', projects)).toBeUndefined();
    expect(findProjectByNameInClient('General', '', projects)).toBeUndefined();
  });

  it('treats a rename as taken only among other projects of the same client', () => {
    const projects = [
      project({ id: 'a', name: 'Launch', clientId: 'c1' }),
      project({ id: 'b', name: 'LAUNCH', clientId: 'c1' }),
      project({ id: 'c', name: 'Launch', clientId: 'c2' }),
    ];
    const siblingsC1 = projects.filter((p) => p.clientId === 'c1' && p.id !== 'a').map((p) => p.name);
    expect(isNameTaken('launch', siblingsC1)).toBe(true);
    const siblingsC2 = projects.filter((p) => p.clientId === 'c2' && p.id !== 'c').map((p) => p.name);
    expect(isNameTaken('launch', siblingsC2)).toBe(false);
  });
});
