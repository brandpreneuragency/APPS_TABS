import 'fake-indexeddb/auto';
import { TabsDB } from '../db';
import { createClientRecords } from './records';

const databases: TabsDB[] = [];

export interface RecordsFixture {
  database: TabsDB;
  records: ReturnType<typeof createClientRecords>;
  seedContacts: () => Promise<void>;
}

export async function createRecordsFixture(): Promise<RecordsFixture> {
  const database = new TabsDB(`ClientsRecords-${crypto.randomUUID()}`);
  databases.push(database);
  await database.open();
  await database.clients.bulkAdd([
    { id: 'client-a', name: 'Brand A', color: '#123456', createdAt: 100, order: 0 },
    { id: 'client-b', name: 'Brand B', color: '#654321', createdAt: 200, order: 1 },
  ]);
  let timestamp = 10_000;
  const records = createClientRecords(database, () => timestamp++);
  return {
    database,
    records,
    seedContacts: async () => {
      await database.clientContacts.bulkAdd([
        { id: 'contact-a', clientId: 'client-a', name: 'Ada Lovelace', role: 'Analyst',
          email: 'ada@example.test', phone: '', revision: 1, createdAt: 300, updatedAt: 300 },
        { id: 'contact-b', clientId: 'client-b', name: 'Grace Hopper', role: 'Engineer',
          email: 'grace@example.test', phone: '', revision: 1, createdAt: 400, updatedAt: 400 },
      ]);
    },
  };
}

export async function cleanupRecordsFixtures(): Promise<void> {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
}

export async function reopenRecordsDatabase(database: TabsDB): Promise<TabsDB> {
  const name = database.name;
  database.close();
  const reopened = new TabsDB(name);
  const index = databases.indexOf(database);
  if (index >= 0) databases[index] = reopened;
  else databases.push(reopened);
  await reopened.open();
  return reopened;
}
