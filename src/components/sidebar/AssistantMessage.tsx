import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, PenLine } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../types';
import type { Editor } from '@tiptap/react';
import { formatRelativeTime } from '../../utils/timeFormat';
import { ChatBubbleContextMenu } from './ChatBubbleContextMenu';
import { useChatStore } from '../../stores/chatStore';
import { TaskDraftPreview } from './TaskDraftPreview';

interface AssistantMessageProps {
  message: ChatMessage;
  isStreaming?: boolean;
  editor: Editor | null;
  onReplyMessage?: (msg: ChatMessage) => void;
}

// ---------------------------------------------------------------------------
// Thinking-tag parser: splits <think>...</think> from the actual answer.
// While the model is still streaming the reasoning phase the closing tag has
// not arrived yet, so we return the partial reasoning with thinkingDone=false.
// ---------------------------------------------------------------------------
const THINK_CLOSE = '</think>';

function parseThinking(raw: string) {
  const openMatch = raw.match(/^\s*<think>/i);
  if (!openMatch) return { thinking: null, thinkingDone: true, content: raw };
  const afterOpen = raw.slice(openMatch[0].length);
  const closeIdx = afterOpen.toLowerCase().indexOf(THINK_CLOSE);
  if (closeIdx === -1) return { thinking: afterOpen, thinkingDone: false, content: '' };
  return {
    thinking: afterOpen.slice(0, closeIdx).trim(),
    thinkingDone: true,
    content: afterOpen.slice(closeIdx + THINK_CLOSE.length).trim(),
  };
}

// ---------------------------------------------------------------------------
// Split markdown into a preamble + collapsible H3 sections
// ---------------------------------------------------------------------------
type Part =
  | { type: 'preamble'; content: string }
  | { type: 'section'; heading: string; content: string };

function splitAtH3(md: string): Part[] {
  const lines = md.split('\n');
  const parts: Part[] = [];
  let buffer: string[] = [];
  let heading: string | null = null;

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (heading !== null) {
      parts.push({ type: 'section', heading, content });
    } else if (content) {
      parts.push({ type: 'preamble', content });
    }
    buffer = [];
    heading = null;
  };

  for (const line of lines) {
    const m = line.match(/^### (.+)/);
    if (m) { flush(); heading = m[1]; }
    else buffer.push(line);
  }
  flush();
  return parts;
}

// ---------------------------------------------------------------------------
// Shared markdown renderer
// ---------------------------------------------------------------------------
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
  pre: { background: '#111827', color: '#f3f4f6', borderRadius: 'var(--radius-sm)', padding: 12, overflowX: 'auto', fontSize: 'var(--fs-sm)', fontFamily: 'var(--c-font-1)', marginBottom: 8, lineHeight: 1.625, whiteSpace: 'pre' },
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
        code: ({ node, children: c, className, ...props }: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          const isBlock = /language-/.test(className || '') ||
            (node?.position && node.position.end.line > node.position.start.line);
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

// ---------------------------------------------------------------------------
// Collapsible reasoning box
// ---------------------------------------------------------------------------
function ReasoningBox({ content, streaming }: { content: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, borderRadius: 'var(--radius-sm)', border: '1px solid var(--c-border-1)', background: 'var(--c-background-4)', overflow: 'hidden', fontSize: 'var(--fs-sm)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', textAlign: 'left', color: 'var(--c-text-2)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-background-4)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span className="med">{streaming ? 'Reasoning…' : 'Reasoning'}</span>
        <ChevronDown size={12} style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div className="subtle" style={{ padding: '4px 12px 12px 12px', whiteSpace: 'pre-wrap', borderTop: '1px solid var(--c-border-1)', lineHeight: 1.625, maxHeight: 256, overflowY: 'auto' }}>
          {content}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible H3 section
// ---------------------------------------------------------------------------
function SectionBlock({ heading, content, defaultOpen }: { heading: string; content: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--c-border-1)', borderRadius: 'var(--radius-sm)', marginBottom: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full row gap-2" style={{ padding: '10px 12px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-background-4)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <ChevronRight
          size={13}
          className="shrink-0" style={{ color: 'var(--c-info)', transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : undefined }}
        />
        <span className="semibold" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)' }}>{heading}</span>
      </button>
      {open && content && (
        <div style={{ padding: '4px 12px 12px 12px', borderTop: '1px solid var(--c-border-1)' }}>
          <MdContent>{content}</MdContent>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AssistantMessage({ message, isStreaming, editor, onReplyMessage }: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const { thinking, thinkingDone, content } = parseThinking(message.content);
  const parts = splitAtH3(content);
  const hasSections = parts.some((p) => p.type === 'section');

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDelete = () => {
    deleteMessage(message.id);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content || message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyChange = () => {
    if (!editor || !message.suggestedText) return;
    const { selectionFrom: from, selectionTo: to } = message;
    if (from !== undefined && to !== undefined) {
      editor.chain().focus().setTextSelection({ from, to }).insertContent(message.suggestedText).run();
    } else {
      editor.chain().focus().insertContent(message.suggestedText).run();
    }
  };

  const scrollToMessage = (id: string) => {
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div data-message-id={message.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
      {/* Reply quote bar */}
      {message.replyTo && (
        <div
          onClick={() => scrollToMessage(message.replyTo!.id)}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 8,
            background: 'var(--c-background-4)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: 'var(--fs-sm)',
            border: '1px solid var(--c-border-1)',
            maxWidth: '80%',
            cursor: 'pointer',
          }}
        >
          <div style={{ width: 3, borderRadius: 'var(--radius-sm)', background: 'var(--c-accent-center-panel)', flexShrink: 0 }} />
          <div style={{ overflow: 'hidden', minWidth: 0 }}>
            <div className="semibold" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-accent-center-panel)', marginBottom: 2 }}>
              {message.replyTo.sender}
            </div>
            <div className="subtle trunc" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {message.replyTo.content}
            </div>
          </div>
        </div>
      )}

      {/* Reasoning box */}
      {thinking && (
        <ReasoningBox content={thinking} streaming={!thinkingDone} />
      )}

      {/* Content */}
      <div onContextMenu={handleContextMenu} style={{ wordBreak: 'break-word', overflow: 'hidden', cursor: 'context-menu' }}>
        {/* Still inside the <think> block — show spinner/placeholder */}
        {isStreaming && !content && (
          <p className={thinking ? undefined : 'streaming-cursor'} style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)', opacity: thinking ? 0.5 : undefined }}>
            {thinking ? 'Thinking…' : ''}
          </p>
        )}

        {/* Rendered answer */}
        {content && (
          <div
            className={isStreaming && !hasSections ? 'streaming-cursor' : ''}
          >
            {hasSections ? (
              <>
                {parts.map((part, i) =>
                  part.type === 'preamble' ? (
                    <div key={i}><MdContent>{part.content}</MdContent></div>
                  ) : (
                    <SectionBlock
                      key={i}
                      heading={part.heading}
                      content={part.content}
                      defaultOpen={isStreaming ?? false}
                    />
                  )
                )}
              </>
            ) : (
              <MdContent>{content}</MdContent>
            )}
          </div>
        )}

        {/* Action row */}
        {!isStreaming && (content || message.content) && (
          <div className="row gap-3" style={{ marginTop: 12, paddingTop: 8 }}>
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? 'Copied!' : 'Copy'}
              className="btn-icon"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            {message.suggestedText && (
              <button
                type="button"
                onClick={handleApplyChange}
                title="Apply suggestion to editor"
                className="btn-icon"
              >
                <PenLine size={13} />
              </button>
            )}
          </div>
        )}

        {message.taskDraft && (
          <TaskDraftPreview
            messageId={message.id}
            draft={message.taskDraft}
            status={message.taskDraftStatus ?? 'draft'}
          />
        )}
      </div>

      <div className="subtle" style={{ fontSize: 'var(--fs-sm)', paddingLeft: 4 }}>
        {formatRelativeTime(message.timestamp)}
      </div>

      {contextMenu && (
        <ChatBubbleContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onReply={() => onReplyMessage?.(message)}
          onDelete={handleDelete}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
