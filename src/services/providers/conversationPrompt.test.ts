import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types';
import { buildCliConversationPrompt } from './conversationPrompt';

function message(id: string, role: 'user' | 'assistant', content: string, timestamp: number): ChatMessage {
  return { id, threadId: 'thread', mode: 'writer', agentId: 'agent', role, content, timestamp };
}

describe('buildCliConversationPrompt', () => {
  it('keeps the latest text and context while bounding old messages', () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      message(String(index), index % 2 ? 'assistant' : 'user', 'old'.repeat(500), index));
    const prompt = buildCliConversationPrompt('Please summarize', 'current document', history);
    expect(prompt).toContain('[LATEST USER MESSAGE]\nPlease summarize');
    expect(prompt).toContain('current document');
    expect(prompt).not.toContain('User: old'.repeat(100));
    expect(prompt.length).toBeLessThanOrEqual(12_000);
  });

  it('rejects a long latest message instead of silently truncating it', () => {
    expect(() => buildCliConversationPrompt('x'.repeat(4_001), '', [])).toThrow(/4,?000/);
  });
});
