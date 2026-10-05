import { useEffect, useLayoutEffect, useRef } from 'react';
import { Reply, Trash2 } from 'lucide-react';

interface ChatBubbleContextMenuProps {
  x: number;
  y: number;
  onReply: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ChatBubbleContextMenu({
  x,
  y,
  onReply,
  onDelete,
  onClose,
}: ChatBubbleContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
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
  const menuH = 88;
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
        onClick={() => { onDelete(); onClose(); }}
        className="drop-item"
        style={{ color: 'var(--c-danger)' }}
      >
        <Trash2 size={12} />
        Delete
      </button>
    </div>
  );
}
