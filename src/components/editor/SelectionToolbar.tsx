import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, Link, X,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, RemoveFormatting,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { INLINE_TEXT_PRESETS, type InlineTextPresetName } from './InlineTextPreset';

interface SelectionToolbarProps {
  editor: Editor | null;
  editorScrollRef: RefObject<HTMLDivElement | null>;
}

interface Pos { x: number; y: number }

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      return document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  } catch {
    return false;
  }
}

async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

const ALIGN_MODES = ['left', 'center', 'right', 'justify'] as const;
const ALIGN_ICONS = [AlignLeft, AlignCenter, AlignRight, AlignJustify] as const;
const ALIGN_LABELS = ['Align left', 'Align center', 'Align right', 'Align justify'] as const;
const COLOR_SWATCHES = [
  '#000000', '#374151', '#dc2626', '#ea580c', '#ca8a04',
  '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777',
] as const;

function ToolBtn({
  onClick, active, title, children,
}: {
  onClick: () => void; active?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`tbar-btn${active ? ' tbar-btn--on' : ''}`}
    >
      {children}
    </button>
  );
}

function StyleBtn({
  onClick, active, label, title,
}: {
  onClick: () => void; active?: boolean; label: string; title?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`tbar-btn${active ? ' tbar-btn--on' : ''}`}
      style={{ fontFamily: 'var(--c-font-1)', fontSize: 'var(--fs-sm)', fontWeight: 500, paddingLeft: 0, paddingRight: 0 }}
    >
      {label}
    </button>
  );
}

export function SelectionToolbar({ editor, editorScrollRef }: SelectionToolbarProps) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<Pos | null>(null);
  const [savedRange, setSavedRange] = useState<{ from: number; to: number } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [href, setHref] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const visible = pos !== null;

  // Close toolbar on left-click outside the toolbar itself.
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target)) return;
      setPos(null);
      setSavedRange(null);
      setLinkOpen(false);
      setColorOpen(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible]);
  const activeTextPreset = (editor?.getAttributes('textStyle').textPreset ?? null) as InlineTextPresetName | null;

  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (e.button !== 2) return;
    if (!editor?.isEditable) return;

    const target = e.target as HTMLElement;
    if (!editorScrollRef.current?.contains(target)) return;
    if (toolbarRef.current?.contains(target)) return;
    if (target.closest('textarea, input, button, a, [role="menu"], .block-insert-overlay')) return;

    e.preventDefault();
    const { from, to } = editor.state.selection;
    setLinkOpen(false);
    setColorOpen(false);
    setPos({ x: e.clientX, y: e.clientY });
    setSavedRange({ from, to });
  }, [editorScrollRef, editor]);

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  useEffect(() => {
    if (linkOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [linkOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLinkOpen(false);
        setColorOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const insertLink = () => {
    const url = href.trim();
    if (!url || !editor || !savedRange) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: savedRange.from, to: savedRange.to })
      .setLink({ href: url })
      .run();
    setLinkOpen(false);
  };

  const removeLink = () => {
    if (!editor || !savedRange) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: savedRange.from, to: savedRange.to })
      .unsetLink()
      .run();
    setLinkOpen(false);
  };

  const cycleAlign = () => {
    if (!editor || !savedRange) return;
    const currentAlign = (
      editor.getAttributes('paragraph').textAlign ||
      editor.getAttributes('heading').textAlign ||
      'left'
    ) as typeof ALIGN_MODES[number];
    const currentIndex = Math.max(ALIGN_MODES.indexOf(currentAlign), 0);
    const nextIdx = (currentIndex + 1) % ALIGN_MODES.length;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: savedRange.from, to: savedRange.to })
      .setTextAlign(ALIGN_MODES[nextIdx])
      .run();
  };

  const applyTextPreset = (preset: InlineTextPresetName) => {
    if (!editor || !savedRange) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: savedRange.from, to: savedRange.to })
      .setInlineTextPreset(preset)
      .run();
  };

  const clearTextPreset = () => {
    if (!editor || !savedRange) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: savedRange.from, to: savedRange.to })
      .unsetInlineTextPreset()
      .run();
  };

  const applyColor = (color: string) => {
    if (!editor || !savedRange) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: savedRange.from, to: savedRange.to })
      .setColor(color)
      .run();
  };

  const closeToolbar = () => {
    setPos(null);
    setSavedRange(null);
    setLinkOpen(false);
    setColorOpen(false);
  };

  let savedText: string | null = null;
  if (savedRange && savedRange.from !== savedRange.to && editor) {
    try {
      savedText = editor.state.doc.textBetween(savedRange.from, savedRange.to, '\n');
    } catch {
      savedText = null;
    }
  }

  const restoreSavedSelection = () => {
    if (!editor || !savedRange) return false;
    return editor.chain().focus().setTextSelection(savedRange).run();
  };

  const selectAll = () => {
    if (!editor) return;
    editor.chain().focus().selectAll().run();
    const { from, to } = editor.state.selection;
    setSavedRange({ from, to });
  };

  const copySelection = async () => {
    if (savedText === null) return;
    await writeClipboardText(savedText);
  };

  const cutSelection = async () => {
    if (!editor || savedText === null || !restoreSavedSelection()) return;
    if (!await writeClipboardText(savedText)) return;
    editor.chain().focus().deleteSelection().run();
    closeToolbar();
  };

  const pasteFromClipboard = async () => {
    if (!editor || !savedRange) return;
    const text = await readClipboardText();
    if (text === null || !restoreSavedSelection()) return;
    editor.chain().focus().insertContent(text).run();
    closeToolbar();
  };

  if (!visible) return null;

  const rawLeft = pos.x - 120;
  const clampedLeft = Math.max(8, Math.min(rawLeft, window.innerWidth - 240 - 8));
  const currentAlign = (
    editor?.getAttributes('paragraph').textAlign ||
    editor?.getAttributes('heading').textAlign ||
    'left'
  ) as typeof ALIGN_MODES[number];
  const alignIndex = Math.max(ALIGN_MODES.indexOf(currentAlign), 0);
  const AlignIcon = ALIGN_ICONS[alignIndex];
  const alignLabel = ALIGN_LABELS[alignIndex];
  const currentColor = (editor?.getAttributes('textStyle').color ?? null) as string | null;

  return createPortal(
    <div
      ref={toolbarRef}
      className="selection-toolbar-wrap"
      style={{
        position: 'fixed',
        top: pos.y + 30,
        left: clampedLeft,
        zIndex: 200,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="selection-toolbar-close"
        title={t('editor.closeToolbar')}
        aria-label={t('editor.closeToolbar')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={closeToolbar}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <div
        className="drop selection-toolbar"
        style={{
          padding: 8,
          borderRadius: 'var(--radius-sm)',
        }}
      >
      {/* Row 1: Link, Bold, Italic, Underline, Strikethrough, Bullet list, Number list */}
      <div className="row-xs" style={{ padding: '0 6px' }}>
        <ToolBtn
          onClick={() => {
            const nextOpen = !linkOpen;
            if (nextOpen) {
              setHref(editor?.getAttributes('link').href ?? '');
              setColorOpen(false);
            }
            setLinkOpen(nextOpen);
          }}
          active={editor?.isActive('link') || linkOpen}
          title="Link"
        >
          <Link size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).toggleBold().run();
          }}
          active={editor?.isActive('bold')}
          title="Bold"
        >
          <Bold size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).toggleItalic().run();
          }}
          active={editor?.isActive('italic')}
          title="Italic"
        >
          <Italic size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).toggleUnderline().run();
          }}
          active={editor?.isActive('underline')}
          title="Underline"
        >
          <Underline size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).toggleStrike().run();
          }}
          active={editor?.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).toggleBulletList().run();
          }}
          active={editor?.isActive('bulletList')}
          title="Bullet list"
        >
          <List size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).toggleOrderedList().run();
          }}
          active={editor?.isActive('orderedList')}
          title="Number list"
        >
          <ListOrdered size={13} />
        </ToolBtn>
      </div>

      {/* Row 2: h1, h2, h3, p, Align, Text color, Clear formatting */}
      <div className="row-xs" style={{ padding: '0 6px' }}>
        <StyleBtn label="h1" title="Inline heading 1" active={activeTextPreset === INLINE_TEXT_PRESETS[0]} onClick={() => applyTextPreset('h1')} />
        <StyleBtn label="h2" title="Inline heading 2" active={activeTextPreset === INLINE_TEXT_PRESETS[1]} onClick={() => applyTextPreset('h2')} />
        <StyleBtn label="h3" title="Inline heading 3" active={activeTextPreset === INLINE_TEXT_PRESETS[2]} onClick={() => applyTextPreset('h3')} />
        <StyleBtn label="p"  title="Body text" active={!activeTextPreset} onClick={clearTextPreset} />
        <ToolBtn
          onClick={cycleAlign}
          active={alignIndex > 0}
          title={alignLabel}
        >
          <AlignIcon size={13} />
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            setColorOpen((v) => !v);
            setLinkOpen(false);
          }}
          active={colorOpen}
          title="Text color"
        >
          <span style={{ position: 'relative', display: 'inline-block', width: 13, height: 13, lineHeight: 1 }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>A</span>
            <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5, background: currentColor ?? 'var(--c-text-2)', borderRadius: 'var(--radius-sm)' }} />
          </span>
        </ToolBtn>
        <ToolBtn
          onClick={() => {
            if (!editor || !savedRange) return;
            editor.chain().focus().setTextSelection({ from: savedRange.from, to: savedRange.to }).clearNodes().unsetAllMarks().run();
          }}
          title="Clear formatting"
        >
          <RemoveFormatting size={13} />
        </ToolBtn>
      </div>

      {linkOpen && (
        <div style={{ padding: '0 8px 8px 8px', borderTop: '1px solid var(--c-border-1)', display: 'flex', gap: 6 }}>
          <input
            id="selection-link-input"
            ref={inputRef}
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') insertLink(); }}
            placeholder="https://..."
            className="ctrl-xs min-w-0 flex-1"
          />
          <button
            id="selection-link-submit"
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertLink}
            disabled={!href.trim()}
            className="btn-brand btn-xs"
            style={{ flexShrink: 0 }}
          >
            {editor?.isActive('link') ? 'Update' : 'Insert'}
          </button>
          {editor?.isActive('link') && (
            <button
              id="selection-link-remove"
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
              className="btn-xs"
              style={{ flexShrink: 0, border: '1px solid var(--c-border-1)' }}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {colorOpen && (
        <div style={{ padding: '0 8px 8px 8px', borderTop: '1px solid var(--c-border-1)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyColor(color)}
              title={color}
              style={{
                width: 18,
                height: 18,
                borderRadius: 'var(--radius-sm)',
                background: color,
                border: currentColor === color ? '2px solid var(--c-brand-1)' : '1px solid var(--c-border-1)',
                padding: 0,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}

      <div className="selection-toolbar-actions">
        <button
          type="button"
          className="selection-toolbar-action-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={selectAll}
        >
          {t('editor.selectAll')}
        </button>
        <button
          type="button"
          className="selection-toolbar-action-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void cutSelection()}
          disabled={savedText === null}
        >
          {t('editor.cut')}
        </button>
        <button
          type="button"
          className="selection-toolbar-action-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void copySelection()}
          disabled={savedText === null}
        >
          {t('editor.copy')}
        </button>
        <button
          type="button"
          className="selection-toolbar-action-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void pasteFromClipboard()}
        >
          {t('editor.paste')}
        </button>
      </div>
      </div>
    </div>,
    document.body
  );
}
