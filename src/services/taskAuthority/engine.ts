import { assertReply, changesFor, reconcile, rowKey, same, validRelations, type Conflict, type Reply,
  type Request, type Row, type SyncMetadata } from './model';

export interface CacheView {
  rows(): Promise<Row[]>;
  metadata(): Promise<SyncMetadata | undefined>;
  saveMetadata(meta: SyncMetadata): Promise<void>;
  write(rows: Row[]): Promise<void>;
}
export interface TaskCache { transaction<T>(work: (cache: CacheView) => Promise<T>): Promise<T> }
export interface TaskTransport {
  request(request: Request): Promise<Reply>;
  backup(rows: Row[]): Promise<{ path: string }>;
}
export interface SyncStatus {
  state: 'local' | 'syncing' | 'online' | 'offline' | 'conflict' | 'editing';
  pending: number; conflicts: Conflict[]; metadata?: SyncMetadata; error?: string;
}

export class TaskAuthorityEngine {
  private cache: TaskCache;
  private transport: TaskTransport;
  private changed: () => Promise<void>;
  private canApply: () => boolean;
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private listeners = new Set<() => void>();
  private status: SyncStatus = { state: 'local', pending: 0, conflicts: [] };
  constructor(cache: TaskCache, transport: TaskTransport,
    changed: () => Promise<void> = async () => {}, canApply: () => boolean = () => true) {
    this.cache = cache; this.transport = transport; this.changed = changed; this.canApply = canApply;
  }
  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private report(status: SyncStatus) { this.status = status; for (const listener of this.listeners) listener(); }
  async start() {
    if (this.started) return;
    this.started = true;
    await this.sync();
    if (!this.started) return;
    this.timer = setInterval(() => { void this.sync(); }, 15000);
  }
  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = undefined;
  }
  localChanged() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.sync(); }, 1200);
  }

  /** Explicit initial migration: backup first, durable intent, then remote import. */
  async connect() {
    if (this.running) await this.running;
    const current = await this.cache.transaction(async view => ({ meta: await view.metadata(), rows: await view.rows() }));
    if (!current.meta) {
      const existing = await this.transport.request({ schema: 1, action: 'snapshot' });
      assertReply(existing);
      if (existing.snapshot.initialized) throw new Error('TASKS_ALREADY_INITIALIZED');
      const backup = await this.transport.backup(current.rows);
      const actor = `tabs:${crypto.randomUUID()}`;
      await this.cache.transaction(async view => {
        if (await view.metadata()) throw new Error('TASKS_MIGRATION_CHANGED');
        if (!same(await view.rows(), current.rows)) throw new Error('TASKS_MIGRATION_CHANGED');
        await view.saveMetadata({ schema: 1, phase: 'migrating', actor, generation: 0,
          baseline: [], conflicts: [], deletions: [], backupPath: backup.path,
          pending: { schema: 1, action: 'bootstrap', actor, operationId: crypto.randomUUID(), records: current.rows } });
      });
    }
    await this.sync();
  }

  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'TASKS_CONNECTION';
      this.report({ ...this.status, state: message === 'TASKS_EDITING' ? 'editing' : 'offline', error: message });
    }).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async accept(reply: Reply) {
    if (!this.canApply()) throw new Error('TASKS_EDITING');
    await this.cache.transaction(async view => {
      if (!this.canApply()) throw new Error('TASKS_EDITING');
      const meta = await view.metadata();
      if (!meta) throw new Error('TASKS_MIGRATION_MISSING');
      assertReply(reply);
      if (reply.outcome === 'applied' && meta.pending) {
        const sent = meta.pending.action === 'bootstrap' ? meta.pending.records : meta.pending.changes;
        if (sent.length !== reply.applied!.length || sent.some(row => !reply.applied!.some(saved =>
          rowKey(saved) === rowKey(row) && same(saved.value, row.value)))) throw new Error('TASKS_RECEIPT_MISMATCH');
      }
      const rows = await view.rows();
      const result = reconcile(rows, meta, reply);
      const projectionJobs = [...(meta.projectionJobs ?? [])];
      for (const row of result.writes.filter(row => row.table === 'tasks')) {
        projectionJobs.push({ key: crypto.randomUUID(), before: rows.find(old => rowKey(old) === rowKey(row))?.value ?? null, after: row.value });
      }
      result.metadata.projectionJobs = projectionJobs;
      await view.write(result.writes);
      await view.saveMetadata(result.metadata);
    });
    await this.changed();
  }

  private async run() {
    let meta = await this.cache.transaction(view => view.metadata());
    if (!meta) { this.report({ state: 'local', pending: 0, conflicts: [] }); return; }
    const pendingCount = await this.cache.transaction(async view => changesFor(await view.rows(), meta!).length);
    this.report({ ...this.status, pending: pendingCount, conflicts: meta.conflicts, metadata: meta, state: 'syncing', error: undefined });
    if (!this.canApply()) throw new Error('TASKS_EDITING');
    if (meta.pending) {
      await this.accept(await this.transport.request(meta.pending));
    } else {
      await this.accept(await this.transport.request({ schema: 1, action: 'snapshot',
        databaseId: meta.databaseId, generation: meta.generation }));
    }
    const request = await this.cache.transaction(async view => {
      const state = await view.metadata();
      if (!state?.databaseId || state.conflicts.length) return undefined;
      const changes = changesFor(await view.rows(), state);
      if (!changes.length) return undefined;
      const pending: Request = { schema: 1, action: 'sync', databaseId: state.databaseId,
        actor: state.actor, operationId: crypto.randomUUID(), changes };
      await view.saveMetadata({ ...state, pending });
      return pending;
    });
    if (request) await this.accept(await this.transport.request(request));
    const final = await this.cache.transaction(async view => ({ meta: await view.metadata(), rows: await view.rows() }));
    meta = final.meta!;
    this.report({ state: meta.conflicts.length ? 'conflict' : 'online',
      pending: changesFor(final.rows, meta).length, conflicts: meta.conflicts, metadata: meta });
  }

  /** Resolve against exactly what the user saw; later remote edits still conflict. */
  async resolve(conflict: Conflict, choice: 'local' | 'remote') {
    if (this.running) await this.running;
    await this.cache.transaction(async view => {
      const meta = await view.metadata();
      const current = meta?.conflicts.find(item => item.key === conflict.key);
      if (!meta || !current || !same(current, conflict)) throw new Error('TASKS_CONFLICT_CHANGED');
      if (meta.dependencyConflict) throw new Error('TASKS_GROUP_CHOICE_REQUIRED');
      const rows = await view.rows();
      const mine = rows.find(row => rowKey(row) === conflict.key)?.value ?? null;
      if (!same(mine, conflict.local)) throw new Error('TASKS_LOCAL_CHANGED');
      const projectionJobs = [...(meta.projectionJobs ?? [])];
      if (choice === 'remote') {
        await view.write([conflict.remote]);
        if (conflict.table === 'tasks') projectionJobs.push({ key: crypto.randomUUID(), before: mine, after: conflict.remote.value });
      }
      const baseline = meta.baseline.filter(row => rowKey(row) !== conflict.key);
      baseline.push(conflict.remote);
      await view.saveMetadata({ ...meta, baseline, projectionJobs, conflicts: meta.conflicts.filter(item => item.key !== conflict.key),
        deletions: choice === 'remote' ? meta.deletions.filter(key => key !== conflict.key) : meta.deletions });
    });
    await this.changed();
    await this.sync();
  }

  async resolveGroup(conflicts: Conflict[], choice: 'local' | 'remote') {
    if (this.running) await this.running;
    await this.cache.transaction(async view => {
      const meta = await view.metadata();
      if (!meta?.dependencyConflict || !same(meta.conflicts, conflicts)) throw new Error('TASKS_CONFLICT_CHANGED');
      const rows = await view.rows();
      const selected = new Map(rows.map(row => [rowKey(row), row]));
      for (const conflict of conflicts) {
        if (!same(selected.get(conflict.key)?.value ?? null, conflict.local)) throw new Error('TASKS_LOCAL_CHANGED');
        if (choice === 'remote') selected.set(conflict.key, conflict.remote);
      }
      if (!validRelations([...selected.values()])) throw new Error('TASKS_RELATIONS_CHANGED');
      const projectionJobs = [...(meta.projectionJobs ?? [])];
      if (choice === 'remote') {
        await view.write(conflicts.map(conflict => conflict.remote));
        projectionJobs.push(...conflicts.filter(conflict => conflict.table === 'tasks').map(conflict => ({
          key: crypto.randomUUID(), before: conflict.local, after: conflict.remote.value,
        })));
      }
      const keys = new Set(conflicts.map(conflict => conflict.key));
      const baseline = meta.baseline.filter(row => !keys.has(rowKey(row)));
      baseline.push(...conflicts.map(c => c.remote).filter(row => row.revision > 0));
      const deletions = meta.deletions.filter(key => !keys.has(key));
      if (choice === 'local') deletions.push(...conflicts.filter(c => !c.local && c.remote.value).map(c => c.key));
      await view.saveMetadata({ ...meta, baseline, deletions, projectionJobs, conflicts: [], dependencyConflict: false });
    });
    await this.changed();
    await this.sync();
  }
}
