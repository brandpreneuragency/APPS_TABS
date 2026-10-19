import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../services/db';
import { useClientStore } from './clientStore';

beforeEach(async () => {
  await db.clients.clear();
  const clients = ['first', 'second', 'third'].map((id, order) => ({
    id, name: id, color: '', order, createdAt: 1,
  }));
  await db.clients.bulkPut(clients);
  useClientStore.setState({ clients });
});

describe('client reordering', () => {
  it('persists moves before and after another client', async () => {
    const orderedIds = async () => (await db.clients.orderBy('order').toArray()).map((client) => client.id);
    await useClientStore.getState().reorderClient('first', 'third', true);
    expect(await orderedIds()).toEqual(['second', 'third', 'first']);
    await useClientStore.getState().reorderClient('first', 'second', false);
    expect(await orderedIds()).toEqual(['first', 'second', 'third']);
    expect([...useClientStore.getState().clients].sort((left, right) => left.order - right.order)
      .map((client) => client.id)).toEqual(await orderedIds());
  });

  it('ignores missing clients and self drops', async () => {
    const original = await db.clients.toArray();
    await useClientStore.getState().reorderClient('missing', 'first', true);
    await useClientStore.getState().reorderClient('first', 'missing', false);
    await useClientStore.getState().reorderClient('first', 'first', true);
    expect(await db.clients.toArray()).toEqual(original);
  });
});
