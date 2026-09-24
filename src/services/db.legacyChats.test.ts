// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { db } from './db';

describe('historic chat upgrades', () => {
  it('preserves v6 message IDs, content, binding, and time through v18', async () => {
    await db.delete();
    const old = new Dexie('ZenEditorDB');
    old.version(6).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, documentId, taskId, agentId, timestamp',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
    });
    await old.open();
    await old.table('documents').add({ id: 'doc-1', title: 'Historic draft',
      content: 'Preserved document body', createdAt: 100, updatedAt: 102, order: 0 });
    await old.table('chatMessages').bulkAdd([
      { id: 'old-user', documentId: 'doc-1', agentId: 'agent-1', role: 'user',
        content: 'First question', timestamp: 101 },
      { id: 'old-answer', documentId: 'doc-1', agentId: 'agent-1', role: 'assistant',
        content: 'Preserved answer', timestamp: 102 },
    ]);
    old.close();

    await db.open();
    const rows = await db.chatMessages.orderBy('timestamp').toArray();
    expect(rows.map((row) => [row.id, row.content, row.timestamp, row.documentId])).toEqual([
      ['old-user', 'First question', 101, 'doc-1'],
      ['old-answer', 'Preserved answer', 102, 'doc-1'],
    ]);
    expect(rows.every((row) => row.threadId === 'legacy-document:doc-1')).toBe(true);
    const thread = await db.chatThreads.get('legacy-document:doc-1');
    expect(thread).toMatchObject({ origin: 'legacy_api', mode: 'writer',
      documentId: 'doc-1', createdAt: 101, updatedAt: 102 });
    expect(await db.table('documents').get('doc-1')).toMatchObject({
      title: 'Historic draft', content: 'Preserved document body',
    });
  });
});
