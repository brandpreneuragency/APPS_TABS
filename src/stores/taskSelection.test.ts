import { describe, expect, it } from 'vitest';
import {
  filterTasksForSelection,
  kanbanColumnsForClient,
  projectsForClient,
} from './taskSelection';

const projects = [
  { id: 'p-gen', name: 'General', color: 'c1', clientId: 'c1' },
  { id: 'p-web', name: 'Website', color: 'c1b', clientId: 'c1' },
  { id: 'p-other', name: 'Other', color: 'c2', clientId: 'c2' },
];

const tasks = [
  { id: 't1', projectId: 'p-gen' },
  { id: 't2', projectId: 'p-web' },
  { id: 't3', projectId: 'p-other' },
  { id: 't-del', projectId: 'p-gen', deletedAt: 100 },
];

describe('filterTasksForSelection', () => {
  it('returns all living tasks when nothing is selected', () => {
    const out = filterTasksForSelection(tasks, projects, null, null);
    expect(out.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('returns living tasks for one project when a project is selected', () => {
    const out = filterTasksForSelection(tasks, projects, 'c1', 'p-web');
    expect(out.map((t) => t.id)).toEqual(['t2']);
  });

  it('uses selectedProjectId even if it disagrees with selectedClientId', () => {
    const out = filterTasksForSelection(tasks, projects, 'c1', 'p-other');
    expect(out.map((t) => t.id)).toEqual(['t3']);
  });

  it('returns living tasks for all projects of the selected client when no project is selected', () => {
    const out = filterTasksForSelection(tasks, projects, 'c1', null);
    expect(out.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('excludes tasks with a truthy deletedAt', () => {
    const out = filterTasksForSelection(tasks, projects, 'c1', 'p-gen');
    expect(out.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('projectsForClient', () => {
  it('returns projects belonging to the client', () => {
    expect(projectsForClient(projects, 'c1').map((p) => p.id)).toEqual(['p-gen', 'p-web']);
  });

  it('returns an empty array when clientId is null', () => {
    expect(projectsForClient(projects, null)).toEqual([]);
  });
});

describe('kanbanColumnsForClient', () => {
  it('returns an empty array when no client is selected', () => {
    expect(kanbanColumnsForClient(projects, tasks, null)).toEqual([]);
  });

  it('builds one column per client project with living task ids', () => {
    expect(kanbanColumnsForClient(projects, tasks, 'c1')).toEqual([
      { id: 'p-gen', name: 'General', color: 'c1', taskIds: ['t1'] },
      { id: 'p-web', name: 'Website', color: 'c1b', taskIds: ['t2'] },
    ]);
  });
});
