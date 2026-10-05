import { db } from '../db';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types';
import i18n from '../../i18n';
import { buildMockEchoAnswer, buildMockToolsAnswer, isMockProviderId, type MockProviderId } from './mockProviders';

export interface MockSubmission {
  providerId: MockProviderId;
  modelId: string;
  text: string;
  appThreadId: string;
  mode: 'writer' | 'task';
  workspaceId?: string;
  taskId?: string;
  settingsTab?: string;
  agentId?: string;
}

export interface ActiveMockRun {
  runId: string;
  appThreadId: string;
  providerId: MockProviderId;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Local mock runner: streams reasoning → (tool calls) → answer without Tauri/CLI. */
export class MockProviderSessionService {
  private active: ActiveMockRun | null = null;
  private listeners = new Set<() => void>();
  private stopped = false;

  snapshot = (): ActiveMockRun | null => this.active;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private notify() { for (const listener of this.listeners) listener(); }

  async submit(submission: MockSubmission): Promise<void> {
    if (this.active) throw new Error(i18n.t('cliChat.waitForResponse'));
    if (!isMockProviderId(submission.providerId)) throw new Error('Unknown mock provider.');
    const text = submission.text.trim();
    if (!text) throw new Error('Enter a message before sending.');

    const thread = await db.chatThreads.get(submission.appThreadId);
    if (!thread || thread.origin !== submission.providerId) {
      throw new Error(i18n.t('cliChat.wrongProviderThread', { provider: submission.providerId }));
    }

    const runId = crypto.randomUUID();
    const now = Date.now();
    const common = {
      threadId: submission.appThreadId,
      mode: submission.mode,
      workspaceId: submission.workspaceId,
      taskId: submission.taskId,
      settingsTab: submission.settingsTab,
      agentId: submission.agentId ?? 'mock-agent',
    };
    const userMessage: ChatMessage = {
      ...common, id: `mock:user:${runId}`, role: 'user', content: text, timestamp: now,
    };
    // Start with an open <think> block so the UI shows the reasoning state first.
    const assistantMessage: ChatMessage = {
      ...common, id: `mock:assistant:${runId}`, role: 'assistant',
      content: '<think>Reading your message…', timestamp: now + 1,
    };

    await db.transaction('rw', db.chatMessages, db.chatThreads, async () => {
      const current = await db.chatThreads.get(submission.appThreadId);
      if (current?.origin !== submission.providerId) {
        throw new Error(i18n.t('cliChat.wrongProviderThread', { provider: submission.providerId }));
      }
      await db.chatMessages.bulkAdd([userMessage, assistantMessage]);
      await db.chatThreads.update(submission.appThreadId, { updatedAt: now });
    });
    await useChatStore.getState().syncThreadMessages(submission.appThreadId);
    this.active = { runId, appThreadId: submission.appThreadId, providerId: submission.providerId };
    this.stopped = false;
    this.notify();

    try {
      const isTools = submission.providerId === 'mockTools';
      const { reasoning, answer } = isTools ? buildMockToolsAnswer(text) : buildMockEchoAnswer(text);

      // 1) Stream reasoning inside <think>…</think>.
      const words = reasoning.split(/\s+/);
      let partial = '';
      for (const word of words) {
        if (this.stopped) break;
        partial += (partial ? ' ' : '') + word;
        await db.chatMessages.update(assistantMessage.id, { content: `<think>${partial}` });
        await useChatStore.getState().syncThreadMessages(submission.appThreadId);
        await delay(60);
      }
      if (this.stopped) {
        await db.chatMessages.update(assistantMessage.id, { content: `${assistantMessage.content}\n\n${i18n.t('cliChat.responseStopped')}` });
        return;
      }
      const fullReasoned = `<think>${reasoning}</think>\n\n${isTools ? 'Running mock tools…' : ''}`;
      await db.chatMessages.update(assistantMessage.id, { content: fullReasoned });
      await useChatStore.getState().syncThreadMessages(submission.appThreadId);

      // 2) For mockTools: show pending → done tool bubbles.
      if (isTools) {
        const toolId = `mock:tool:${runId}`;
        await db.chatMessages.add({
          ...common,
          id: toolId,
          role: 'tool_call',
          content: '',
          toolCall: {
            toolCallId: `mock-${runId.slice(0, 8)}`,
            name: 'shell_exec',
            args: JSON.stringify({ command: `echo "${text.slice(0, 60)}"`, model: submission.modelId }, null, 2),
            status: 'pending',
          },
          timestamp: Date.now(),
        });
        await useChatStore.getState().syncThreadMessages(submission.appThreadId);
        await delay(700);
        if (this.stopped) {
          await db.chatMessages.update(toolId, { content: i18n.t('cliChat.responseStopped') });
          await db.chatMessages.update(assistantMessage.id, { content: `${fullReasoned}\n\n${i18n.t('cliChat.responseStopped')}` });
          return;
        }
        await db.chatMessages.update(toolId, {
          toolCall: {
            toolCallId: `mock-${runId.slice(0, 8)}`,
            name: 'shell_exec',
            args: JSON.stringify({ command: `echo "${text.slice(0, 60)}"`, model: submission.modelId }, null, 2),
            status: 'done',
            resultSummary: 'mock tool finished in 0.7s',
          },
        });
        await useChatStore.getState().syncThreadMessages(submission.appThreadId);
        await delay(300);
      }

      if (this.stopped) {
        await db.chatMessages.update(assistantMessage.id, {
          content: `<think>${reasoning}</think>\n\n${i18n.t('cliChat.responseStopped')}`,
        });
        return;
      }

      // 3) Stream the final answer after the reasoning block.
      const answerWords = answer.split(/\s+/);
      let answerPartial = '';
      for (const word of answerWords) {
        if (this.stopped) break;
        answerPartial += (answerPartial ? ' ' : '') + word;
        await db.chatMessages.update(assistantMessage.id, {
          content: `<think>${reasoning}</think>\n\n${answerPartial}`,
        });
        if (answerWords.length > 12) {
          await useChatStore.getState().syncThreadMessages(submission.appThreadId);
          await delay(25);
        }
      }
      const finalContent = this.stopped
        ? `<think>${reasoning}</think>\n\n${answerPartial}\n\n${i18n.t('cliChat.responseStopped')}`
        : `<think>${reasoning}</think>\n\n${answer}`;
      await db.chatMessages.update(assistantMessage.id, { content: finalContent });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 400) : 'Mock run failed.';
      await db.chatMessages.update(`mock:assistant:${runId}`, {
        content: `${i18n.t('cliChat.requestFailed')} ${message}`,
      });
    } finally {
      this.active = null;
      this.notify();
      await useChatStore.getState().syncThreadMessages(submission.appThreadId);
    }
  }

  async stop(): Promise<void> {
    if (this.active) this.stopped = true;
  }

  /** Test hook: reset active state between isolated runs. */
  resetForTests(): void {
    this.active = null;
    this.stopped = false;
  }
}

export const mockProviderSessionService = new MockProviderSessionService();
