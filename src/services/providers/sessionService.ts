import { db } from '../db';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types';
import type { CodexScope } from '../codex/sessionTypes';
import i18n from '../../i18n';
import type { CliProviderId } from './desktopClient';
import { runCliProvider, stopCliProvider } from './chatClient';
import { buildCliConversationPrompt } from './conversationPrompt';
import { finalizeProviderDispatch, persistedGithubDispatchAllowed, providerDispatchBlockedMessage } from '../github/aiEgress';
import type { GithubDispatchContext } from '../github/aiEgress';

type CliScope = Pick<CodexScope,
  'appThreadId' | 'mode' | 'workspaceId' | 'taskId' | 'settingsTab' | 'agentId'
  | 'selectedText' | 'selectionFrom' | 'selectionTo' | 'workspaceRoot' | 'context'>;

export interface CliSubmission {
  providerId: CliProviderId;
  modelId: string;
  reasoningEffort?: string;
  scope: CliScope;
  text: string;
  github?: GithubDispatchContext;
}

export interface ActiveCliRun {
  runId: string;
  appThreadId: string;
  providerId: CliProviderId;
}

/** Keeps one supervised local CLI turn active at a time in this WebView. */
export class CliProviderSessionService {
  private active: ActiveCliRun | null = null;
  private listeners = new Set<() => void>();

  snapshot = (): ActiveCliRun | null => this.active;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private notify() { for (const listener of this.listeners) listener(); }

  async submit({ providerId, modelId, reasoningEffort, scope, text, github }: CliSubmission): Promise<void> {
    if (this.active) throw new Error(i18n.t('cliChat.waitForResponse'));
    const thread = await db.chatThreads.get(scope.appThreadId);
    if (!thread || thread.origin !== providerId) {
      throw new Error(i18n.t('cliChat.wrongProviderThread', { provider: providerName(providerId) }));
    }
    const priorMessages = await db.chatMessages.where('threadId').equals(scope.appThreadId).toArray();
    if (github && !persistedGithubDispatchAllowed({
      accountId: github.accountId,
      repoId: github.repoId,
      ref: github.ref,
      requestedWorkspaceId: scope.workspaceId,
      threadWorkspaceId: thread.workspaceId,
      messageWorkspaceIds: priorMessages.map((message) => message.workspaceId),
    })) {
      throw new Error('GitHub provider thread does not match the consented repository. Previously sent content cannot be recalled.');
    }
    const runId = crypto.randomUUID();
    const now = Date.now();
    const common = {
      threadId: scope.appThreadId, mode: scope.mode, workspaceId: scope.workspaceId,
      taskId: scope.taskId, settingsTab: scope.settingsTab, agentId: scope.agentId,
    };
    const userMessage: ChatMessage = {
      ...common, id: `cli:user:${runId}`, role: 'user', content: text.trim(),
      selectedText: scope.selectedText, selectionFrom: scope.selectionFrom,
      selectionTo: scope.selectionTo, timestamp: now,
    };
    const assistantMessage: ChatMessage = {
      ...common, id: `cli:assistant:${runId}`, role: 'assistant', content: '', timestamp: now + 1,
    };
    await db.transaction('rw', db.chatMessages, db.chatThreads, async () => {
      const current = await db.chatThreads.get(scope.appThreadId);
      if (current?.origin !== providerId) {
        throw new Error(i18n.t('cliChat.wrongProviderThread', { provider: providerName(providerId) }));
      }
      await db.chatMessages.bulkAdd([userMessage, assistantMessage]);
      await db.chatThreads.update(scope.appThreadId, { updatedAt: now });
    });
    await useChatStore.getState().syncThreadMessages(scope.appThreadId);
    this.active = { runId, appThreadId: scope.appThreadId, providerId };
    this.notify();

    try {
      const decision = finalizeProviderDispatch({
        provider: 'cli',
        threadId: scope.appThreadId,
        text,
        context: scope.context,
        history: priorMessages.map((message) => ({ role: message.role, content: message.content, timestamp: message.timestamp })),
        attachments: [],
        images: [],
        toolOutput: '',
        github,
      });
      if (decision.aborted) {
        await db.chatMessages.update(assistantMessage.id, { content: decision.reason ?? providerDispatchBlockedMessage() });
        return;
      }
      const history = priorMessages.filter((message) => decision.history.some((item) => item.content === message.content));
      const prompt = buildCliConversationPrompt(decision.text, decision.context, history);
      const result = await runCliProvider({
        runId, providerId, modelId, reasoningEffort, prompt, workspaceRoot: scope.workspaceRoot,
      });
      if (result.runId !== runId) throw new Error('The provider returned a mismatched run.');
      const content = result.status === 'stopped' ? i18n.t('cliChat.responseStopped') : result.text.trim();
      if (!content) throw new Error(i18n.t('cliChat.emptyResponse'));
      await db.chatMessages.update(assistantMessage.id, { content });
    } catch (cause) {
      await db.chatMessages.update(assistantMessage.id, {
        content: `${i18n.t('cliChat.requestFailed')} ${errorMessage(cause)}`,
      });
    } finally {
      this.active = null;
      this.notify();
      await useChatStore.getState().syncThreadMessages(scope.appThreadId);
    }
  }

  async stop(): Promise<void> {
    const runId = this.active?.runId;
    if (runId) await stopCliProvider(runId);
  }

  /** A WebView reload loses the pending invoke; make its empty bubble actionable. */
  async recoverThread(threadId: string): Promise<void> {
    if (this.active?.appThreadId === threadId) return;
    const messages = await db.chatMessages.where('threadId').equals(threadId).toArray();
    const interrupted = messages.filter((message) => message.id.startsWith('cli:assistant:') && !message.content);
    if (!interrupted.length) return;
    await db.transaction('rw', db.chatMessages, async () => {
      for (const message of interrupted) {
        await db.chatMessages.update(message.id, { content: i18n.t('cliChat.interruptedAfterReload') });
      }
    });
    await useChatStore.getState().syncThreadMessages(threadId);
  }
}

function providerName(providerId: CliProviderId): string {
  return providerId === 'grok' ? 'Grok' : providerId === 'commandCode' ? 'Command Code' : 'OpenCode';
}

function errorMessage(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') {
    return cause.message.slice(0, 400);
  }
  return 'Check the provider connection in Tools and try again.';
}

export const cliProviderSessionService = new CliProviderSessionService();
