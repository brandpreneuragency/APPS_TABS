import { useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAIStore } from '../stores/aiStore';
import { useTaskStore } from '../stores/taskStore';
import { useTaskCommentStore } from '../stores/taskCommentStore';
import { streamChat } from '../services/ai/router';
import type { ChatMessage as AiChatMessage, ContentPart } from '../services/ai/types';
import { getWriterInstructions, getTaskInstructions } from '../services/instructionFiles';
import { buildTaskAIContext } from '../services/taskAIContext';
import { buildSettingsAIContext } from '../components/settings/settingsAIContext';
import type { SettingsSubTab } from '../stores/uiStore';
import { readTextFile } from '../services/fs-adapter';
import { findNodeByFullPath, useWorkspaceStore } from '../stores/workspaceStore';
import type { ChatMessage as AppChatMessage, Attachment, MessageUsage } from '../types';
import { invokeWebSearch, formatSearchResultsAsContext } from '../services/search';
import type { AIProviderConfig } from '../types';
import { secureStorage } from '../services/secureStorage';
import { estimateTokens, estimateMessageTokens } from '../utils/tokens';
import { decodeDataUrlText } from '../utils/fileData';
import { getFileCategory, isTextFile } from '../utils/fileType';
import { useAgentLoop } from './useAgentLoop';
import {
  AI_TOOLS,
  dispatchToolCall,
  getWorkspaceRoot,
  registerApproval,
  createApprovalGate,
} from '../services/aiTools';
import type { ToolCall } from '../services/ai/types';

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

const MAX_CONTEXT_BYTES = 64 * 1024;

/** Heuristic: content looks textual if the sample has no NUL bytes. */
function looksLikeText(content: string): boolean {
  if (!content) return true;
  const sample = content.slice(0, 8192);
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) return false;
  }
  return true;
}

function isTextLikeAttachment(att: Attachment): boolean {
  const category = getFileCategory(att.name, att.mimeType);
  if (category === 'text' || category === 'code') return true;
  if (isTextFile(att.name)) return true;
  const mime = (att.mimeType || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    mime === 'application/x-yaml' ||
    mime === 'application/yaml' ||
    mime === 'application/csv' ||
    mime === 'application/sql'
  ) {
    return true;
  }
  return false;
}

function truncateContext(content: string): string {
  if (content.length <= MAX_CONTEXT_BYTES) return content;
  return content.slice(0, MAX_CONTEXT_BYTES) + '\n…[truncated]';
}

/** Read file/folder attachments into a text block for the AI.
 *  - Path-based attachments: contents are read fresh at send time.
 *  - Picker attachments (dataUrl, no path): decoded inline when text-like.
 *  - Folders: shallow name listing only.
 *  Images are handled separately as image_url parts and skipped here. */
async function buildAttachmentContext(attachments?: Attachment[]): Promise<string> {
  if (!attachments || attachments.length === 0) return '';
  const blocks: string[] = [];
  for (const att of attachments) {
    if (att.kind !== 'file' && att.kind !== 'folder') continue;
    const label = att.displayPath || att.name;
    if (att.kind === 'file' && att.path) {
      try {
        const content = truncateContext(await readTextFile(att.path));
        blocks.push(`[File: ${label}]\n${content}`);
      } catch {
        blocks.push(`[File: ${label}]\n<Unable to read file>`);
      }
    } else if (att.kind === 'file' && att.dataUrl) {
      // File-picker attachments without a workspace path.
      try {
        const preferText = isTextLikeAttachment(att);
        const decoded = decodeDataUrlText(att.dataUrl);
        if (preferText || looksLikeText(decoded)) {
          blocks.push(`[File: ${label}]\n${truncateContext(decoded)}`);
        } else {
          const mime = att.mimeType || 'application/octet-stream';
          blocks.push(
            `[File: ${label}]\n<Binary file (${mime}); content not included as text. ` +
              `Describe or convert it if you need its contents.>`,
          );
        }
      } catch {
        blocks.push(`[File: ${label}]\n<Unable to read attached file>`);
      }
    } else if (att.kind === 'folder' && att.path) {
      try {
        await useWorkspaceStore.getState().ensureChildrenLoaded(useWorkspaceStore.getState().activeWorkspaceId!, att.path);
        const root = useWorkspaceStore.getState().getActiveRootNode();
        const node = root ? findNodeByFullPath(root, att.path) : null;
        const names = node?.children?.map((c) => c.name) ?? [];
        blocks.push(`[Folder: ${label}]\n` + (names.length ? names.map((n) => `- ${n}`).join('\n') : '(empty)'));
      } catch {
        blocks.push(`[Folder: ${label}]\n<Unable to read folder>`);
      }
    }
  }
  return blocks.length ? `[Attached context]:\n${blocks.join('\n\n')}` : '';
}

function imagePartsFrom(attachments?: Attachment[]): ContentPart[] {
  if (!attachments) return [];
  return attachments
    .filter((a) => a.kind !== 'file' && a.kind !== 'folder' && a.dataUrl)
    .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl as string } }));
}

export function useStreamingChat(
  threadId: string,
  mode: 'writer' | 'task',
  contextWorkspaceId?: string,
  contextTaskId?: string,
  contextSettingsTab?: string,
) {
  const {
    addMessage,
    updateMessage,
    setStreamingMessageId,
    setIsStreaming,
    getActiveThreadMessages,
    newChat,
    activeThreadId,
  } = useChatStore();
  const { getActiveAgent, getActiveProvider } = useAIStore();
  const systemInstructions = useAIStore((state) => state.systemInstructions);
  const searchConfig = useAIStore((state) => state.searchConfig);
  const abortRef = useRef<AbortController | null>(null);
  const { runAgentLoop } = useAgentLoop();

  const isTaskMode = mode === 'task';

  const sendMessage = useCallback(
    async (
      userText: string,
      selectedText?: string,
      selectionFrom?: number,
      selectionTo?: number,
      attachments?: Attachment[],
      searchWeb?: boolean,
      replyTo?: { id: string; role: 'user' | 'assistant'; content: string; sender: string },
    ) => {
      const provider = getActiveProvider();
      if (!provider) {
        throw new Error('No AI provider configured. Please add an API key in Settings.');
      }

      // Provider configs never contain the persisted secret. Hydrate it from
      // secure storage and fail before sending an unauthenticated request.
      let storedKey: string | null;
      try {
        storedKey = await secureStorage.secureGet(`providerApiKey_${provider.id}`);
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new Error(`Could not read the saved API key for ${provider.name}.${detail}`);
      }

      const apiKey = (provider.apiKey || storedKey || '').trim();
      if (!apiKey) {
        throw new Error(
          `No saved API key was found for ${provider.name}. Open Model Management and connect the provider again.`,
        );
      }
      const resolvedProvider = { ...provider, apiKey };

      const agent = getActiveAgent(mode);

      // Ensure we have an active thread. If the caller passed an empty
      // threadId (e.g. first message in a fresh context), create one now
      // and use its id for all subsequent operations.
      // Always prefer the store's activeThreadId over the prop, since the
      // prop may be stale (captured in the hook's closure before the
      // thread was created).
      let activeThread = useChatStore.getState().activeThreadId ?? threadId;
      if (!activeThread) {
        await newChat({
          mode,
          workspaceId: contextWorkspaceId,
          taskId: contextTaskId,
          settingsTab: contextSettingsTab,
        });
        activeThread = useChatStore.getState().activeThreadId ?? '';
        if (!activeThread) {
          throw new Error('Failed to create a chat thread.');
        }
      }

      const userMessage: AppChatMessage = {
        id: shortId(),
        threadId: activeThread,
        mode,
        workspaceId: contextWorkspaceId || undefined,
        settingsTab: contextSettingsTab || undefined,
        taskId: contextTaskId || undefined,
        agentId: agent.id,
        role: 'user',
        content: userText,
        selectedText,
        selectionFrom,
        selectionTo,
        replyTo,
        attachments: attachments?.length ? attachments : undefined,
        timestamp: Date.now(),
        usage: { promptTokens: estimateMessageTokens({ content: userText, selectedText, attachments }) },
      };
      await addMessage(userMessage);

      const history = getActiveThreadMessages();
      const fileInstructions = isTaskMode ? await getTaskInstructions() : await getWriterInstructions();
      const parts: string[] = [];
      // Safe Settings page context only — never secrets/API keys (see buildSettingsAIContext).
      if (contextSettingsTab) {
        parts.push(buildSettingsAIContext(contextSettingsTab as SettingsSubTab));
      }
      if (fileInstructions?.trim()) parts.push(fileInstructions.trim());
      if (systemInstructions.trim()) parts.push(systemInstructions.trim());
      parts.push(agent.systemPrompt);

      let webSearchText = '';
      if (searchWeb && userText.trim()) {
        try {
          const results = await invokeWebSearch(userText.trim(), {
            exaKey: searchConfig.exaKey,
            tavilyKey: searchConfig.tavilyKey,
            searchProvider: searchConfig.searchProvider,
          });
          if (results.length > 0) {
            webSearchText = formatSearchResultsAsContext(results);
          }
        } catch (error) {
          console.warn('Web search failed, continuing without results:', error);
        }
      }
      if (webSearchText) {
        parts.push(
          `[WEB SEARCH RESULTS for query: "${userText.trim()}"]\nUse these results when useful and cite sources.\n\n${webSearchText}`,
        );
      }

      const assistantMessage: AppChatMessage = {
        id: shortId(),
        threadId: activeThread,
        mode,
        workspaceId: contextWorkspaceId || undefined,
        taskId: contextTaskId || undefined,
        settingsTab: contextSettingsTab || undefined,
        agentId: agent.id,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      await addMessage(assistantMessage);
      setStreamingMessageId(assistantMessage.id);
      setIsStreaming(true);
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      try {
        if (isTaskMode && contextTaskId) {
          const taskStore = useTaskStore.getState();
          const activeTask = taskStore.tasks.find((task) => task.id === contextTaskId);
          if (!activeTask) {
            await updateMessage(assistantMessage.id, {
              content: 'The active task could not be found. Please reselect a task and try again.',
            });
            return;
          }

          await useTaskCommentStore.getState().loadComments(contextTaskId);
          const comments = useTaskCommentStore.getState().getComments(contextTaskId);
          void buildTaskAIContext(activeTask, [], comments);

          const basePrompt = parts.join('\n\n');
          const attachmentContext = await buildAttachmentContext(attachments);
          const userTextWithContext = attachmentContext
            ? `${attachmentContext}\n\n[User message]:\n${userText}`
            : userText;
          const imageParts = imagePartsFrom(attachments);
          const userContentParts: ContentPart[] = [{ type: 'text', text: userTextWithContext }, ...imageParts];
          const userContent: string | ContentPart[] = attachments?.length ? userContentParts : userTextWithContext;
          const aiMessages: AiChatMessage[] = [
            { role: 'system', content: basePrompt },
            { role: 'user', content: userContent },
          ];

          let fullContent = '';
          let finalUsage: MessageUsage | undefined;
          const streamGen = streamChat(
            aiMessages,
            resolvedProvider as AIProviderConfig,
            signal,
          );
          for await (const chunk of streamGen) {
            fullContent += chunk.content;
            if (chunk.usage) {
              finalUsage = chunk.usage;
              continue;
            }
            const estimated = estimateTokens(fullContent);
            await updateMessage(assistantMessage.id, {
              content: fullContent,
              usage: { completionTokens: estimated },
            });
          }

          await updateMessage(assistantMessage.id, {
            content: fullContent,
            ...(finalUsage ? { usage: finalUsage } : {}),
          });
          return;
        }

        const basePrompt = parts.join('\n\n');

        const historyWithContext: AiChatMessage[] = await Promise.all(
          history.map(async (message) => {
            if (message.role === 'user') {
              const imageParts = imagePartsFrom(message.attachments);
              const hasFileFolder = (message.attachments ?? []).some(
                (a) => a.kind === 'file' || a.kind === 'folder',
              );
              if (hasFileFolder || message.selectedText) {
                const blocks: string[] = [];
                const attachmentContext = await buildAttachmentContext(message.attachments);
                if (attachmentContext) blocks.push(attachmentContext);
                if (message.selectedText) blocks.push(`[Selected text context]:\n${message.selectedText}`);
                blocks.push(`[User message]:\n${message.content}`);
                return {
                  role: 'user' as const,
                  content: [{ type: 'text', text: blocks.join('\n\n') }, ...imageParts],
                };
              }
              if (imageParts.length) {
                return {
                  role: 'user' as const,
                  content: [{ type: 'text', text: message.content }, ...imageParts],
                };
              }
              return { role: 'user' as const, content: message.content };
            }
            return { role: 'assistant' as const, content: message.content };
          }),
        );

        // --- AI tools agent loop (Phase 4) ---------------------------------
        // Enabled when the active model supports tools and a workspace folder
        // is connected. Runs the multi-turn agent loop with Ask & Approve or
        // Bypass permission mode from the thread.
        const activeModel = resolvedProvider.models?.find(
          (m) => m.id === resolvedProvider.selectedModel,
        );
        const toolsEnabled = (activeModel?.supportsTools ?? true) && !!getWorkspaceRoot();
        if (toolsEnabled) {
          const threadId = activeThread;
          const permissionMode =
            useChatStore.getState().threads.find((t) => t.id === threadId)?.permissionMode ??
            'ask';

          const aiMessages: AiChatMessage[] = [
            { role: 'system', content: basePrompt },
            ...historyWithContext,
          ];

          let loopContent = '';
          let loopUsage: MessageUsage | undefined;

          const addPendingBubble = async (call: ToolCall): Promise<boolean> => {
            const gate = createApprovalGate();
            registerApproval(call.id, gate);
            const bubble: AppChatMessage = {
              id: `tc-${call.id}`,
              threadId,
              mode,
              workspaceId: contextWorkspaceId || undefined,
              taskId: contextTaskId || undefined,
              settingsTab: contextSettingsTab || undefined,
              agentId: agent.id,
              role: 'tool_call',
              content: '',
              timestamp: Date.now(),
              toolCall: {
                toolCallId: call.id,
                name: call.name,
                args: JSON.stringify(call.args, null, 2),
                status: 'pending',
              },
            };
            await addMessage(bubble);
            return gate.promise;
          };

          const addCompletedBubble = (call: ToolCall): void => {
            void addMessage({
              id: `tc-${call.id}`,
              threadId,
              mode,
              workspaceId: contextWorkspaceId || undefined,
              taskId: contextTaskId || undefined,
              settingsTab: contextSettingsTab || undefined,
              agentId: agent.id,
              role: 'tool_call',
              content: '',
              timestamp: Date.now(),
              toolCall: {
                toolCallId: call.id,
                name: call.name,
                args: JSON.stringify(call.args, null, 2),
                status: 'done',
              },
            });
          };

          const updateBubble = (
            toolCallId: string,
            status: AppChatMessage['toolCall'] extends infer T ? (T extends { status: infer S } ? S : string) : string,
            summary?: string,
          ): void => {
            const existing = useChatStore
              .getState()
              .messagesByThread[threadId]?.find((m) => m.id === `tc-${toolCallId}`);
            const prev = existing?.toolCall;
            void updateMessage(`tc-${toolCallId}`, {
              toolCall: {
                toolCallId,
                name: prev?.name ?? '',
                args: prev?.args ?? '',
                status,
                resultSummary: summary,
              } as AppChatMessage['toolCall'],
            });
          };

          const result = await runAgentLoop(
            aiMessages,
            resolvedProvider as AIProviderConfig,
            (call, mode) =>
              dispatchToolCall(call, mode, {
                addPendingBubble,
                addCompletedBubble,
                updateBubble,
              }),
            {
              tools: AI_TOOLS,
              toolChoice: 'auto',
              permissionMode,
              signal,
              onChunk: (chunk) => {
                if (chunk.usage) {
                  loopUsage = chunk.usage;
                  return;
                }
                loopContent += chunk.content;
                const estimated = estimateTokens(loopContent);
                void updateMessage(assistantMessage.id, {
                  content: loopContent,
                  usage: { completionTokens: estimated },
                });
              },
            },
          );

          if (!signal.aborted) {
            await updateMessage(assistantMessage.id, {
              content: result.finalContent || loopContent,
              ...(loopUsage ? { usage: loopUsage } : {}),
            });
            if (result.hitCap) {
              await addMessage({
                id: `sys-${shortId()}`,
                threadId,
                mode,
                workspaceId: contextWorkspaceId || undefined,
                taskId: contextTaskId || undefined,
                settingsTab: contextSettingsTab || undefined,
                agentId: agent.id,
                role: 'system',
                content: '[agent-loop-cap-reached]',
                timestamp: Date.now(),
              });
            }
          }
          return;
        }
        // --- end AI tools agent loop ---------------------------------------

        const aiMessages: AiChatMessage[] = [
          { role: 'system', content: basePrompt },
          ...historyWithContext,
        ];

        const streamGen = streamChat(
          aiMessages,
          resolvedProvider as AIProviderConfig,
          signal,
        );

        let fullContent = '';
        let finalUsage: MessageUsage | undefined;
        for await (const chunk of streamGen) {
          fullContent += chunk.content;
          if (chunk.usage) {
            finalUsage = chunk.usage;
            continue;
          }
          const estimated = estimateTokens(fullContent);
          await updateMessage(assistantMessage.id, {
            content: fullContent,
            usage: { completionTokens: estimated },
          });
        }

        let suggestedText: string | undefined;
        if (selectedText) {
          const quoteMatch = fullContent.match(/[""\u201C]([^""\u201D]+)[""\u201D]/);
          const blockMatch = fullContent.match(/```[\s\S]*?```/);
          if (blockMatch) {
            suggestedText = blockMatch[0]
              .replace(/```\w*\n?/, '')
              .replace(/\n?```$/, '');
          } else if (quoteMatch) {
            suggestedText = quoteMatch[1];
          }
        }

        await updateMessage(assistantMessage.id, {
          content: fullContent,
          suggestedText,
          selectionFrom,
          selectionTo,
          ...(finalUsage ? { usage: finalUsage } : {}),
        });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : 'Unknown error';
        await updateMessage(assistantMessage.id, {
          content: `Error: ${message}`,
        });
      } finally {
        setStreamingMessageId(null);
        setIsStreaming(false);
      }
    },
    [
      addMessage,
      threadId,
      mode,
      contextWorkspaceId,
      contextTaskId,
      contextSettingsTab,
      getActiveAgent,
      getActiveProvider,
      getActiveThreadMessages,
      isTaskMode,
      systemInstructions,
      updateMessage,
      setIsStreaming,
      setStreamingMessageId,
      newChat,
      activeThreadId,
    ],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { sendMessage, stopStreaming };
}
