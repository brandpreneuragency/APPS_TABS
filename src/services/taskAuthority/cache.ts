import type Dexie from 'dexie';
import type { CacheView, TaskCache } from './engine';
import { META_KEY, TASK_TABLES, rowKey, type Row, type SyncMetadata, type TaskRecord } from './model';

export async function readMetadata(database: Dexie): Promise<SyncMetadata | undefined> {
  const row = await database.table<{ key: string; value: unknown }, string>('settings').get(META_KEY);
  if (row === undefined) return undefined;
  const value = row.value as Partial<SyncMetadata> | null;
  if (!value || value.schema !== 1 || !['migrating', 'active'].includes(value.phase ?? '')
    || typeof value.actor !== 'string' || !Array.isArray(value.baseline)
    || !Array.isArray(value.conflicts) || !Array.isArray(value.deletions)) throw new Error('TASKS_CACHE_METADATA');
  return value as SyncMetadata;
}

export class DexieTaskCache implements TaskCache {
  private database: Dexie;
  constructor(database: Dexie) { this.database = database; }
  transaction<T>(work: (cache: CacheView) => Promise<T>): Promise<T> {
    const database = this.database;
    return database.transaction('rw', [...TASK_TABLES, 'settings'], async () => work({
      rows: async () => (await Promise.all(TASK_TABLES.map(async table => {
        const records = await database.table<TaskRecord, string>(table).toArray();
        return records.map(value => ({ table, id: value.id, value }));
      }))).flat(),
      metadata: () => readMetadata(database),
      saveMetadata: meta => database.table('settings').put({ key: META_KEY, value: meta }).then(() => {}),
      write: async rows => {
        for (const row of rows) {
          const table = database.table<TaskRecord, string>(row.table);
          if (row.value === null) await table.delete(row.id);
          else await table.put(row.value);
        }
      },
    }));
  }
}

/** Call inside the same transaction as the deletion, with settings included. */
export async function recordTaskDeletion(database: Dexie, rows: Pick<Row, 'table' | 'id'>[]): Promise<void> {
  const meta = await readMetadata(database);
  if (!meta) return;
  await database.table('settings').put({ key: META_KEY,
    value: { ...meta, deletions: [...new Set([...meta.deletions, ...rows.map(rowKey)])] } });
}
