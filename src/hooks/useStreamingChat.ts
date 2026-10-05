import { useCallback, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '../types';
import { useChatStore } from '../stores/chatStore';
import { isTauriRuntime } from '../services/runtime';
import { codexSessionService } from '../services/codex/sessionService';
import { boundedContext, captureCodexScope } from '../services/codex/contextBuilder';
import { db } from '../services/db';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { loadCodexModelVisibility, visibleCodexModels } from '../services/codex/modelVisibility';
import { probeCliProvider, type CliProviderId } from '../services/providers/desktopClient';
import { loadProviderModelVisibility, visibleProviderModels } from '../services/providers/modelVisibility';
import { cliProviderSessionService } from '../services/providers/sessionService';
import { cliProviderDefaultWorkspace } from '../services/providers/chatClient';
import { cliReasoningEffortSettingKey, supportedCliReasoningEffort } from '../services/providers/reasoningEffort';
import { isMockProviderId, mockProviderModels } from '../services/providers/mockProviders';
import { mockProviderSessionService } from '../services/providers/mockSessionService';
import type { ChatProviderId } from '../types';

function isCliProvider(value: unknown): value is CliProviderId {
  return value === 'grok' || value === 'commandCode' || value === 'openCode';
}

/** Chat input facade. Local providers run only in the Windows desktop process. */
export function useStreamingChat(
  threadId: string,
  mode: 'writer' | 'task',
  contextWorkspaceId?: string,
  contextTaskId?: string,
  contextSettingsTab?: string,
  editor?: Editor | null,
) {
  const { t } = useTranslation();
  const newChat = useChatStore((state) => state.newChat);

  useEffect(() => {
    if (!threadId) return;
    void db.chatThreads.get(threadId).then((thread) => {
      if (isCliProvider(thread?.origin)) return cliProviderSessionService.recoverThread(threadId);
    });
  }, [threadId]);

  const sendMessage = useCallback(async (
    userText: string,
    selectedText?: string,
    selectionFrom?: number,
    selectionTo?: number,
    attachments?: Attachment[],
    searchWeb?: boolean,
    replyTo?: { id: string; role: 'user' | 'assistant'; content: string; sender: string },
  ) => {
    let activeThread = useChatStore.getState().activeThreadId ?? threadId;
    if (!activeThread) {
      await newChat({ mode, workspaceId: contextWorkspaceId, taskId: contextTaskId,
        settingsTab: contextSettingsTab });
      activeThread = useChatStore.getState().activeThreadId ?? '';
    }
    if (!activeThread) throw new Error('Could not create a chat thread');

    const thread = await db.chatThreads.get(activeThread);
    if (!thread) throw new Error('Could not load the active chat thread.');
    if (isMockProviderId(thread.origin)) {
      if (searchWeb) throw new Error(t('codex.searchUnavailable'));
      const catalogue = mockProviderModels[thread.origin];
      const preferredModel = (await db.settings.get(`providerModelId:${thread.origin}`))?.value;
      const chosen = catalogue.find((model) => model.id === preferredModel)
        ?? catalogue.find((model) => model.isDefault) ?? catalogue[0];
      await mockProviderSessionService.submit({
        providerId: thread.origin, modelId: chosen.id, appThreadId: activeThread, mode,
        workspaceId: contextWorkspaceId, taskId: contextTaskId, settingsTab: contextSettingsTab,
        text: userText,
      });
      return;
    }
    if (!isTauriRuntime()) throw new Error(t('cliChat.desktopOnly'));
    if (searchWeb) throw new Error(t('codex.searchUnavailable'));
    const providerId: ChatProviderId = isCliProvider(thread?.origin) ? thread.origin : 'codex';
    if (thread?.origin === 'legacy_api') {
      throw new Error(t('cliChat.legacyThread'));
    }

    if (isCliProvider(providerId)) {
      if (attachments?.length) throw new Error(t('cliChat.attachmentsUnavailable'));
      const probe = await probeCliProvider(providerId);
      if (!probe.installed) throw new Error(probe.error ?? t('cliChat.cliNotInstalled', { provider: providerId }));
      if (probe.authState === 'notAuthenticated') {
        throw new Error(t('cliChat.signInRequired', { provider: providerId }));
      }
      if (!probe.models.length) throw new Error(probe.error ?? t('codex.noModels'));
      const models = visibleProviderModels(probe.models, await loadProviderModelVisibility(providerId));
      if (!models.length) throw new Error(t('codex.noVisibleModels'));
      const preferredModel = (await db.settings.get(`providerModelId:${providerId}`))?.value;
      const chosen = models.find((model) => model.id === preferredModel)
        ?? models.find((model) => model.isDefault) ?? models[0];
      const savedEffort = (await db.settings.get(cliReasoningEffortSettingKey(providerId, chosen.id)))?.value;
      const reasoningEffort = supportedCliReasoningEffort(chosen, savedEffort);
      const connectedRoot = useWorkspaceStore.getState().workspaces
        .find((workspace) => workspace.id === contextWorkspaceId)?.connectedFolders[0]?.path;
      const fallbackWorkspaceRoot = connectedRoot ? undefined : await cliProviderDefaultWorkspace();
      const scope = await captureCodexScope({ appThreadId: activeThread, mode,
        workspaceId: contextWorkspaceId, taskId: contextTaskId, settingsTab: contextSettingsTab,
        selectedText, selectionFrom, selectionTo, editor, model: chosen.id,
        permissionProfile: 'readOnly', fallbackWorkspaceRoot });
      if (replyTo) {
        scope.context = boundedContext([scope.context,
          `[REPLY TO ${replyTo.role} ${replyTo.id}]\n${replyTo.content}`]);
      }
      await cliProviderSessionService.submit({ providerId, modelId: chosen.id, reasoningEffort, scope, text: userText });
      return;
    }

    const { models: catalogue, connection } = codexSessionService.snapshot();
    if (connection && !catalogue.length) throw new Error(t('codex.noModels'));
    const models = visibleCodexModels(catalogue, await loadCodexModelVisibility());
    if (catalogue.length && !models.length) throw new Error(t('codex.noVisibleModels'));

    const existingSession = await db.codexSessions.get(activeThread);
    const existingRuns = await db.codexRuns.where('appThreadId').equals(activeThread).count();
    if (!existingSession && existingRuns === 0
      && await db.chatMessages.where('threadId').equals(activeThread).count()) {
      throw new Error('This is a legacy chat. Start a new Codex chat or create an explicit handoff.');
    }

    const preferredModel = (await db.settings.get('codexModelId'))?.value;
    const chosen = models.find((model) => model.id === preferredModel)
      ?? models.find((model) => model.isDefault) ?? models[0];
    const preferredEffort = (await db.settings.get('codexEffort'))?.value;
    const effort = typeof preferredEffort === 'string' && chosen?.reasoningEfforts.includes(preferredEffort)
      ? preferredEffort : undefined;
    const preferredAccess = (await db.settings.get('codexPermissionProfile'))?.value;
    const hasConnectedFolder = Boolean(useWorkspaceStore.getState().workspaces
      .find((workspace) => workspace.id === contextWorkspaceId)?.connectedFolders[0]?.path);
    const permissionProfile = existingSession
      ? existingSession.permissionProfile ?? 'readOnly'
      : preferredAccess === 'workspaceWrite' && hasConnectedFolder ? 'workspaceWrite' : 'readOnly';
    const scope = await captureCodexScope({ appThreadId: activeThread, mode,
      workspaceId: contextWorkspaceId, taskId: contextTaskId, settingsTab: contextSettingsTab,
      selectedText, selectionFrom, selectionTo, attachments, editor, model: chosen?.id, effort,
      permissionProfile });

    const handoff = await db.settings.get(`codexHandoff:${activeThread}`);
    if (typeof handoff?.value === 'string' && handoff.value) {
      scope.context = boundedContext([scope.context, `[EXPLICIT CHAT HANDOFF]\n${handoff.value}`]);
    }
    if (replyTo) {
      scope.context = boundedContext([scope.context,
        `[REPLY TO ${replyTo.role} ${replyTo.id}]\n${replyTo.content}`]);
    }
    await codexSessionService.submit({ clientCommandId: crypto.randomUUID(), scope, text: userText });
  }, [threadId, mode, contextWorkspaceId, contextTaskId, contextSettingsTab, editor, newChat, t]);

  const stopStreaming = useCallback(() => {
    const mockRun = mockProviderSessionService.snapshot();
    if (mockRun?.appThreadId === (useChatStore.getState().activeThreadId ?? threadId)) {
      void mockProviderSessionService.stop();
      return;
    }
    const cliRun = cliProviderSessionService.snapshot();
    if (cliRun?.appThreadId === (useChatStore.getState().activeThreadId ?? threadId)) {
      void cliProviderSessionService.stop();
      return;
    }
    const runId = codexSessionService.snapshot().activeRunId;
    if (runId) void codexSessionService.stop(runId);
  }, [threadId]);

  return { sendMessage, stopStreaming };
}
