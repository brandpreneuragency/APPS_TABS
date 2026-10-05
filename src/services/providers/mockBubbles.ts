import { nanoid } from 'nanoid';
import { db } from '../db';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types';

/**
 * Insert demo bubbles showing reasoning, answer, and tool-calling states.
 * Used for UI testing without a desktop CLI. Safe to call multiple times.
 */
export async function seedMockBubbles(threadId: string): Promise<void> {
  const thread = await db.chatThreads.get(threadId);
  if (!thread) throw new Error('Could not load the active chat thread.');
  const now = Date.now();
  const common = {
    threadId,
    mode: thread.mode,
    workspaceId: thread.workspaceId,
    taskId: thread.taskId,
    settingsTab: thread.settingsTab,
    agentId: 'mock-demo',
  } as const;

  const messages: ChatMessage[] = [
    {
      ...common,
      id: `mock:user:${nanoid(8)}`,
      role: 'user',
      content: 'Show me reasoning, answer, and tool states',
      timestamp: now,
    },
    {
      ...common,
      id: `mock:assistant:reasoning:${nanoid(8)}`,
      role: 'assistant',
      content: `<think>Comparing two approaches for the demo.\nOption A is faster; option B is safer.\nChoosing A for this preview.</think>\n\n### Answer\n\nThis bubble demonstrates the **reasoning** state (collapsible above) plus a rendered answer with H3 sections.`,
      timestamp: now + 1,
    },
    {
      ...common,
      id: `mock:tool:pending:${nanoid(8)}`,
      role: 'tool_call',
      content: '',
      toolCall: {
        toolCallId: `mock-tool-${nanoid(6)}`,
        name: 'shell_exec',
        args: JSON.stringify({ command: 'git status --short', cwd: 'C:/demo' }, null, 2),
        status: 'pending',
      },
      timestamp: now + 2,
    },
    {
      ...common,
      id: `mock:tool:done:${nanoid(8)}`,
      role: 'tool_call',
      content: '',
      toolCall: {
        toolCallId: `mock-tool-${nanoid(6)}`,
        name: 'shell_exec',
        args: JSON.stringify({ command: 'npm run typecheck', cwd: 'C:/demo' }, null, 2),
        status: 'done',
        resultSummary: 'typecheck passed with 0 errors in 4.2s',
      },
      timestamp: now + 3,
    },
    {
      ...common,
      id: `mock:assistant:answer:${nanoid(8)}`,
      role: 'assistant',
      content: `### Result\n\nMock tool run finished. See the pending bubble (awaiting approval) and the done bubble (executed) above.\n\n### Next\n\nSend a message with the Mock Tools provider to watch these states stream live.`,
      timestamp: now + 4,
    },
  ];

  await db.transaction('rw', db.chatMessages, db.chatThreads, async () => {
    await db.chatMessages.bulkAdd(messages);
    await db.chatThreads.update(threadId, { updatedAt: now + 4 });
  });
  await useChatStore.getState().syncThreadMessages(threadId);
}
