import Dexie from 'dexie';
import { useState, useSyncExternalStore } from 'react';
import { DexieTaskCache, readMetadata, recordTaskDeletion } from '../../../services/taskAuthority/cache';
import { TaskAuthorityEngine } from '../../../services/taskAuthority/engine';
import { desktopTaskTransport } from '../../../services/taskAuthority/desktop';
import { saveTaskAcceptanceResult } from '../../../services/taskAuthority/acceptance';
import { tasksAcceptanceFixture } from '../../../services/runtime';
import { same, type Request, type Row } from '../../../services/taskAuthority/model';
import './taskAcceptance.css';

const fixture = tasksAcceptanceFixture();
if (!fixture) throw new Error('Native task acceptance identity required');
const database = new Dexie(fixture);
database.version(1).stores({ clients: 'id', projects: 'id', tasks: 'id', taskComments: 'id', settings: 'key' });
const cache = new DexieTaskCache(database);
const transport = { ...desktopTaskTransport };
const engine = new TaskAuthorityEngine(cache, transport);
const seed: Row[] = [
  { table: 'clients', id: 'fixture-client', value: { id: 'fixture-client', name: 'Örnek müşteri', color: '#4488cc', createdAt: 1, order: 0 } },
  { table: 'projects', id: 'fixture-project', value: { id: 'fixture-project', name: 'Test', clientId: 'fixture-client', color: '#4488cc', createdAt: 1, order: 0 } },
  { table: 'tasks', id: 'fixture-task', value: { id: 'fixture-task', title: 'Türkçe görev — ıİşŞğĞ', content: '{"type":"doc","content":[]}', status: 'pending', importance: 'medium', date: '2026-09-27', projectId: 'fixture-project', assignees: [], createdAt: 1, updatedAt: 1, order: 0 } },
  { table: 'taskComments', id: 'fixture-comment', value: { id: 'fixture-comment', taskId: 'fixture-task', text: 'Ekli yorum', createdAt: 1, attachmentName: 'hello.txt', attachmentDataUrl: 'data:text/plain;base64,aGVsbG8=' } },
];
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

export default function TaskAcceptanceApp() {
  const [checks, setChecks] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const run = async () => {
    setBusy(true); setError('');
    const passed: string[] = [];
    const pass = (name: string) => { passed.push(name); setChecks([...passed]); };
    try {
      assert(!await readMetadata(database), 'Use a fresh fixture for the initial suite');
      await cache.transaction(view => view.write(seed));
      await engine.connect();
      assert(engine.getSnapshot().state === 'online', engine.getSnapshot().error ?? 'Import failed');
      const original = await transport.request({ schema: 1, action: 'snapshot' });
      assert(seed.every(row => same(row.value, original.snapshot.records?.find(r => r.id === row.id)?.value)), 'Import differs');
      pass('Native backup + VPS import: all fields, Unicode and attachment preserved');
      await database.table('tasks').update('fixture-task', { title: 'Offline local edit' });
      const remote = original.snapshot.records!.find(row => row.id === 'fixture-task')!;
      await transport.request({ schema: 1, action: 'sync', databaseId: original.snapshot.databaseId!,
        operationId: crypto.randomUUID(), actor: 'hermes:acceptance', changes: [{ table: remote.table, id: remote.id,
          expectedRevision: remote.revision, value: { ...remote.value!, title: 'Hermes edit' } }] });
      await engine.sync();
      assert(engine.getSnapshot().conflicts.length === 1, 'Expected one conflict');
      await engine.resolve(engine.getSnapshot().conflicts[0], 'remote');
      assert((await database.table('tasks').get('fixture-task')).title === 'Hermes edit', 'Conflict resolution failed');
      pass('Concurrent Hermes / offline edits: both preserved, VPS choice applied');
      await database.table('tasks').update('fixture-task', { title: 'Lost response retry' });
      let dropped = false;
      transport.request = async (request: Request) => {
        const reply = await desktopTaskTransport.request(request);
        if (request.action === 'sync' && !dropped) { dropped = true; throw new Error('Intentional lost response'); }
        return reply;
      };
      await engine.sync();
      assert(Boolean((await readMetadata(database))?.pending), 'Retry intent missing');
      transport.request = desktopTaskTransport.request;
      await engine.sync();
      assert(!((await readMetadata(database))?.pending), 'Retry not acknowledged');
      pass('Committed response lost: durable same-operation retry succeeds');
      await database.table('tasks').delete('fixture-task');
      await engine.sync();
      assert(Boolean(await database.table('tasks').get('fixture-task')), 'Missing cache row was not restored');
      await database.transaction('rw', ['taskComments', 'settings'], async () => {
        await recordTaskDeletion(database, [{ table: 'taskComments', id: 'fixture-comment' }]);
        await database.table('taskComments').delete('fixture-comment');
      });
      await engine.sync();
      const final = await transport.request({ schema: 1, action: 'snapshot' });
      assert(final.snapshot.records!.find(r => r.id === 'fixture-comment')!.value === null, 'Explicit delete did not reach VPS');
      pass('Missing cache is restored; explicit deletion becomes a VPS tombstone');
      await saveTaskAcceptanceResult({ passed: true, checks: passed, databaseId: final.snapshot.databaseId, generation: final.snapshot.generation });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message); await saveTaskAcceptanceResult({ passed: false, checks: passed, error: message });
    } finally { setBusy(false); }
  };
  const reconnect = async () => {
    await engine.sync();
    const task = await database.table('tasks').get('fixture-task');
    setChecks([`Restart read: ${task?.title ?? '(missing)'}`]);
    await saveTaskAcceptanceResult({ passed: engine.getSnapshot().state === 'online', restartTitle: task?.title, generation: (await readMetadata(database))?.generation });
  };
  return <main className="task-acceptance-page">
    <h1>TABS Tasks Acceptance</h1><p>Dedicated task fixture: {fixture}</p>
    <p>Native WebView → fixed SSH → VPS SQLite. Production task storage is excluded.</p>
    <button disabled={busy} onClick={() => void run()}>Run isolated migration and conflict tests</button>{' '}
    <button disabled={busy} onClick={() => void reconnect()}>Read VPS after restart</button>
    <p role="status">{status.state} · Pending: {status.pending} · Conflicts: {status.conflicts.length}</p>
    <ol>{checks.map(check => <li key={check}>{check}</li>)}</ol>
    {error && <p role="alert">FAILED: {error}</p>}
  </main>;
}
