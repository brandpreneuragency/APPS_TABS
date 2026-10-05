import { useRef, useEffect, useCallback, useState } from 'react';
import { Square, Clock, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ComposerRoot,
  ComposerCard,
  ComposerRow,
  ComposerTextarea,
  ComposerSendButton,
  ComposerIconButton,
} from '../ui/Composer';
import { formatRelativeTime } from '../../utils/timeFormat';
import type {
  StandaloneAiChatPanelProps,
  AiChatPanelMessage,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Markdown renderer (matches sidebar AssistantMessage style)                 */
/* -------------------------------------------------------------------------- */

const mdStyles = {
  p: { marginBottom: 12, fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)', lineHeight: 1.625 },
  h1: { fontSize: 26, fontWeight: 700, marginBottom: 14, color: 'var(--c-text-1)', lineHeight: 1.2 },
  h2: { fontSize: 22, fontWeight: 700, marginBottom: 13, color: 'var(--c-text-1)', lineHeight: 1.3 },
  h3: { fontSize: 18, fontWeight: 600, marginBottom: 12, color: 'var(--c-text-1)', lineHeight: 1.35 },
  h4: { fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 12, color: 'var(--c-text-2)' },
  ul: { listStyle: 'disc', paddingLeft: 16, marginBottom: 8, fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)' },
  ol: { listStyle: 'decimal', paddingLeft: 16, marginBottom: 8, fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)' },
  li: { lineHeight: 1.625 },
  strong: { fontWeight: 600, color: 'var(--c-text-1)' },
  em: { fontStyle: 'italic' },
  blockquote: { borderLeft: '2px solid var(--c-border-1)', paddingLeft: 12, fontStyle: 'italic', color: 'var(--c-text-2)', marginBottom: 8, fontSize: 'var(--fs-sm)' },
  pre: { background: '#111827', color: '#f3f4f6', borderRadius: 'var(--radius-sm)', padding: 12, overflowX: 'auto', fontSize: 'var(--fs-sm)', fontFamily: 'var(--c-font-1)', marginBottom: 8, lineHeight: 1.625, whiteSpace: 'pre' as const },
  inlineCode: { background: 'var(--c-background-4)', borderRadius: 'var(--radius-sm)', padding: '1px 4px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--c-font-1)', color: '#e11d48' },
  codeBlock: { fontFamily: 'var(--c-font-1)', fontSize: 'var(--fs-sm)' },
  table: { width: '100%', fontSize: 'var(--fs-sm)', borderCollapse: 'collapse' as const },
  thead: { background: 'var(--c-background-4)' },
  th: { border: '1px solid var(--c-border-1)', padding: '6px 12px', textAlign: 'left' as const, fontWeight: 600, color: 'var(--c-text-1)' },
  td: { border: '1px solid var(--c-border-1)', padding: '6px 12px', color: 'var(--c-text-1)' },
  a: { color: 'var(--c-accent-center-panel)', textDecoration: 'underline' },
  hr: { borderColor: 'var(--c-border-1)', margin: '12px 0' },
} as const;

function MdContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: c }) => <p style={mdStyles.p}>{c}</p>,
        h1: ({ children: c }) => <h1 style={mdStyles.h1}>{c}</h1>,
        h2: ({ children: c }) => <h2 style={mdStyles.h2}>{c}</h2>,
        h3: ({ children: c }) => <h3 style={mdStyles.h3}>{c}</h3>,
        h4: ({ children: c }) => <h4 style={mdStyles.h4}>{c}</h4>,
        ul: ({ children: c }) => <ul style={mdStyles.ul}>{c}</ul>,
        ol: ({ children: c }) => <ol style={mdStyles.ol}>{c}</ol>,
        li: ({ children: c }) => <li style={mdStyles.li}>{c}</li>,
        strong: ({ children: c }) => <strong style={mdStyles.strong}>{c}</strong>,
        em: ({ children: c }) => <em style={mdStyles.em}>{c}</em>,
        blockquote: ({ children: c }) => (
          <blockquote style={mdStyles.blockquote}>{c}</blockquote>
        ),
        pre: ({ children: c }) => (
          <pre style={mdStyles.pre}>{c}</pre>
        ),
        code: ({ children: c, className, ...props }: React.HTMLAttributes<HTMLElement> & { node?: { position?: { start: { line: number }; end: { line: number } } } }) => {
          const isBlock = /language-/.test(className || '');
          return isBlock
            ? <code style={mdStyles.codeBlock} className={className} {...props}>{c}</code>
            : <code style={mdStyles.inlineCode}>{c}</code>;
        },
        table: ({ children: c }) => (
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={mdStyles.table}>{c}</table>
          </div>
        ),
        thead: ({ children: c }) => <thead style={mdStyles.thead}>{c}</thead>,
        th: ({ children: c }) => <th style={mdStyles.th}>{c}</th>,
        td: ({ children: c }) => <td style={mdStyles.td}>{c}</td>,
        a: ({ href, children: c }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={mdStyles.a}>{c}</a>
        ),
        hr: () => <hr style={mdStyles.hr} />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

/* -------------------------------------------------------------------------- */
/*  Timestamp helper                                                          */
/* -------------------------------------------------------------------------- */

function formatCreatedAt(createdAt?: string | Date): string {
  if (!createdAt) return '';
  if (typeof createdAt === 'string') {
    const ts = Date.parse(createdAt);
    return Number.isNaN(ts) ? createdAt : formatRelativeTime(ts);
  }
  return formatRelativeTime(createdAt.getTime());
}

/* -------------------------------------------------------------------------- */
/*  Panel-level empty state                                                   */
/* -------------------------------------------------------------------------- */

function PanelEmptyState() {
  return (
    <div className="chat-empty-state">
      <div className="chat-empty-state-icon">
        <Clock size={32} />
      </div>
      <p className="chat-empty-state-title">Start a conversation</p>
      <p className="chat-empty-state-subtitle subtle">
        Send a message to begin chatting.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Internal message subcomponents (store-free, visually matched)             */
/* -------------------------------------------------------------------------- */

function StandaloneUserMessage({ message }: { message: AiChatPanelMessage }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
      <div
        className="user-message-bubble"
        style={{
          border: '1px solid var(--layout-border)',
          background: 'var(--right-bg)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 16px',
          fontSize: 'var(--fs-sm)',
          wordBreak: 'break-word',
          overflow: 'hidden',
          alignSelf: 'flex-end',
          maxWidth: '85%',
        }}
      >
        {message.content}
      </div>
      {message.createdAt && (
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)', textAlign: 'right', paddingRight: 4 }}>
          {formatCreatedAt(message.createdAt)}
        </div>
      )}
    </div>
  );
}

function StandaloneAssistantMessage({ message, isStreaming }: { message: AiChatPanelMessage; isStreaming?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
      {message.error && (
        <div style={{
          padding: '8px 12px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--c-border-1)',
          background: 'var(--c-background-4)',
          fontSize: 'var(--fs-sm)',
          color: '#e53e3e',
        }}>
          {message.error}
        </div>
      )}

      <div style={{ padding: '4px 0', wordBreak: 'break-word', overflow: 'hidden' }}>
        {isStreaming && !message.content && (
          <p className="streaming-cursor" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)' }}>
            {'\u200B'}
          </p>
        )}
        {message.content && (
          <div className={isStreaming ? 'streaming-cursor' : ''}>
            <MdContent>{message.content}</MdContent>
          </div>
        )}
      </div>

      {!isStreaming && message.content && (
        <div className="row gap-3" style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--c-border-1)' }}>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy'}
            className="btn-icon"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      )}

      {message.createdAt && (
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)', paddingLeft: 4 }}>
          {formatCreatedAt(message.createdAt)}
        </div>
      )}
    </div>
  );
}

function StandaloneSystemMessage({ message }: { message: AiChatPanelMessage }) {
  return (
    <div style={{
      padding: '6px 12px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--c-background-4)',
      fontSize: 'var(--fs-sm)',
      color: 'var(--c-text-2)',
      textAlign: 'center',
      maxWidth: '80%',
      alignSelf: 'center',
    }}>
      {message.content}
    </div>
  );
}

function PendingMessage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p className="streaming-cursor" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)' }}>
        {'\u200B'}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

const MAX_HEIGHT = 192;

export function StandaloneAiChatPanel({
  title,
  subtitle,
  messages,
  inputValue,
  onInputChange,
  onSend,
  onStop,
  isSending = false,
  isDisabled = false,
  error,
  placeholder = 'Type a message...',
  modelLabel,
  profileLabel,
  headerActions,
  className,
}: StandaloneAiChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onInputChange(val);

    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = '32px';
      ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 32), MAX_HEIGHT)}px`;
    }
  }, [onInputChange]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending || isDisabled) return;
    onSend(trimmed);
  }, [inputValue, isSending, isDisabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-scroll
  useEffect(() => {
    if (!scrollRef.current || !bottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, isSending]);

  const canSend = inputValue.trim().length > 0 && !isSending && !isDisabled;
  const hasMessages = messages.length > 0;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--c-background-1)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--c-border-1)',
        flexShrink: 0,
        minHeight: 40,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span className="semibold" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {subtitle && (
            <span className="subtle" style={{ fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </span>
          )}
        </div>
        {(modelLabel || profileLabel) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, flexShrink: 0 }}>
            {modelLabel && (
              <span className="subtle" style={{ fontSize: 'var(--fs-sm)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {modelLabel}
              </span>
            )}
            {profileLabel && (
              <span className="subtle" style={{ fontSize: 'var(--fs-sm)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profileLabel}
              </span>
            )}
          </div>
        )}
        {headerActions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, flexShrink: 0 }}>
            {headerActions}
          </div>
        )}
      </div>

      {/* Message area */}
      {!hasMessages ? (
        <PanelEmptyState />
      ) : (
        <div ref={scrollRef} className="ai-scroll flex-1 overflow-y-a flex flex-col" style={{ gap: 16, padding: '12px' }}>
          {messages.map((msg) => {
            switch (msg.role) {
              case 'user':
                return <StandaloneUserMessage key={msg.id} message={msg} />;
              case 'assistant':
                return (
                  <StandaloneAssistantMessage
                    key={msg.id}
                    message={msg}
                    isStreaming={msg.isPending}
                  />
                );
              case 'system':
                return <StandaloneSystemMessage key={msg.id} message={msg} />;
              default:
                return null;
            }
          })}
          {isSending && !messages.some((m) => m.isPending) && <PendingMessage />}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Panel-level error */}
      {error && (
        <div style={{
          padding: '6px 12px',
          fontSize: 'var(--fs-sm)',
          color: '#e53e3e',
          background: 'var(--c-background-4)',
          borderTop: '1px solid var(--c-border-1)',
          flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* Composer */}
      <ComposerRoot id="standalone-chat-input-root" className="shrink-0">
        <ComposerCard>
          <ComposerRow className="chat-input-text-row">
            <ComposerTextarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={isDisabled}
            />
          </ComposerRow>
          <div className="chat-input-bottom-row">
            <div className="chat-input-bottom-col chat-input-bottom-col--send">
              {isSending && onStop ? (
                <ComposerIconButton
                  onClick={onStop}
                  className="shrink-0"
                  title="Stop"
                >
                  <Square size={12} fill="currentColor" style={{ color: 'var(--c-text-2)' }} />
                </ComposerIconButton>
              ) : (
                <ComposerSendButton onClick={handleSend} disabled={!canSend} title="Send" />
              )}
            </div>
          </div>
        </ComposerCard>
      </ComposerRoot>
    </div>
  );
}
