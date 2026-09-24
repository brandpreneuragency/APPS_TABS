import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../services/db';
import { useChatStore } from './chatStore';

beforeEach(async () => {
  await db.delete();
  await db.open();
  useChatStore.setState({
    threads: [], activeThreadId: null, messagesByThread: {}, currentContext: null, lastViewedPerContext: {},
  });
});

describe('chat provider thread ownership', () => {
  it('uses the saved provider for new chats and changes only an empty thread', async () => {
    await db.settings.put({ key: 'activeChatProviderId', value: 'grok' });
    await useChatStore.getState().newChat({ mode: 'writer', workspaceId: 'workspace-1' });
    const threadId = useChatStore.getState().activeThreadId!;
    expect((await db.chatThreads.get(threadId))?.origin).toBe('grok');

    expect(await useChatStore.getState().setEmptyThreadOrigin(threadId, 'openCode')).toBe(true);
    expect((await db.chatThreads.get(threadId))?.origin).toBe('openCode');

    await db.chatMessages.add({
      id: 'message-1', threadId, mode: 'writer', workspaceId: 'workspace-1', agentId: 'agent-1',
      role: 'user', content: 'Keep this provider', timestamp: Date.now(),
    });
    expect(await useChatStore.getState().setEmptyThreadOrigin(threadId, 'commandCode')).toBe(false);
    expect((await db.chatThreads.get(threadId))?.origin).toBe('openCode');
  });
});
