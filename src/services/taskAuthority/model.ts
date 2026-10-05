export const TASK_TABLES = ['clients', 'projects', 'tasks', 'taskComments'] as const;
export type TaskTable = typeof TASK_TABLES[number];
export type TaskRecord = { id: string; [key: string]: unknown };
export interface Row { table: TaskTable; id: string; value: TaskRecord | null }
export interface VersionedRow extends Row { revision: number }
export interface Change extends Row { expectedRevision: number | null }
export interface Activity { operationId: string; actor: string; at: string; outcome: string; count: number }
export interface Snapshot {
  schema: 1; initialized: boolean; databaseId: string | null; generation: number;
  records: VersionedRow[] | null; activity?: Activity[];
}
export interface Reply { outcome: 'snapshot' | 'applied' | 'conflict'; snapshot: Snapshot; applied?: VersionedRow[] }
export type Request =
  | { schema: 1; action: 'snapshot'; databaseId?: string; generation?: number }
  | { schema: 1; action: 'bootstrap'; operationId: string; actor: string; records: Row[] }
  | { schema: 1; action: 'sync'; operationId: string; actor: string; databaseId: string; changes: Change[] };
export interface Conflict {
  key: string; table: TaskTable; id: string; local: TaskRecord | null;
  remote: VersionedRow; base: TaskRecord | null;
}
export interface SyncMetadata extends Record<string, unknown> {
  schema: 1; phase: 'migrating' | 'active'; actor: string; databaseId?: string;
  generation: number; baseline: VersionedRow[]; conflicts: Conflict[];
  deletions: string[]; pending?: Exclude<Request, { action: 'snapshot' }>;
  backupPath: string; lastSync?: number; activity?: Activity[];
  dependencyConflict?: boolean;
  projectionJobs?: { key: string; before: TaskRecord | null; after: TaskRecord | null }[];
}
export const META_KEY = 'atlasTaskAuthorityV1';
export const rowKey = (row: Pick<Row, 'table' | 'id'>) => JSON.stringify([row.table, row.id]);

/** Deterministic comparison also strips undefined fields as JSON transport does. */
export function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}
export const same = (a: unknown, b: unknown) => stable(a) === stable(b);

export function validRelations(rows: Row[]): boolean {
  const byTable = new Map(TASK_TABLES.map(table => [table,
    new Map(rows.filter(row => row.table === table && row.value).map(row => [row.id, row.value!]))]));
  for (const project of byTable.get('projects')!.values()) {
    if (!byTable.get('clients')!.has(String(project.clientId))) return false;
  }
  for (const task of byTable.get('tasks')!.values()) {
    if (task.deletedAt) continue;
    if (!byTable.get('projects')!.has(String(task.projectId))) return false;
  }
  return true;
}

export function assertReply(value: unknown): asserts value is Reply {
  if (!value || typeof value !== 'object') throw new Error('TASKS_PROTOCOL');
  const r = value as Partial<Reply>;
  const s = r.snapshot;
  if (!['snapshot', 'applied', 'conflict'].includes(r.outcome ?? '') || !s || s.schema !== 1
    || typeof s.initialized !== 'boolean' || !Number.isSafeInteger(s.generation) || s.generation < 0
    || (s.initialized && typeof s.databaseId !== 'string')
    || (s.records !== null && !Array.isArray(s.records))) throw new Error('TASKS_PROTOCOL');
  for (const records of [s.records ?? [], r.applied ?? []]) {
    if (!Array.isArray(records)) throw new Error('TASKS_PROTOCOL');
    const keys = new Set<string>();
    for (const row of records) {
      if (!row || typeof row !== 'object') throw new Error('TASKS_PROTOCOL');
      if (!TASK_TABLES.includes(row.table) || typeof row.id !== 'string' || !row.id
        || !Number.isSafeInteger(row.revision) || row.revision < 1
        || (row.value !== null && (typeof row.value !== 'object' || row.value.id !== row.id))
        || keys.has(rowKey(row))) throw new Error('TASKS_PROTOCOL');
      keys.add(rowKey(row));
    }
  }
  if (r.outcome === 'applied' && !Array.isArray(r.applied)) throw new Error('TASKS_PROTOCOL');
}

/** Resolve compact receipts only against the identical snapshot revision. */
export function decodeReply(value: unknown): Reply {
  if (!value || typeof value !== 'object') throw new Error('TASKS_PROTOCOL');
  const wire = value as Record<string, unknown>;
  const checked = { ...wire, applied: [] };
  assertReply(checked);
  if (wire.applied !== undefined && !Array.isArray(wire.applied)) throw new Error('TASKS_PROTOCOL');
  const applied = (wire.applied as unknown[] | undefined)?.map(item => {
    if (!item || typeof item !== 'object') throw new Error('TASKS_PROTOCOL');
    const row = item as Record<string, unknown>;
    if (row.valueFromSnapshot === undefined) return row;
    if (row.valueFromSnapshot !== true || 'value' in row) throw new Error('TASKS_PROTOCOL');
    const exact = checked.snapshot.records?.find(saved => saved.table === row.table
      && saved.id === row.id && saved.revision === row.revision);
    if (!exact) throw new Error('TASKS_RECEIPT_MISMATCH');
    return exact;
  });
  const reply = { ...wire, applied };
  assertReply(reply);
  return reply;
}

export function changesFor(rows: Row[], meta: SyncMetadata): Change[] {
  const local = new Map(rows.map(row => [rowKey(row), row]));
  const baseline = new Map(meta.baseline.map(row => [rowKey(row), row]));
  const changes: Change[] = [];
  for (const key of new Set([...local.keys(), ...baseline.keys()])) {
    const before = baseline.get(key);
    const after = local.get(key);
    const value = after?.value ?? null;
    // Missing cache data alone is never a remote deletion command.
    if (value === null && before?.value && !meta.deletions.includes(key)) continue;
    if (same(value, before?.value ?? null)) continue;
    const identity = after ?? before;
    if (identity) changes.push({ table: identity.table, id: identity.id, value,
      expectedRevision: before?.revision ?? null });
  }
  return changes;
}

export function reconcile(rows: Row[], meta: SyncMetadata, reply: Reply): { metadata: SyncMetadata; writes: Row[] } {
  assertReply(reply);
  const snapshot = reply.snapshot;
  if (!snapshot.initialized || !snapshot.databaseId) throw new Error('TASKS_AUTHORITY_MISSING');
  if (meta.databaseId && snapshot.databaseId !== meta.databaseId) throw new Error('TASKS_AUTHORITY_CHANGED');
  if (snapshot.generation < meta.generation) throw new Error('TASKS_AUTHORITY_ROLLED_BACK');
  const base = new Map(meta.baseline.map(row => [rowKey(row), row]));
  // A response lost after commit can be retried. Compare later local edits to
  // the exact version committed by that attempt, not the older baseline.
  if (reply.outcome === 'applied') for (const row of reply.applied ?? []) base.set(rowKey(row), row);
  const remote = snapshot.records ? new Map(snapshot.records.map(row => [rowKey(row), row]))
    : new Map([...meta.baseline, ...meta.conflicts.map(c => c.remote)].map(row => [rowKey(row), row]));
  const local = new Map(rows.map(row => [rowKey(row), row]));
  const next: VersionedRow[] = [];
  const writes: Row[] = [];
  const conflicts: Conflict[] = [];
  for (const key of new Set([...base.keys(), ...remote.keys(), ...local.keys()])) {
    const before = base.get(key);
    const server = remote.get(key);
    // The authority retains tombstones. A formerly present row disappearing
    // from a full snapshot is corruption/unsupported pruning, not a deletion.
    if (before && !server) throw new Error('TASKS_INCOMPLETE_SNAPSHOT');
    const actual = local.get(key)?.value ?? null;
    const mine = actual === null && before?.value && !meta.deletions.includes(key) ? before.value : actual;
    const theirs = server?.value ?? null;
    const localChanged = !same(mine, before?.value ?? null);
    const remoteChanged = !same(theirs, before?.value ?? null);
    if (localChanged && remoteChanged && !same(mine, theirs) && server) {
      conflicts.push({ key, table: server.table, id: server.id, local: mine, remote: server,
        base: before?.value ?? null });
      if (before) next.push(before);
    } else {
      if (server) next.push(server);
      const chosen = localChanged && !remoteChanged ? mine : theirs;
      const identity = server ?? local.get(key) ?? before;
      if (identity && !same(actual, chosen)) writes.push({ table: identity.table, id: identity.id, value: chosen });
    }
  }
  const deletions = meta.deletions.filter(key => !local.get(key)?.value && remote.get(key)?.value !== null);
  const merged = new Map(local);
  for (const row of writes) merged.set(rowKey(row), row);
  // Concurrent project/parent deletion and local child creation can each be
  // valid alone but invalid together. Keep the entire cache intact and present
  // the differing records as one atomic choice, including local-only rows.
  if (!validRelations([...merged.values()]) || meta.dependencyConflict && conflicts.length > 0) {
    const group: Conflict[] = [];
    for (const key of new Set([...remote.keys(), ...local.keys()])) {
      const theirs = remote.get(key);
      const mine = local.get(key);
      if (same(mine?.value ?? null, theirs?.value ?? null)) continue;
      const identity = theirs ?? mine!;
      group.push({ key, table: identity.table, id: identity.id, local: mine?.value ?? null,
        remote: theirs ?? { ...identity, value: null, revision: 0 }, base: base.get(key)?.value ?? null });
    }
    return { writes: [], metadata: { ...meta, phase: 'active', databaseId: snapshot.databaseId,
      generation: snapshot.generation, baseline: [...base.values()], conflicts: group, deletions,
      dependencyConflict: true, pending: undefined, lastSync: Date.now(), activity: snapshot.activity ?? meta.activity } };
  }
  return { writes, metadata: { ...meta, phase: 'active', databaseId: snapshot.databaseId,
    generation: snapshot.generation, baseline: next, conflicts, deletions, pending: undefined,
    dependencyConflict: false, lastSync: Date.now(), activity: snapshot.activity ?? meta.activity } };
}
