import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ComposerCard,
  ComposerIconButton,
  ComposerLeft,
  ComposerRoot,
  ComposerRow,
  ComposerSendButton,
  ComposerTextarea,
} from '../../ui/Composer';

function maxHeightVw(): number {
  return Math.round(window.innerWidth * 0.5);
}

interface CRMNoteInputProps {
  /** Called when the user submits a non-empty note. */
  onSubmit: (body: string) => void | Promise<void>;
  placeholder?: string;
  /** Disabled state (e.g. while sending). */
  busy?: boolean;
}

/**
 * Bottom note composer — structural/visual match for TaskCommentInput
 * inside `.tdp-comment-footer.panel-footer`.
 */
export function CRMNoteInput({ onSubmit, placeholder = 'Add a note…', busy }: CRMNoteInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userHeightRef = useRef<number>(0);

  const handleInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = maxHeightVw();
    const base = Math.max(ta.scrollHeight, userHeightRef.current || 0);
    ta.style.height = `${Math.min(Math.max(base, 44), max)}px`;
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ta = textareaRef.current;
    if (!ta) return;
    const startY = e.clientY;
    const startHeight = ta.offsetHeight;
    const max = maxHeightVw();

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(Math.max(startHeight - (ev.clientY - startY), 44), max);
      userHeightRef.current = next;
      ta.style.height = `${next}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    try {
      await onSubmit(trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      userHeightRef.current = 0;
    } catch {
      // Keep the text so the user can retry; the store surfaces the toast.
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const sendDisabled = busy || !text.trim();

  return (
    <ComposerRoot id="crm-note-input" className="composer-root--clear">
      <ComposerCard id="crm-note-card">
        <div
          className="composer-resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag up to expand"
        />
        <ComposerTextarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          title="Note input"
          rows={1}
          disabled={busy}
        />
        <ComposerRow className="task-comment-bottom-row" style={{ height: 'fit-content' }}>
          <ComposerLeft className="task-comment-bottom-col task-comment-bottom-col--left" style={{ height: 'fit-content' }}>
            <ComposerIconButton
              onClick={() => fileInputRef.current?.click()}
              className="composer-attach-button"
              title="Attach file"
              disabled={busy}
            >
              <Plus />
            </ComposerIconButton>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} />
          </ComposerLeft>
          <div className="task-comment-bottom-col task-comment-bottom-col--send">
            <ComposerSendButton onClick={() => void handleSend()} disabled={sendDisabled} title="Save note" />
          </div>
        </ComposerRow>
      </ComposerCard>
    </ComposerRoot>
  );
}
