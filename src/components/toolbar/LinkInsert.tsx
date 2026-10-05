import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Editor } from '@tiptap/react';

interface LinkInsertProps {
  editor: Editor | null;
  onClose: () => void;
}

export function LinkInsert({ editor, onClose }: LinkInsertProps) {
  const existing = editor?.getAttributes('link').href ?? '';
  const [url, setUrl] = useState(existing);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const insert = () => {
    if (!editor) return;
    if (url.trim()) {
      editor.chain().focus().setLink({ href: url.trim() }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    onClose();
  };

  const remove = () => {
    editor?.chain().focus().unsetLink().run();
    onClose();
  };

  return (
    <div
      id="link-insert-panel"
      ref={containerRef}
      className="drop"
      style={{ position: 'absolute', top: '100%', left: 0, marginTop: 0, width: 288, padding: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="label semibold">Insert Link</span>
        <button onClick={onClose} className="tt-primary">
          <X size={14} />
        </button>
      </div>

      <div className="col">
        <input
          id="link-insert-url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && insert()}
          placeholder="https://example.com"
          className="ctrl-sm"
        />
        <div className="row">
          {existing && (
            <button
              id="link-insert-remove"
              onClick={remove}
              className="btn-xs flex-1"
              style={{ border: '1px solid var(--c-border-1)' }}
            >
              Remove
            </button>
          )}
          <button
            id="link-insert-submit"
            onClick={insert}
            disabled={!url.trim() && !existing}
            className="btn-brand flex-1"
            style={(!url.trim() && !existing) ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          >
            {existing ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
