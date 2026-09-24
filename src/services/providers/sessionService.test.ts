import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { useChatStore } from '../../stores/chatStore';
import { CliProviderSessionService } from './sessionService';
import { runCliProvider, stopCliProvider } from './chatClient';

vi.mock('./chatClient', () => ({
  runCliProvider: vi.fn(),
  stopCliProvider: vi.fn(async () => undefined),
}));

const scope = {
  appThreadId: 'thread-grok', mode: 'writer' as const, workspaceId: 'workspace',
  workspaceRoot: 'C:/workspace', agentId: 'agent', context: 'Selected document text',
};

describe('CLI provider chat service', () => {
  beforeEach(async () => {
    vi.mocked(runCliProvider).mockReset();
    vi.mocked(stopCliProvider).mockReset();
    await db.delete();
    await db.open();
    await db.chatThreads.add({ id: scope.appThreadId, origin: 'grok', mode: 'writer',
      workspaceId: scope.workspaceId, title: 'Grok chat', createdAt: 1, updatedAt: 1 });
    useChatStore.setState({ activeThreadId: scope.appThreadId, messagesByThread: {} });
  });

  it('persists the prompt and response in the provider-owned thread', async () => {
    vi.mocked(runCliProvider).mockImplementation(async (request) => ({
      runId: request.runId, status: 'completed', text: 'A useful reply',
    }));
    const service = new CliProviderSessionService();
    await service.submit({ providerId: 'grok', modelId: 'grok-4.7', reasoningEffort: 'high', scope, text: 'Summarize it' });
    const request = vi.mocked(runCliProvider).mock.calls[0][0];
    expect(request.providerId).toBe('grok');
    expect(request.reasoningEffort).toBe('high');
    expect(request.prompt).toContain('Selected document text');
    expect(request.prompt).toContain('[LATEST USER MESSAGE]\nSummarize it');
    const messages = await db.chatMessages.where('threadId').equals(scope.appThreadId).toArray();
    expect(messages.sort((a, b) => a.timestamp - b.timestamp).map((message) => message.content))
      .toEqual(['Summarize it', 'A useful reply']);
    expect(service.snapshot()).toBeNull();
  });

  it('refuses to send through the wrong provider without writing a message', async () => {
    const service = new CliProviderSessionService();
    await expect(service.submit({ providerId: 'openCode', modelId: 'openai/gpt-5', scope, text: 'Hello' }))
      .rejects.toThrow(/another provider/i);
    expect(await db.chatMessages.count()).toBe(0);
    expect(runCliProvider).not.toHaveBeenCalled();
  });

  it('lets a user stop the active native run', async () => {
    let finish!: (value: { runId: string; status: 'stopped'; text: string }) => void;
    vi.mocked(runCliProvider).mockImplementation((request) => new Promise((resolve) => {
      finish = resolve;
      expect(request.providerId).toBe('grok');
    }));
    const service = new CliProviderSessionService();
    const pending = service.submit({ providerId: 'grok', modelId: 'grok-4.7', scope, text: 'Hello' });
    await vi.waitFor(() => expect(service.snapshot()?.runId).toBeTruthy());
    const runId = service.snapshot()!.runId;
    await service.stop();
    expect(stopCliProvider).toHaveBeenCalledWith(runId);
    finish({ runId, status: 'stopped', text: '' });
    await pending;
    expect((await db.chatMessages.get(`cli:assistant:${runId}`))?.content).toBe('Response stopped.');
  });
});
