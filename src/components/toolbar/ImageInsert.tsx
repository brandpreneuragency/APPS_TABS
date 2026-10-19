import { useState, useRef, useEffect } from 'react';
import { X, Link2, Upload } from 'lucide-react';
import type { Editor } from '@tiptap/react';

interface ImageInsertProps {
  editor: Editor | null;
  onClose: () => void;
}

export function ImageInsert({ editor, onClose }: ImageInsertProps) {
  const [tab, setTab] = useState<'url' | 'upload'>('url');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const insertUrl = () => {
    if (!editor || !url.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
    onClose();
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const insertUpload = () => {
    if (!editor || !preview) return;
    editor.chain().focus().setImage({ src: preview }).run();
    onClose();
  };

  return (
    <div
      id="image-insert-panel"
      ref={containerRef}
      className="drop"
      style={{ position: 'absolute', top: '100%', left: 0, marginTop: 0, width: 288 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', padding: '12px 12px 8px 12px' }}>
        <span className="label semibold">Insert Image</span>
        <button onClick={onClose} className="ui-icon-button tt-primary">
          <X className="ui-icon"  />
        </button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--c-border-1)', margin: '0 12px' }}>
        <button
          onClick={() => setTab('url')}
          className="row-xs"
          style={{
            padding: '0 8px 6px 8px',
            fontSize: 'var(--fs-xs)',
            fontWeight: 500,
            color: tab === 'url' ? 'var(--c-accent-1)' : 'var(--c-text-3)',
            borderBottom: '2px solid transparent',
            transition: 'color 0.15s',
            background: 'none',
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            cursor: 'pointer',
          }}
        >
          <Link2 className="ui-icon"  /> URL
        </button>
        <button
          onClick={() => setTab('upload')}
          className="row-xs"
          style={{
            padding: '0 8px 6px 8px',
            fontSize: 'var(--fs-xs)',
            fontWeight: 500,
            color: tab === 'upload' ? 'var(--c-accent-1)' : 'var(--c-text-3)',
            borderBottom: '2px solid transparent',
            transition: 'color 0.15s',
            background: 'none',
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            cursor: 'pointer',
          }}
        >
          <Upload className="ui-icon"  /> Upload
        </button>
      </div>

      <div className="col" style={{ padding: 12 }}>
        {tab === 'url' ? (
          <>
            <input
              id="image-insert-url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && insertUrl()}
              placeholder="https://example.com/image.png"
              className="ui-input"
            />
            <button
              id="image-insert-submit"
              onClick={insertUrl}
              disabled={!url.trim()}
              className="ui-button ui-button--primary btn-brand"
              style={!url.trim() ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              Insert
            </button>
          </>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {preview ? (
              <div className="col">
                <img
                  src={preview}
                  alt="preview"
                  style={{ width: '100%', maxHeight: 128, objectFit: 'contain', borderRadius: 'var(--radius-sm)', border: '1px solid var(--c-border-1)' }}
                />
                <div className="row">
                  <button
                    onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}
                    className="ui-button btn-xs flex-1"
                    style={{ border: '1px solid var(--c-border-1)' }}
                  >
                    Change
                  </button>
                  <button
                    onClick={insertUpload}
                    className="ui-button ui-button--primary btn-brand flex-1"
                  >
                    Insert
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="col"
                style={{
                  alignItems: 'center',
                  padding: '20px 0',
                  border: '2px dashed var(--c-border-1)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: 'transparent',
                  transition: 'border-color 0.15s, background-color 0.15s',
                  width: '100%',
                }}
              >
                <Upload  className="ui-icon tt-primary" />
                <span className="label">Click to choose a file</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
