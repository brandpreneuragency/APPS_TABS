import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { ensureGeneralProjectRecord } from './taskTreeNames';

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
