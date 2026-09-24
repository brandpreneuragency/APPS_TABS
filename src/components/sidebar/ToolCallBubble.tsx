import { useState } from 'react';
import { Check, X, Shield, Zap, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../types';
import './toolCallBubble.css';

interface ToolCallBubbleProps {
  message: ChatMessage;
  /** Called when the user approves a pending call (ask mode). */
  onApprove?: (id: string) => void;
  /** Called when the user rejects a pending call (ask mode). */
  onReject?: (id: string) => void;
}

const MAX_PRETTY_LINES = 6;

function ToolIcon({ name }: { name: string }) {
  if (name === 'shell_exec') return <Terminal size={14} />;
  return <span className="tool-call-bubble__fallback-icon">⚙</span>;
}

export function ToolCallBubble({ message, onApprove, onReject }: ToolCallBubbleProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const tc = message.toolCall;
  if (!tc) return null;

  const argsLines = (tc.args || '').split('\n');
  const showToggle = argsLines.length > MAX_PRETTY_LINES;
  const visibleArgs = expanded ? tc.args : argsLines.slice(0, MAX_PRETTY_LINES).join('\n');

  const pending = tc.status === 'pending';
  const done = tc.status === 'done' || tc.status === 'approved';

  return (
    <div className="tool-call-bubble">
      <div className="tool-call-bubble__header">
        <span className="tool-call-bubble__icon">
          <ToolIcon name={tc.name} />
        </span>
        <span className="tool-call-bubble__name">{tc.name}</span>
        {tc.status === 'pending' && (
          <span className="tool-call-bubble__status">
            <Shield size={11} /> {t('chat.tools.awaitingApproval')}
          </span>
        )}
        {tc.status === 'done' && (
          <span className="tool-call-bubble__status">
            <Zap size={11} /> {t('chat.tools.executed')}
          </span>
        )}
        {tc.status === 'rejected' && (
          <span className="tool-call-bubble__status">{t('chat.tools.rejected')}</span>
        )}
      </div>

      <pre
        className={
          expanded
            ? 'tool-call-bubble__args tool-call-bubble__args--expanded'
            : 'tool-call-bubble__args'
        }
      >
        {visibleArgs || '{}'}
      </pre>
      {showToggle && (
        <button
          type="button"
          className="tool-call-bubble__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('chat.tools.showLess') : t('chat.tools.showMore')}
        </button>
      )}

      {done && tc.resultSummary && (
        <div className="tool-call-bubble__summary">{tc.resultSummary}</div>
      )}

      {pending && onApprove && onReject && (
        <div className="tool-call-bubble__actions">
          <button
            type="button"
            className="tool-call-bubble__btn tool-call-bubble__btn--approve"
            onClick={() => onApprove?.(message.id)}
          >
            <Check size={13} /> {t('chat.tools.approve')}
          </button>
          <button
            type="button"
            className="tool-call-bubble__btn tool-call-bubble__btn--reject"
            onClick={() => onReject?.(message.id)}
          >
            <X size={13} /> {t('chat.tools.reject')}
          </button>
        </div>
      )}
      {pending && (!onApprove || !onReject) && (
        <div className="tool-call-bubble__summary">{t('chat.tools.legacyUnavailable')}</div>
      )}
    </div>
  );
}
