import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../services/db';
import { useProjectStore } from './projectStore';

const projects = [
  { id: 'first', name: 'First', clientId: 'client', order: 0, color: '', createdAt: 1 },
  { id: 'second', name: 'Second', clientId: 'client', order: 1, color: '', createdAt: 1 },
  { id: 'third', name: 'Third', clientId: 'client', order: 2, color: '', createdAt: 1 },
  { id: 'other', name: 'Other', clientId: 'other-client', order: 5, color: '', createdAt: 1 },
];

beforeEach(async () => {
  await db.projects.clear();
  await db.projects.bulkPut(projects);
  useProjectStore.setState({ projects });
});

describe('project group reordering', () => {
  it('appends newly created projects after sparse order values', async () => {
    const created = await useProjectStore.getState().createProject('New', 'other-client');
    expect(created?.order).toBe(6);
  });

  it('persists both drop directions and preserves other groups', async () => {
    await useProjectStore.getState().reorderProject('first', 'third', true);
    expect(useProjectStore.getState().projects.filter((project) => project.clientId === 'client')
      .sort((left, right) => left.order - right.order).map((project) => project.id))
      .toEqual(['second', 'third', 'first']);
    await useProjectStore.getState().reorderProject('first', 'second', false);
    expect(await db.projects.get('first')).toMatchObject({ order: 0 });
    expect(await db.projects.get('second')).toMatchObject({ order: 1 });
    expect(await db.projects.get('third')).toMatchObject({ order: 2 });
    expect(await db.projects.get('other')).toEqual(projects[3]);
    await useProjectStore.getState().loadProjects();
    expect(useProjectStore.getState().projects.find((project) => project.id === 'first')?.order).toBe(0);
  });

  it('rejects cross-group, missing and self drops', async () => {
    await useProjectStore.getState().reorderProject('first', 'other', true);
    await useProjectStore.getState().reorderProject('missing', 'first', true);
    await useProjectStore.getState().reorderProject('first', 'first', true);
    expect(useProjectStore.getState().projects).toEqual(projects);
    expect(await db.projects.get('first')).toEqual(projects[0]);
  });
});
