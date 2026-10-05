import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { TaskComment, FileViewerItem } from '../../types';
import { Reply, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLongPress } from '../../hooks/useLongPress';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { useUIStore } from '../../stores/uiStore';
import { getFileCategory, inferMimeTypeFromDataUrl, synthesizeAttachmentName } from '../../utils/fileType';
import { AttachmentPreviewItem, AttachmentPreviewList } from '../ui/AttachmentPreview';
import type { AttachmentPreviewKind } from '../ui/AttachmentPreview';

interface TaskCommentThreadProps {
  comments: TaskComment[];
  onReplyComment?: (comment: TaskComment) => void;
}

const DELETE_WINDOW_MS = 5 * 60 * 1000;

function formatAttachmentSize(bytes?: number): string | undefined {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCommentAttachmentFile(comment: TaskComment): FileViewerItem | null {
  if (!comment.attachmentDataUrl) return null;

  const mimeType = comment.attachmentMimeType || inferMimeTypeFromDataUrl(comment.attachmentDataUrl);
  return {
    name: synthesizeAttachmentName(comment.attachmentName, mimeType),
    dataUrl: comment.attachmentDataUrl,
    mimeType,
    size: formatAttachmentSize(comment.attachmentSizeBytes),
    source: 'task-comment',
    sourceId: comment.id,
  };
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today ${time}`;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ` ${time}`;
}

function canDeleteComment(comment: TaskComment): boolean {
  return Date.now() - comment.createdAt < DELETE_WINDOW_MS;
}

function CommentContextMenu({
  x,
  y,
  comment,
  onReply,
  onDelete,
  onClose,
  onSendToAI,
}: {
  x: number;
  y: number;
  comment: TaskComment;
  onReply: () => void;
  onSendToAI: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const deletable = canDeleteComment(comment);
  const hasText = comment.text.trim().length > 0;
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 192;
  const menuH = 116;
  const left = Math.min(x, vw - menuW - 8);
  const top = Math.min(y, vh - menuH - 8);

  return (
    <div
      ref={menuRef}
      style={{ left, top, position: 'fixed', zIndex: 90, minWidth: 192 }}
      className="drop"
    >
      <button
        type="button"
        onClick={() => { onReply(); onClose(); }}
        className="drop-item"
      >
        <Reply size={12} />
        Reply
      </button>
      <button
        type="button"
        disabled={!hasText}
        onClick={() => {
          if (hasText) {
            onSendToAI();
            onClose();
          }
        }}
        className={`drop-item${hasText ? '' : ' cursor-not-allowed'}`}
        style={hasText ? { color: 'var(--c-accent-2)' } : { color: 'var(--c-text-2)' }}
      >
        <Sparkles size={12} />
        {t('chat.sendToAI')}
      </button>
      <button
        type="button"
        disabled={!deletable}
        onClick={() => {
          if (deletable) {
            onDelete();
            onClose();
          }
        }}
        className={`drop-item${deletable ? '' : ' cursor-not-allowed'}`}
        style={deletable ? {color:'var(--c-danger)'} : {color:'var(--c-text-2)'}}
      >
        <Trash2 size={12} />
        Delete
      </button>
    </div>
  );
}

function commentAttachmentKind(name: string, mimeType?: string): AttachmentPreviewKind {
  const category = getFileCategory(name, mimeType);
  if (category === 'image') return 'image';
  if (category === 'video') return 'video';
  return 'file';
}

function CommentAttachmentPreview({
  comment,
  onOpenFileViewer,
}: {
  comment: TaskComment;
  onOpenFileViewer: (file: FileViewerItem) => void;
}) {
  const fileItem = getCommentAttachmentFile(comment);
  if (!fileItem) return null;
  const kind = commentAttachmentKind(fileItem.name, fileItem.mimeType);
  const src = fileItem.dataUrl || fileItem.path || '';

  return (
    <AttachmentPreviewList className="composer-attachments--inline composer-attachments--task-comment">
      <AttachmentPreviewItem
        item={{
          name: fileItem.name,
          kind,
          mimeType: fileItem.mimeType,
          dataUrl: kind === 'image' ? src : undefined,
          previewUrl: kind === 'video' ? comment.attachmentPreviewDataUrl : kind === 'image' ? src : undefined,
          sizeLabel: fileItem.size,
        }}
        onClick={() => onOpenFileViewer(fileItem)}
      />
    </AttachmentPreviewList>
  );
}

function CommentBubble({
  comment,
  onOpenFileViewer,
  onOpenMenu,
}: {
  comment: TaskComment;
  onOpenFileViewer: (file: FileViewerItem) => void;
  onOpenMenu: (comment: TaskComment, pos: { x: number; y: number }) => void;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);

  const handleLongPress = useCallback(
    (pos: { x: number; y: number }) => {
      onOpenMenu(comment, pos);
    },
    [comment, onOpenMenu]
  );

  const longPressProps = useLongPress({ onLongPress: handleLongPress });

  const scrollToComment = (id: string) => {
    const el = document.querySelector(`[data-comment-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const hasAttachment = Boolean(comment.attachmentDataUrl);

  return (
    <div data-comment-id={comment.id} className="comment-thread">
      <div className="comment-right-col">
        {comment.replyTo && (
          <div
            onClick={() => scrollToComment(comment.replyTo!.id)}
            style={{
              display: 'flex',
              alignItems: 'stretch',
              gap: 6,
              background: 'var(--c-background-4)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              fontSize: 'var(--fs-sm)',
              marginBottom: 4,
              border: '1px solid var(--c-border-1)',
              cursor: 'pointer',
            }}
          >
            <div style={{ width: 2, borderRadius: 'var(--radius-sm)', background: 'var(--c-accent-center-panel)', flexShrink: 0 }} />
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <div className="semibold" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-accent-center-panel)', marginBottom: 1 }}>
                {comment.replyTo.sender}
              </div>
              <div className="subtle trunc" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {comment.replyTo.text}
              </div>
            </div>
          </div>
        )}
        <div
          ref={bubbleRef}
          {...longPressProps}
          onContextMenu={(e) => {
            e.preventDefault();
            onOpenMenu(comment, { x: e.clientX, y: e.clientY });
          }}
          className="comment-bubble select-none c-ptr"
        >
          {comment.text && (
            <p className="txt-xs" style={{whiteSpace:'pre-wrap',color:'var(--c-text-1)'}}>{comment.text}</p>
          )}
          {hasAttachment && (
            <CommentAttachmentPreview comment={comment} onOpenFileViewer={onOpenFileViewer} />
          )}
        </div>
      </div>
      <span className="meta comment-meta">
        {formatTimestamp(comment.createdAt)}
      </span>
    </div>
  );
}

export function TaskCommentThread({ comments, onReplyComment }: TaskCommentThreadProps) {
  const [contextMenu, setContextMenu] = useState<{
    comment: TaskComment;
    x: number;
    y: number;
  } | null>(null);
  const { deleteComment } = useTaskCommentStore();
  const openFileViewer = useUIStore((s) => s.openFileViewer);
  const closeFileViewer = useUIStore((s) => s.closeFileViewer);
  const fileViewerOpen = useUIStore((s) => s.fileViewerOpen);
  const fileViewerFile = useUIStore((s) => s.fileViewerFile);
  const setSelectedText = useUIStore((s) => s.setSelectedText);

  const handleOpenFileViewer = useCallback(
    (file: FileViewerItem) => {
      const isSameCommentAttachment =
        fileViewerOpen &&
        file.source === 'task-comment' &&
        file.sourceId !== undefined &&
        fileViewerFile?.source === file.source &&
        fileViewerFile.sourceId === file.sourceId;

      if (isSameCommentAttachment) {
        closeFileViewer();
        return;
      }

      openFileViewer(file);
    },
    [closeFileViewer, fileViewerFile, fileViewerOpen, openFileViewer]
  );

  const handleOpenMenu = useCallback(
    (comment: TaskComment, pos: { x: number; y: number }) => {
      setContextMenu({ comment, x: pos.x, y: pos.y });
    },
    []
  );

  const handleSendToAI = useCallback(
    (comment: TaskComment) => {
      setSelectedText({ text: comment.text, from: 0, to: 0 });
    },
    [setSelectedText]
  );

  if (comments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{color:'var(--c-text-3)',textAlign:'center',marginTop:8,marginBottom:8}}>
        <div>
          <p className="txt-xs" style={{marginBottom:4}}>No comments yet.</p>
          <p className="txt-xs">Start the conversation below.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div id="task-comment-thread" className="ai-scroll flex-1 overflow-y-a" style={{display:'flex',flexDirection:'column',gap:16}}>
        {comments.map((comment) => (
          <CommentBubble
            key={comment.id}
            comment={comment}
            onOpenFileViewer={handleOpenFileViewer}
            onOpenMenu={handleOpenMenu}
          />
        ))}
      </div>

      {contextMenu && createPortal(
        <CommentContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          comment={contextMenu.comment}
          onReply={() => onReplyComment?.(contextMenu.comment)}
          onSendToAI={() => handleSendToAI(contextMenu.comment)}
          onDelete={() => deleteComment(contextMenu.comment.id, contextMenu.comment.taskId)}
          onClose={() => setContextMenu(null)}
        />,
        document.body
      )}
    </>
  );
}
