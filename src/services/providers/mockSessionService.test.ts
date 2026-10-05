import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { useChatStore } from '../../stores/chatStore';
import { MockProviderSessionService } from './mockSessionService';

beforeEach(async () => {
  await db.delete();
  await db.open();
  useChatStore.setState({
    threads: [], activeThreadId: null, messagesByThread: {}, currentContext: null, lastViewedPerContext: {},
  });
});

describe('mock provider session service', () => {
  it('streams reasoning then answer for mockEcho', async () => {
    await db.chatThreads.add({
      id: 'thread-echo', origin: 'mockEcho', mode: 'writer',
      workspaceId: 'ws-1', title: 'Mock Echo', createdAt: 1, updatedAt: 1,
    });
    const service = new MockProviderSessionService();
    await service.submit({
      providerId: 'mockEcho', modelId: 'mock-echo-1', appThreadId: 'thread-echo',
      mode: 'writer', workspaceId: 'ws-1', text: 'hello mocks',
    });
    const messages = (await db.chatMessages.where('threadId').equals('thread-echo').toArray())
      .sort((a, b) => a.timestamp - b.timestamp);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toContain('<think>');
    expect(messages[1].content).toContain('hello mocks');
    expect(service.snapshot()).toBeNull();
  }, 15000);

  it('emits pending then done tool bubbles for mockTools', async () => {
    await db.chatThreads.add({
      id: 'thread-tools', origin: 'mockTools', mode: 'writer',
      workspaceId: 'ws-1', title: 'Mock Tools', createdAt: 1, updatedAt: 1,
    });
    const service = new MockProviderSessionService();
    await service.submit({
      providerId: 'mockTools', modelId: 'mock-tools-1', appThreadId: 'thread-tools',
      mode: 'writer', workspaceId: 'ws-1', text: 'run checks',
    });
    const messages = await db.chatMessages.where('threadId').equals('thread-tools').toArray();
    const tools = messages.filter((m) => m.role === 'tool_call');
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(tools[0].toolCall?.status).toBe('done');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContain('<think>');
    expect(assistant?.content).toContain('run checks');
  }, 15000);

  it('refuses to send through the wrong provider thread', async () => {
    await db.chatThreads.add({
      id: 'thread-echo-2', origin: 'mockEcho', mode: 'writer',
      workspaceId: 'ws-1', title: 'Mock Echo', createdAt: 1, updatedAt: 1,
    });
    const service = new MockProviderSessionService();
    await expect(service.submit({
      providerId: 'mockTools', modelId: 'mock-tools-1', appThreadId: 'thread-echo-2',
      mode: 'writer', text: 'hello',
    })).rejects.toThrow(/another provider/i);
    expect(await db.chatMessages.count()).toBe(0);
  });
});
