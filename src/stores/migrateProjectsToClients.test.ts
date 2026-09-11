import { describe, expect, it } from 'vitest';
import { migrateProjectsToClients } from './migrateProjectsToClients';

function ids(seq: string[]) {
  let i = 0;
  return () => seq[i++] ?? `id-${i}`;
}

describe('migrateProjectsToClients', () => {
  it('turns each old project into a client with a General project and rewrites tasks', () => {
    const out = migrateProjectsToClients(
      [{ id: 'p-brp', name: 'Brandpreneur', color: 'text-amber-500', createdAt: 1, order: 0 }],
      [{ id: 't1', projectId: 'p-brp', title: 'Yeni web sitesi' }],
      { id: ids(['c1', 'g1']), now: 100 },
    );
    expect(out.clients).toEqual([
      { id: 'c1', name: 'Brandpreneur', color: 'text-amber-500', createdAt: 1, order: 0 },
    ]);
    expect(out.projects).toEqual([
      { id: 'g1', name: 'General', color: 'text-amber-500', clientId: 'c1', createdAt: 100, order: 0 },
    ]);
    expect(out.tasks[0].projectId).toBe('g1');
    expect(out.tasks[0]).not.toHaveProperty('parentId');
  });

  it('flattens subtasks onto the same project', () => {
    const out = migrateProjectsToClients(
      [{ id: 'p1', name: 'WA', color: 'c', createdAt: 1 }],
      [
        { id: 'parent', projectId: 'p1' },
        { id: 'child', projectId: 'p1', parentId: 'parent' },
      ],
      { id: ids(['c1', 'g1']), now: 1 },
    );
    expect(out.tasks.every((t) => t.projectId === 'g1')).toBe(true);
    expect(out.tasks.every((t) => t.parentId === undefined)).toBe(true);
  });

  it('suffixes colliding client names case-insensitively (tr-TR)', () => {
    const out = migrateProjectsToClients(
      [
        { id: 'a', name: 'Wagner Atelier', color: 'c', createdAt: 1 },
        { id: 'b', name: 'WAGNER ATELIER', color: 'c', createdAt: 2 },
      ],
      [],
      { id: ids(['c1', 'g1', 'c2', 'g2']), now: 1 },
    );
    expect(out.clients.map((c) => c.name)).toEqual(['Wagner Atelier', 'WAGNER ATELIER 2']);
  });

  it('sends null/orphan projectId tasks to a General client/project', () => {
    const out = migrateProjectsToClients(
      [],
      [{ id: 'orphan', projectId: null }],
      { id: ids(['c-gen', 'p-gen']), now: 1 },
    );
    expect(out.clients[0].name).toBe('General');
    expect(out.projects[0]).toMatchObject({ name: 'General', clientId: out.clients[0].id });
    expect(out.tasks[0].projectId).toBe(out.projects[0].id);
  });

  it('seeds General client+project when empty', () => {
    const out = migrateProjectsToClients([], [], { id: ids(['c', 'p']), now: 1 });
    expect(out.clients).toHaveLength(1);
    expect(out.projects).toHaveLength(1);
    expect(out.clients[0].name).toBe('General');
    expect(out.projects[0].name).toBe('General');
  });

  it('is a no-op when projects already have clientId and clients exist', () => {
    const projects = [
      { id: 'g', name: 'General', color: 'c', createdAt: 1, clientId: 'c1' },
    ];
    const out = migrateProjectsToClients(
      projects,
      [{ id: 't', projectId: 'g' }],
      { id: ids(['x']), now: 1 },
    );
    expect(out.clients).toEqual([]);
    expect(out.projects).toEqual(projects);
    expect(out.tasks[0].projectId).toBe('g');
  });
});
