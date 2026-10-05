import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chatStore';
import { useCodexService } from '../../services/codex/useCodexService';
import { useCliProviderService } from '../../services/providers/useCliProviderService';
import { useMockProviderService } from '../../services/providers/useMockProviderService';
import { isMockProviderId } from '../../services/providers/mockProviders';
import { MockChatShowcase } from './MockChatShowcase';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ToolCallBubble } from './ToolCallBubble';
import type { ChatMessage } from '../../types';

interface ChatThreadProps {
  workspaceId: string | null;
  taskId?: string | null;
  editor: Editor | null;
  onReplyMessage?: (msg: ChatMessage) => void;
}

export function ChatThread({ taskId, editor, onReplyMessage }: ChatThreadProps) {
  const { t } = useTranslation();
  const { getActiveThreadMessages, activeThreadId, threads } = useChatStore();
  const codex = useCodexService();
  const cliRun = useCliProviderService();
  const mockRun = useMockProviderService();
  const messages = getActiveThreadMessages();
  const codexStreaming = Boolean(codex.activeRunId && codex.activeAppThreadId === activeThreadId);
  const cliStreaming = Boolean(cliRun && cliRun.appThreadId === activeThreadId);
  const mockStreaming = Boolean(mockRun && mockRun.appThreadId === activeThreadId);
  const isStreaming = codexStreaming || cliStreaming || mockStreaming;
  const streamingMessageId = codexStreaming
    ? [...messages].reverse().find((message) => message.role === 'assistant'
      && message.id.startsWith(`codex:assistant:${codex.activeRunId}:`))?.id
    : cliStreaming ? `cli:assistant:${cliRun?.runId}`
      : mockStreaming ? `mock:assistant:${mockRun?.runId}` : undefined;
  const activeOrigin = threads.find((thread) => thread.id === activeThreadId)?.origin;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current || !bottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    if (activeThreadId && isMockProviderId(activeOrigin)) {
      return <MockChatShowcase threadId={activeThreadId} />;
    }
    return (
      <div
        id="chat-empty-state"
        className="flex flex-1 h-full"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 15px',
          verticalAlign: 'middle',
          fontSize: 'var(--fs-sm)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-full)', background: 'var(--c-background-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <span style={{ color: 'var(--c-accent-center-panel)', fontSize: 'var(--font-fluid-12)' }}>✦</span>
          </div>
          <p className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>
            {taskId ? 'Ask about this task...' : t('chat.startConversation')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div id="scroll-ai" ref={scrollRef} className="ai-scroll flex-1 overflow-y-a flex flex-col" style={{ gap: 16 }}>
      {messages.map((msg) => (
        msg.role === 'tool_call' ? (
          <ToolCallBubble
            key={msg.id}
            message={msg}
          />
        ) : msg.role === 'user' ? (
          <UserMessage key={msg.id} message={msg} onReplyMessage={onReplyMessage} />
        ) : (
          <AssistantMessage
            key={msg.id}
            message={msg}
            isStreaming={msg.id === streamingMessageId}
            editor={editor}
            onReplyMessage={onReplyMessage}
          />
        )
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
