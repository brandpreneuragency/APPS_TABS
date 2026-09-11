import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Reply, X } from 'lucide-react';
import {
  ComposerCard,
  ComposerIconButton,
  ComposerLeft,
  ComposerRoot,
  ComposerRow,
  ComposerSendButton,
  ComposerTextarea,
} from '../ui/Composer';
import { AttachmentPreviewItem, AttachmentPreviewList } from '../ui/AttachmentPreview';
import type { AttachmentPreviewKind } from '../ui/AttachmentPreview';
import type { TaskComment } from '../../types';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { useTaskStore } from '../../stores/taskStore';
import { usePlaceholder } from '../../utils/placeholders';
import { getFileCategory, isImageFile } from '../../utils/fileType';
import { generateVideoThumbnailDataUrl } from '../../utils/fileData';

/** Max height for the comment box, expressed as 50vw in pixels. */
function maxHeightVw(): number {
  return Math.round(window.innerWidth * 0.5);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  file: File;
  mimeType: string;
  kind: AttachmentPreviewKind;
  /** Object URL for image previews; revoked on remove/unmount. */
  previewUrl?: string;
}

function nextAttachmentId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function classifyPendingFile(file: File): AttachmentPreviewKind {
  const mime = file.type || '';
  if (mime.startsWith('image/') || isImageFile(file.name)) return 'image';
  if (mime.startsWith('video/') || getFileCategory(file.name, mime) === 'video') return 'video';
  return 'file';
}

interface TaskCommentInputProps {
  replyToComment?: TaskComment | null;
  onClearReply?: () => void;
}

export function TaskCommentInput({ replyToComment, onClearReply }: TaskCommentInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const { addComment } = useTaskCommentStore();
  const { activeTaskId, updateTask } = useTaskStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userHeightRef = useRef<number>(0);
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Revoke object URLs when the composer unmounts.
  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(att.previewUrl);
      }
    };
  }, []);
  const accentColor = 'var(--c-accent-2)';
  const transmitPlaceholder = usePlaceholder('transmitMessage');

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = maxHeightVw();
    const base = Math.max(ta.scrollHeight, userHeightRef.current || 0);
    ta.style.height = `${Math.min(Math.max(base, 42), max)}px`;
  }, [activeTaskId]);

  const handleInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = maxHeightVw();
    const base = Math.max(ta.scrollHeight, userHeightRef.current || 0);
    ta.style.height = `${Math.min(Math.max(base, 42), max)}px`;
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
      // Dragging the handle up (negative delta) grows the box upward.
      const next = Math.min(Math.max(startHeight - (ev.clientY - startY), 42), max);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const pending: PendingAttachment[] = files.map((file) => {
      const kind = classifyPendingFile(file);
      const mimeType = file.type || 'application/octet-stream';
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
      return {
        id: nextAttachmentId(),
        name: file.name,
        size: file.size,
        file,
        mimeType,
        kind,
        previewUrl,
      };
    });

    setAttachments((prev) => [...prev, ...pending]);

    // Async video posters — update matching pending items when ready.
    for (const att of pending) {
      if (att.kind !== 'video') continue;
      void generateVideoThumbnailDataUrl(att.file).then((thumb) => {
        if (!thumb) return;
        setAttachments((prev) =>
          prev.map((p) => (p.id === att.id ? { ...p, previewUrl: thumb } : p)),
        );
      });
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const target = prev[index];
      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSend = async () => {
    if (!activeTaskId || sending) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    const replyData = replyToComment
      ? {
          id: replyToComment.id,
          text: replyToComment.text.slice(0, 200),
          sender: 'You',
        }
      : undefined;

    setSending(true);
    setProgress(0);

    const snapshot = attachments;
    const totalItems = (trimmed ? 1 : 0) + snapshot.length;
    let completedItems = 0;
    const baseTime = Date.now();
    let failedAttachments: PendingAttachment[] = [];
    let sentAny = false;

    const revokeIfBlob = (att: PendingAttachment) => {
      if (att.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(att.previewUrl);
    };

    try {
      if (trimmed) {
        const textResult = await addComment(
          activeTaskId,
          {
            text: trimmed,
            sender: 'You',
            replyTo: replyData,
            createdAt: baseTime,
          },
          undefined,
          {
            onProgress: (loaded, total) => {
              if (total > 0) {
                setProgress((completedItems + loaded / total) / totalItems);
              }
            },
          },
        );
        if (!textResult.comment) {
          failedAttachments = snapshot;
          return;
        }
        sentAny = true;
        completedItems += 1;
      }

      for (let i = 0; i < snapshot.length; i++) {
        const result = await addComment(
          activeTaskId,
          {
            text: '',
            sender: 'You',
            replyTo: replyData,
            createdAt: baseTime + completedItems,
          },
          snapshot[i].file,
          {
            onProgress: (loaded, total) => {
              if (total > 0) {
                setProgress((completedItems + loaded / total) / totalItems);
              }
            },
          },
        );
        if (!result.comment) {
          failedAttachments = snapshot.slice(i);
          return;
        }
        sentAny = true;
        completedItems += 1;
      }

      failedAttachments = [];
      if (sentAny) {
        // Bump the parent task's updatedAt to reflect new activity.
        void updateTask(activeTaskId, {});
      }
    } finally {
      setSending(false);
      setProgress(0);
      // Clear only the parts that were successfully sent; keep any failed
      // attachments (and the text if nothing was sent) so the user can retry.
      if (sentAny) {
        const failedIds = new Set(failedAttachments.map((a) => a.id));
        for (const att of snapshot) {
          if (!failedIds.has(att.id)) revokeIfBlob(att);
        }
        setText('');
        setAttachments(failedAttachments);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        if (failedAttachments.length === 0) {
          onClearReply?.();
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
      } else {
        setAttachments(failedAttachments);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!activeTaskId) return null;

  const sendDisabled = sending || (!text.trim() && attachments.length === 0);
  const showProgress = sending && attachments.length > 0 && progress > 0 && progress < 1;

  return (
    <ComposerRoot id="task-comment-input" className="composer-root--clear">
      <ComposerCard id="task-comment-card">
        <div
          className="composer-resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag up to expand"
        />
        {replyToComment && (
          <div style={{ marginBottom: 4, marginLeft: 0, marginRight: 0, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 6, padding: '4px 8px', fontSize: 'var(--fs-sm)', border: '1px solid var(--c-border-1)' }}>
            <Reply size={11} style={{ color: accentColor, flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, flex: 1, overflow: 'hidden' }}>
              <div style={{ width: 2, borderRadius: 1, background: accentColor, flexShrink: 0 }} />
              <div style={{ overflow: 'hidden', minWidth: 0 }}>
                <div className="semibold" style={{ fontSize: 'var(--fs-sm)', color: accentColor, marginBottom: 1 }}>
                  You
                </div>
                <div className="subtle trunc" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {replyToComment.text.slice(0, 120)}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClearReply}
              className="btn-icon shrink-0"
              title="Cancel reply"
              style={{ width: 'var(--control-height-sm)', height: 'var(--control-height-sm)', paddingRight: '0px' }}
            >
              <X size={9} />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <AttachmentPreviewList
            footer={
              showProgress ? (
                <span className="composer-attachment-progress">
                  {Math.round(progress * 100)}%
                </span>
              ) : undefined
            }
          >
            {attachments.map((att, index) => (
              <AttachmentPreviewItem
                key={att.id}
                item={{
                  name: att.name,
                  kind: att.kind,
                  mimeType: att.mimeType,
                  previewUrl: att.previewUrl,
                  dataUrl: att.previewUrl,
                  sizeLabel: formatSize(att.size),
                }}
                onRemove={sending ? undefined : () => removeAttachment(index)}
                removeTitle="Remove attachment"
              />
            ))}
          </AttachmentPreviewList>
        )}

        <ComposerTextarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={sending ? 'Uploading...' : transmitPlaceholder}
          title="Message input"
          rows={1}
          disabled={sending}
        />

        <ComposerRow className="task-comment-bottom-row" style={{ height: 'fit-content' }}>
          <ComposerLeft className="task-comment-bottom-col task-comment-bottom-col--left" style={{ height: 'fit-content' }}>
            <ComposerIconButton
              onClick={() => fileInputRef.current?.click()}
              className="composer-attach-button"
              title="Attach file"
              disabled={sending}
            >
              <Plus size={14} />
            </ComposerIconButton>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              title="Attach files"
              className="comment-file-input"
              onChange={handleFileSelect}
            />
          </ComposerLeft>
          <div className="task-comment-bottom-col task-comment-bottom-col--send">
            {sending ? (
              <button
                type="button"
                className="composer-send-btn"
                title="Sending"
                disabled
                aria-label="Sending"
              >
                <Loader2 size={14} className="spin" />
              </button>
            ) : (
              <ComposerSendButton onClick={handleSend} disabled={sendDisabled} title="Send message" />
            )}
          </div>
        </ComposerRow>
      </ComposerCard>
    </ComposerRoot>
  );
}
