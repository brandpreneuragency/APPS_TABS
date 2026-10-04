// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_TABLES } from '../taskAuthority/model';
import { TabsDB } from '../db';
import { CLIENTS_V1_STORES } from './schema';

const v18Stores = {
  documents: 'id, title, updatedAt, order',
  workspaces: 'id, name, updatedAt, order',
  chatMessages: 'id, threadId, mode, agentId, timestamp, settingsTab, workspaceId',
  chatThreads: 'id, mode, updatedAt, workspaceId, taskId, settingsTab, origin',
  agents: 'id, name, isDefault',
  providerConfigs: 'id, provider, isActive',
  settings: 'key',
  quickPrompts: 'id, createdAt, scope, groupId, order',
  actionGroups: 'id, scope, order',
  tasks: 'id, title, updatedAt, order, projectId, status, parentTaskId',
  projects: 'id, name, clientId',
  taskComments: 'id, taskId, createdAt',
  taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
  clients: 'id, name, order',
  codexSessions: 'appThreadId, nativeThreadId, workspaceRoot, updatedAt',
  codexRuns: 'runId, &clientCommandId, appThreadId, nativeThreadId, nativeTurnId, status, createdAt',
  codexEvents: 'id, epoch, [epoch+sequence], runId, createdAt',
  codexPendingRequests: 'requestId, runId, epoch, status',
  codexOperationReceipts: 'operationId, runId, appThreadId',
  codexDocumentIntents: 'operationId, workspaceId, status',
} as const;

const databases: Dexie[] = [];
const fixtureId = () => `ClientsV1Schema-${crypto.randomUUID()}`;

async function createV18Fixture(name: string): Promise<Dexie> {
  const database = new Dexie(name);
  database.version(18).stores(v18Stores);
  databases.push(database);
  await database.open();
  await database.table('clients').put({
    id: 'client-sentinel', name: 'Sentinel client', color: '#123456', createdAt: 101, order: 0,
  });
  await database.table('projects').put({
    id: 'project-sentinel', name: 'Sentinel project', color: '#654321', clientId: 'client-sentinel',
    createdAt: 102, order: 0,
  });
  await database.table('tasks').put({
    id: 'task-sentinel', title: 'Sentinel task', content: '{"type":"doc"}', status: 'pending',
    importance: 'medium', date: '2026-10-03', projectId: 'project-sentinel', assignees: [],
    createdAt: 103, updatedAt: 104, order: 0,
  });
  await database.table('settings').put({ key: 'sentinel-setting', value: 'keep-me' });
  database.close();
  return database;
}

async function readSentinels(database: Dexie) {
  return {
    client: await database.table('clients').get('client-sentinel'),
    project: await database.table('projects').get('project-sentinel'),
    task: await database.table('tasks').get('task-sentinel'),
    setting: await database.table('settings').get('sentinel-setting'),
  };
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

describe('clients v1 storage boundary', () => {
  it('keeps local details out of task authority', () => {
    expect(Object.keys(CLIENTS_V1_STORES)).toEqual([
      'clientProfiles', 'clientContacts', 'clientNotes', 'clientDrafts', 'clientAttachments',
    ]);
    expect(TASK_TABLES).toEqual(['clients', 'projects', 'tasks', 'taskComments']);
  });
});

describe('clients v1 additive database upgrade', () => {
  it('preserves v18 sentinels, adds five empty stores, and leaves CRM companion data alone on reopen', async () => {
    const name = fixtureId();
    const crmName = `${name}-CRM`;
    await createV18Fixture(name);
    const crm = new Dexie(crmName);
    databases.push(crm);
    crm.version(1).stores({ crmLeads: 'id', crmSettings: 'key' });
    await crm.open();
    const crmSentinel = { id: 'crm-sentinel', name: 'Do not touch', createdAt: 201 };
    await crm.table('crmLeads').put(crmSentinel);
    await crm.table('crmSettings').put({ key: 'crm-sentinel', value: 'companion-db' });
    const crmVersion = crm.verno;
    crm.close();

    const migrated = new TabsDB(name);
    databases.push(migrated);
    await migrated.open();
    expect(migrated.verno).toBe(19);
    const migratedSentinels = await readSentinels(migrated);
    expect(migratedSentinels).toEqual({
      client: { id: 'client-sentinel', name: 'Sentinel client', color: '#123456', createdAt: 101, order: 0 },
      project: { id: 'project-sentinel', name: 'Sentinel project', color: '#654321',
        clientId: 'client-sentinel', createdAt: 102, order: 0 },
      task: { id: 'task-sentinel', title: 'Sentinel task', content: '{"type":"doc"}', status: 'pending',
        importance: 'medium', date: '2026-10-03', projectId: 'project-sentinel', assignees: [],
        createdAt: 103, updatedAt: 104, order: 0 },
      setting: { key: 'sentinel-setting', value: 'keep-me' },
    });
    expect(await Promise.all(Object.keys(CLIENTS_V1_STORES).map((store) => migrated.table(store).count())))
      .toEqual([0, 0, 0, 0, 0]);
    migrated.close();

    const reopened = new TabsDB(name);
    databases.push(reopened);
    await reopened.open();
    expect(reopened.verno).toBe(19);
    expect(await readSentinels(reopened)).toEqual(migratedSentinels);
    expect(await Promise.all(Object.keys(CLIENTS_V1_STORES).map((store) => reopened.table(store).count())))
      .toEqual([0, 0, 0, 0, 0]);
    reopened.close();

    const crmReopened = new Dexie(crmName);
    databases.push(crmReopened);
    crmReopened.version(1).stores({ crmLeads: 'id', crmSettings: 'key' });
    await crmReopened.open();
    expect(crmReopened.verno).toBe(crmVersion);
    expect(await crmReopened.table('crmLeads').get('crm-sentinel')).toEqual(crmSentinel);
    expect(await crmReopened.table('crmSettings').get('crm-sentinel'))
      .toEqual({ key: 'crm-sentinel', value: 'companion-db' });
  });

  it('rolls back an injected v19 store-creation failure without reseeding v18 data', async () => {
    const name = fixtureId();
    await createV18Fixture(name);
    const originalCreateObjectStore = IDBDatabase.prototype.createObjectStore;
    let failureInjected = false;
    const injectedFailure = vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(
      function (this: IDBDatabase, storeName: string, options?: IDBObjectStoreParameters) {
        if (storeName === 'clientProfiles') {
          failureInjected = true;
          throw new Error('injected v19 migration failure');
        }
        return originalCreateObjectStore.call(this, storeName, options);
      },
    );

    const attempted = new TabsDB(name);
    databases.push(attempted);
    let migrationRejected = false;
    try {
      await attempted.open();
    } catch {
      migrationRejected = true;
    } finally {
      attempted.close();
      injectedFailure.mockRestore();
    }
    expect(migrationRejected).toBe(true);
    expect(failureInjected).toBe(true);

    const intact = new Dexie(name);
    databases.push(intact);
    intact.version(18).stores(v18Stores);
    await intact.open();
    expect(intact.verno).toBe(18);
    expect(await readSentinels(intact)).toMatchObject({
      client: { id: 'client-sentinel', name: 'Sentinel client' },
      project: { id: 'project-sentinel', name: 'Sentinel project', clientId: 'client-sentinel' },
      task: { id: 'task-sentinel', title: 'Sentinel task', projectId: 'project-sentinel' },
      setting: { key: 'sentinel-setting', value: 'keep-me' },
    });
    const extensionTables = Object.keys(CLIENTS_V1_STORES);
    expect(intact.tables.some((table) => extensionTables.includes(table.name))).toBe(false);
    intact.close();

    const retried = new TabsDB(name);
    databases.push(retried);
    await retried.open();
    expect(retried.verno).toBe(19);
    expect(await readSentinels(retried)).toMatchObject({
      client: { id: 'client-sentinel', name: 'Sentinel client' },
      project: { id: 'project-sentinel', name: 'Sentinel project', clientId: 'client-sentinel' },
      task: { id: 'task-sentinel', title: 'Sentinel task', projectId: 'project-sentinel' },
      setting: { key: 'sentinel-setting', value: 'keep-me' },
    });
  });
});
