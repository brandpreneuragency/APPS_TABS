// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { db } from '../db';
import * as fsAdapter from '../fs-adapter';
import { DexieTaskCache, readMetadata } from './cache';
import { desktopTaskTransport } from './desktop';
import { type Reply, type Row, type SyncMetadata } from './model';
import { taskAuthority } from './service';

const cache = new DexieTaskCache(db);
type ProjectionJob = NonNullable<SyncMetadata['projectionJobs']>[number];
let files: Map<string, string>;
let reply: Reply;

function task(id: string, projectId: string, title = id): Task {
  return { id, projectId, title, content: 'Synthetic content', status: 'pending',
    importance: 'medium', date: '2026-10-04', assignees: [], createdAt: 1, updatedAt: 1, order: 0 };
}
function job(key: string, before: Task | null, after: Task | null): ProjectionJob {
  return { key, before: before ? { ...before } : null, after: after ? { ...after } : null };
}
function markdown(value: Task): string { return `# ${value.title}\n\n${value.content}`; }
function path(projectName: string, id: string): string {
  return `TASKS/Client/${projectName}/${id}/task.md`;
}
async function seed(tasks: Task[], jobs: ProjectionJob[] = []) {
  await db.tasks.bulkPut(tasks);
  const baseline = await cache.transaction(async view => (await view.rows()).map(row => ({ ...row, revision: 1 })));
  await cache.transaction(view => view.saveMetadata({ schema: 1, phase: 'active', actor: 'tabs:test',
    databaseId: 'synthetic-authority', generation: 1, baseline, conflicts: [], deletions: [],
    backupPath: 'synthetic-backup', projectionJobs: jobs }));
  reply = { outcome: 'snapshot', snapshot: { schema: 1, initialized: true,
    databaseId: 'synthetic-authority', generation: 1, records: baseline } };
}
function incoming(changes: Row[]) {
  const records = new Map(reply.snapshot.records!.map(row => [JSON.stringify([row.table, row.id]), row]));
  for (const row of changes) {
    const key = JSON.stringify([row.table, row.id]);
    records.set(key, { ...row, revision: (records.get(key)?.revision ?? 0) + 1 });
  }
  reply = { ...reply, snapshot: { ...reply.snapshot, generation: reply.snapshot.generation + 1,
    records: [...records.values()] } };
}
async function queued() { return (await readMetadata(db))!.projectionJobs!; }

beforeEach(async () => {
  taskAuthority.stop();
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  await db.delete();
  await db.open();
  await db.clients.bulkPut([
    { id: 'retired-client', name: 'Client', color: '#fff', createdAt: 1, order: 0 },
    { id: 'healthy-client', name: 'Client', color: '#fff', createdAt: 1, order: 1 },
  ]);
  await db.projects.bulkPut([
    { id: 'retired-project', clientId: 'retired-client', name: 'Retired', color: '#fff', createdAt: 1, order: 0 },
    { id: 'healthy-project', clientId: 'healthy-client', name: 'Healthy', color: '#fff', createdAt: 1, order: 1 },
  ]);
  useClientStore.setState({ clients: [] });
  useProjectStore.setState({ projects: [] });
  useTaskStore.setState({ tasks: [], openTabs: [], openTaskIds: [], activeTaskId: null });
  useTaskCommentStore.setState({ commentsByTask: {} });
  files = new Map();
  vi.spyOn(desktopTaskTransport, 'request').mockImplementation(async request => {
    expect(request.action).toBe('snapshot');
    return structuredClone(reply);
  });
  vi.spyOn(fsAdapter, 'exists').mockImplementation(async file => files.has(file));
  vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async file => {
    if (!files.has(file)) throw new Error(`Synthetic file missing: ${file}`);
    return files.get(file)!;
  });
  vi.spyOn(fsAdapter, 'writeTextFile').mockImplementation(async (file, content) => { files.set(file, content); });
  vi.spyOn(fsAdapter, 'mkdir').mockResolvedValue();
  vi.spyOn(fsAdapter, 'remove').mockImplementation(async file => { files.delete(file); });
});
afterEach(async () => {
  taskAuthority.stop();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  await db.delete();
});

describe('task authority projection queue', () => {
  it.each([
    ['project', 'hard'], ['client', 'hard'], ['project', 'soft'], ['client', 'soft'],
  ] as const)('continues independent jobs after incoming %s deletion with a queued %s-retired task', async (scope, retirement) => {
    const before = task('retired-task', 'retired-project', 'Previous');
    const retired = { ...before, title: 'Already acknowledged' };
    const healthy = task('healthy-task', 'healthy-project', 'Healthy before');
    const next = { ...healthy, title: 'Healthy after' };
    const failed = job('durable-retired', before, retired);
    await seed([retired, healthy], [failed]);
    files.set(path('Retired', before.id), markdown(before));
    files.set('TASKS/Client/Retired/retired-task/manual.md', 'Preserve manual notes');
    files.set(path('Healthy', healthy.id), markdown(healthy));
    incoming([
      { table: 'projects', id: 'retired-project', value: null },
      ...(scope === 'client' ? [{ table: 'clients' as const, id: 'retired-client', value: null }] : []),
      { table: 'tasks', id: retired.id, value: retirement === 'hard' ? null : { ...retired, deletedAt: 2 } },
      { table: 'tasks', id: healthy.id, value: { ...next } },
    ]);

    await taskAuthority.sync();

    expect(files.get(path('Healthy', healthy.id))).toBe(markdown(next));
    expect(files.get(path('Retired', before.id))).toBe(markdown(before));
    expect(files.get('TASKS/Client/Retired/retired-task/manual.md')).toBe('Preserve manual notes');
    const remaining = await queued();
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toEqual(failed);
    expect(remaining[1].before).toEqual(retired);
    expect(remaining[1].after).toEqual(retirement === 'hard' ? null : { ...retired, deletedAt: 2 });
    expect((await readMetadata(db))!.baseline.find(row => row.table === 'projects' && row.id === 'retired-project')?.value).toBeNull();
    expect(useProjectStore.getState().projects.map(project => project.id)).toEqual(['healthy-project']);
    expect(useTaskStore.getState().tasks).toEqual([next]);
    expect(taskAuthority.getSnapshot().state).toBe('online');

    await taskAuthority.sync();
    expect(await queued()).toEqual(remaining);
    expect(files.get(path('Retired', before.id))).toBe(markdown(before));
    expect(fsAdapter.remove).not.toHaveBeenCalled();
  });

  it.each(['same-project', 'path-alias', 'windows-alias', 'partial-index'] as const)(
    'keeps dependent jobs ordered across a retry (%s)', async dependency => {
      await db.projects.put({ id: 'destination-project', clientId: 'healthy-client',
        name: 'Destination', color: '#fff', createdAt: 1, order: 2 });
      const alias = dependency === 'path-alias' || dependency === 'windows-alias';
      if (alias) {
        await db.projects.update('retired-project', { name: dependency === 'path-alias' ? 'Blocked?' : 'blocked. ' });
        await db.projects.put({ id: 'alias-project', clientId: 'healthy-client',
          name: dependency === 'path-alias' ? 'blocked*' : 'BLOCKED', color: '#fff', createdAt: 1, order: 3 });
      }
      const projectName = dependency === 'path-alias' ? 'Blocked_' : dependency === 'windows-alias' ? 'blocked. ' : 'Retired';
      const siblingProjectName = dependency === 'path-alias' ? 'blocked_' : dependency === 'windows-alias' ? 'BLOCKED' : 'Retired';
      const before = task('failed-task', 'retired-project', 'Version zero');
      const first = { ...before, title: 'Version one' };
      const second = { ...before, title: 'Version two' };
      const sibling = task('moving-task', alias ? 'alias-project' : 'retired-project');
      const moved = { ...sibling, projectId: 'destination-project' };
      const destination = task('destination-task', 'destination-project');
      const healthy = task('healthy-task', 'healthy-project');
      const jobs = [job('first-version', before, first), job('second-version', first, second),
        job('dependent-move', sibling, moved), job('transitive-destination', null, destination),
        job('independent', null, healthy)];
      await seed([second, moved, destination, healthy], jobs);
      files.set(path(projectName, before.id), markdown(before));
      files.set(path(siblingProjectName, sibling.id), markdown(sibling));
      const failedPath = dependency === 'partial-index'
        ? `TASKS/Client/${projectName}/INDEX.md` : path(projectName, before.id);
      let failing = true;
      vi.mocked(fsAdapter.writeTextFile).mockImplementation(async (file, content) => {
        if (failing && file === failedPath) throw new Error('Synthetic disk temporarily unavailable');
        files.set(file, content);
      });

      await taskAuthority.sync();

      expect(files.get(path('Healthy', healthy.id))).toBe(markdown(healthy));
      expect(files.has(path('Destination', moved.id))).toBe(false);
      expect(files.has(path('Destination', destination.id))).toBe(false);
      expect(files.get(path(projectName, before.id))).toBe(markdown(dependency === 'partial-index' ? first : before));
      expect(await queued()).toEqual(jobs.slice(0, 4));

      await taskAuthority.sync();
      expect(await queued()).toEqual(jobs.slice(0, 4));
      expect(files.has(path('Destination', moved.id))).toBe(false);

      failing = false;
      vi.mocked(fsAdapter.writeTextFile).mockClear();
      await taskAuthority.sync();
      expect(await queued()).toEqual([]);
      expect(files.get(path(projectName, before.id))).toBe(markdown(second));
      expect(files.get(path('Destination', moved.id))).toBe(markdown(moved));
      expect(files.get(path('Destination', destination.id))).toBe(markdown(destination));
      const versions = vi.mocked(fsAdapter.writeTextFile).mock.calls
        .filter(([file]) => file === path(projectName, before.id)).map(([, content]) => content);
      expect(versions).toEqual(dependency === 'partial-index' ? [markdown(second)] : [markdown(first), markdown(second)]);
    });

  it('preserves manual collisions and blocks a later same-task receipt even in another project', async () => {
    const before = task('colliding-task', 'retired-project', 'Original');
    const first = { ...before, title: 'First update' };
    const later = { ...before, projectId: 'healthy-project', title: 'Later receipt' };
    const independent = task('independent-task', 'healthy-project');
    const jobs = [job('collision', before, first), job('later-same-task', null, later),
      job('independent', null, independent)];
    await seed([later, independent], jobs);
    files.set(path('Retired', before.id), '# Manual edits');

    await taskAuthority.sync();

    expect(files.get(path('Retired', before.id))).toBe('# Manual edits');
    expect(files.has(path('Healthy', later.id))).toBe(false);
    // The skipped cross-project version also orders that project's shared index.
    expect(files.has(path('Healthy', independent.id))).toBe(false);
    expect(await queued()).toEqual(jobs);
    expect(fsAdapter.writeTextFile).not.toHaveBeenCalled();
    expect(fsAdapter.remove).not.toHaveBeenCalled();
    await taskAuthority.sync();
    expect(await queued()).toEqual(jobs);
  });

  it.each(['project', 'client'] as const)(
    'publishes a surviving move without deleting files under the retired %s', async scope => {
      const before = task('moving-task', 'retired-project');
      const moved = { ...before, projectId: 'healthy-project', title: 'Moved' };
      await seed([before]);
      files.set(path('Retired', before.id), markdown(before));
      files.set('TASKS/Client/Retired/moving-task/manual.md', 'Manual notes');
      incoming([
        { table: 'projects', id: 'retired-project', value: null },
        ...(scope === 'client' ? [{ table: 'clients' as const, id: 'retired-client', value: null }] : []),
        { table: 'tasks', id: before.id, value: { ...moved } },
      ]);

      await taskAuthority.sync();

      expect(files.get(path('Healthy', moved.id))).toBe(markdown(moved));
      expect(files.get(path('Retired', before.id))).toBe(markdown(before));
      expect(files.get('TASKS/Client/Retired/moving-task/manual.md')).toBe('Manual notes');
      expect(fsAdapter.remove).not.toHaveBeenCalled();
      expect(await queued()).toEqual([]);
      expect(taskAuthority.getSnapshot().state).toBe('online');
    });
});
