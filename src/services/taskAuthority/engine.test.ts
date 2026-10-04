// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieTaskCache, readMetadata, recordTaskDeletion } from './cache';
import { TaskAuthorityEngine, type TaskTransport } from './engine';
import { decodeReply, reconcile, rowKey, type Reply, type Request, type Row, type SyncMetadata } from './model';

// Each case starts real Python/SQLite processes; the full suite also runs many
// jsdom workers on Windows. Keep a bounded integration timeout above unit timing.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const initial: Row[] = [
  { table: 'clients', id: 'c', value: { id: 'c', name: 'Müşteri' } },
  { table: 'projects', id: 'p', value: { id: 'p', name: 'Proje', clientId: 'c' } },
  { table: 'tasks', id: 't', value: { id: 't', title: 'Teklifi hazırla', content: '{"type":"doc"}',
    status: 'pending', importance: 'medium', date: '2026-09-27', projectId: 'p', assignees: [], createdAt: 1, updatedAt: 1 } },
  { table: 'taskComments', id: 'm', value: { id: 'm', taskId: 't', text: 'Not', attachmentDataUrl: 'data:text/plain;base64,aGVsbG8=' } },
];
let database: Dexie, cache: DexieTaskCache, root: string, transport: TaskTransport, engine: TaskAuthorityEngine;
const python = process.platform === 'win32' ? 'python' : 'python3';
function rpc(request: Request): Reply {
  return decodeReply(JSON.parse(execFileSync(python, ['-B', resolve('tools/task-authority/tasks.py'), '--root', root, 'rpc'],
    { input: JSON.stringify(request), encoding: 'utf8' })));
}
async function remoteTitle(title: string) {
  const snapshot = rpc({ schema: 1, action: 'snapshot' }).snapshot;
  const row = snapshot.records!.find(r => r.id === 't')!;
  return rpc({ schema: 1, action: 'sync', actor: 'hermes:test', operationId: crypto.randomUUID(),
    databaseId: snapshot.databaseId!, changes: [{ table: row.table, id: row.id, value: { ...row.value!, title }, expectedRevision: row.revision }] });
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'tabs-task-authority-test-'));
  database = new Dexie(`TaskAuthorityTest-${crypto.randomUUID()}`);
  database.version(1).stores({ clients: 'id', projects: 'id', tasks: 'id', taskComments: 'id', settings: 'key' });
  cache = new DexieTaskCache(database);
  await cache.transaction(view => view.write(initial));
  transport = {
    request: async request => rpc(request),
    backup: async records => { const path = join(root, 'local-backup.json'); writeFileSync(path, JSON.stringify(records)); return { path }; },
  };
  engine = new TaskAuthorityEngine(cache, transport);
});
afterEach(async () => { engine.stop(); await database.delete(); rmSync(root, { recursive: true, force: true }); });

describe('real SQLite authority with Dexie offline cache', () => {
  it('backs up and transfers every field, including Turkish text and attachments', async () => {
    await engine.connect();
    expect(engine.getSnapshot().state).toBe('online');
    expect(JSON.parse(readFileSync(join(root, 'local-backup.json'), 'utf8'))).toEqual(initial);
    const saved = rpc({ schema: 1, action: 'snapshot' }).snapshot.records!;
    for (const row of initial) expect(saved.find(r => rowKey(r) === rowKey(row))?.value).toEqual(row.value);
  });
  it('never imports if local backup failed', async () => {
    transport.backup = async () => { throw new Error('disk full'); };
    await expect(engine.connect()).rejects.toThrow('disk full');
    expect(await readMetadata(database)).toBeUndefined();
    expect(rpc({ schema: 1, action: 'snapshot' }).snapshot.initialized).toBe(false);
  });
  it('retains exact pending request across a lost commit response and restart', async () => {
    await engine.connect();
    await database.table('tasks').update('t', { title: 'local edit' });
    let lost = false;
    transport.request = async request => {
      const response = rpc(request);
      if (request.action === 'sync' && !lost) { lost = true; throw new Error('connection lost'); }
      return response;
    };
    await engine.sync();
    const pending = (await readMetadata(database))!.pending;
    expect(pending?.action).toBe('sync');
    expect(engine.getSnapshot().state).toBe('offline');
    engine = new TaskAuthorityEngine(cache, transport);
    await engine.sync();
    expect(engine.getSnapshot().pending).toBe(0);
    expect((await readMetadata(database))!.pending).toBeUndefined();
    expect(rpc({ schema: 1, action: 'snapshot' }).snapshot.generation).toBe(2);
  });
  it('preserves edits made while the submitted request is in flight', async () => {
    await engine.connect();
    await database.table('tasks').update('t', { title: 'submitted' });
    transport.request = async request => {
      const response = rpc(request);
      if (request.action === 'sync') await database.table('tasks').update('t', { title: 'later edit' });
      return response;
    };
    await engine.sync();
    expect((await database.table('tasks').get('t')).title).toBe('later edit');
    expect(engine.getSnapshot().pending).toBe(1);
    transport.request = async request => rpc(request);
    await engine.sync();
    expect(engine.getSnapshot().pending).toBe(0);
  });
  it('shows both conflicting versions and checks fresh remote revisions on resolution', async () => {
    await engine.connect();
    await database.table('tasks').update('t', { title: 'offline local' });
    await remoteTitle('Hermes version');
    await engine.sync();
    expect(engine.getSnapshot().state).toBe('conflict');
    const first = engine.getSnapshot().conflicts[0];
    expect(first.local?.title).toBe('offline local');
    expect(first.remote.value?.title).toBe('Hermes version');
    await remoteTitle('newer Hermes version');
    await engine.resolve(first, 'local');
    expect(engine.getSnapshot().state).toBe('conflict');
    expect(engine.getSnapshot().conflicts[0].remote.value?.title).toBe('newer Hermes version');
    await engine.resolve(engine.getSnapshot().conflicts[0], 'remote');
    expect((await database.table('tasks').get('t')).title).toBe('newer Hermes version');
    expect(engine.getSnapshot().conflicts).toEqual([]);
  });
  it('restores an accidentally missing cache row without deleting the authority', async () => {
    await engine.connect();
    await database.table('tasks').delete('t');
    await engine.sync();
    expect(await database.table('tasks').get('t')).toEqual(initial[2].value);
    expect(rpc({ schema: 1, action: 'snapshot' }).snapshot.generation).toBe(1);
  });
  it('propagates an explicit atomic deletion, and rollback leaves no delete intent', async () => {
    await engine.connect();
    await expect(database.transaction('rw', ['tasks', 'settings'], async () => {
      await recordTaskDeletion(database, [{ table: 'tasks', id: 't' }]);
      await database.table('tasks').delete('t');
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await readMetadata(database))!.deletions).toEqual([]);
    await database.transaction('rw', ['tasks', 'settings'], async () => {
      await recordTaskDeletion(database, [{ table: 'tasks', id: 't' }]);
      await database.table('tasks').delete('t');
    });
    await engine.sync();
    expect(rpc({ schema: 1, action: 'snapshot' }).snapshot.records!.find(r => r.id === 't')!.value).toBeNull();
  });
  it('waits for an open editor before applying a remote response', async () => {
    await engine.connect();
    await remoteTitle('remote');
    let saved = true;
    engine = new TaskAuthorityEngine(cache, transport, async () => {}, () => saved);
    transport.request = async request => { const response = rpc(request); saved = false; return response; };
    await engine.sync();
    expect(engine.getSnapshot().state).toBe('editing');
    expect((await database.table('tasks').get('t')).title).toBe(initial[2].value!.title);
    transport.request = async request => rpc(request); saved = true;
    await engine.sync();
    expect((await database.table('tasks').get('t')).title).toBe('remote');
  });
  it('refuses identity changes, authority rollback and missing tombstones', async () => {
    await engine.connect();
    const meta = (await readMetadata(database)) as SyncMetadata;
    const reply = rpc({ schema: 1, action: 'snapshot' });
    expect(() => reconcile(initial, meta, { ...reply, snapshot: { ...reply.snapshot, databaseId: 'other' } })).toThrow('CHANGED');
    expect(() => reconcile(initial, meta, { ...reply, snapshot: { ...reply.snapshot, generation: 0 } })).toThrow('ROLLED_BACK');
    expect(() => reconcile(initial, meta, { ...reply, snapshot: { ...reply.snapshot, records: [] } })).toThrow('INCOMPLETE');
  });
  it('retains the exact before/after projection after restart without resending the remote edit', async () => {
    await engine.connect();
    await remoteTitle('projection waiting');
    await engine.sync();
    const jobs = (await readMetadata(database))!.projectionJobs!;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].before?.title).toBe(initial[2].value!.title);
    expect(jobs[0].after?.title).toBe('projection waiting');
    engine = new TaskAuthorityEngine(cache, transport);
    await engine.sync();
    expect((await readMetadata(database))!.projectionJobs).toEqual(jobs);
    expect(engine.getSnapshot().state).toBe('online');
    expect(engine.getSnapshot().pending).toBe(0);
    expect(rpc({ schema: 1, action: 'snapshot' }).snapshot.generation).toBe(2);
  });
  it.each(['local', 'remote'] as const)('keeps related records atomic when a parent is deleted remotely (%s choice)', async choice => {
    await engine.connect();
    await database.table('tasks').put({ ...initial[2].value, id: 'new-child', parentTaskId: 't' });
    const snapshot = rpc({ schema: 1, action: 'snapshot' }).snapshot;
    rpc({ schema: 1, action: 'sync', databaseId: snapshot.databaseId!, actor: 'hermes:test',
      operationId: crypto.randomUUID(), changes: [{ table: 'tasks', id: 't', expectedRevision: 1, value: null }] });
    await engine.sync();
    expect(engine.getSnapshot().metadata?.dependencyConflict).toBe(true);
    expect(await database.table('tasks').get('t')).toBeTruthy();
    expect(await database.table('tasks').get('new-child')).toBeTruthy();
    await engine.resolveGroup(engine.getSnapshot().conflicts, choice);
    expect(engine.getSnapshot().state).toBe('online');
    const final = rpc({ schema: 1, action: 'snapshot' }).snapshot;
    expect(Boolean(final.records!.find(r => r.id === 't')?.value)).toBe(choice === 'local');
    expect(Boolean(final.records!.find(r => r.id === 'new-child')?.value)).toBe(choice === 'local');
  });
});
