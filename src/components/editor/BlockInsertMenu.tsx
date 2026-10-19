import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { CheckSquare, Code2, Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Plus, Quote, Table2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ImageInsert } from '../toolbar/ImageInsert';

interface BlockInsertMenuProps {
  editor: Editor | null;
  editorScrollRef: RefObject<HTMLElement | null>;
}

type MenuAction = 'image' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'table' | 'divider';

interface MenuItem {
  action: MenuAction;
  icon: LucideIcon;
  label: string;
}

interface HoveredBlock {
  position: number;
  top: number;
  left: number;
}

const HANDLE_SIZE = 12;
/** Place the handle in the left gutter, just before TipTap text. */
const GUTTER_GAP = 10;

function getEmptyParagraphPosition(editor: Editor, position: number): number | null {
  try {
    const $pos = editor.state.doc.resolve(position);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      if (node.type.name === 'paragraph') {
        return node.content.size === 0 ? $pos.start(depth) : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getHandleCoords(
  editor: Editor,
  paragraphPosition: number,
  scrollContainer: HTMLElement,
): { top: number; left: number } | null {
  try {
    // Vertical: center on the empty line. Horizontal: always the scroll pane's
    // left gutter (60px padding) — not the text's left edge, so centering the
    // document body never drags the + into the middle of the pane.
    const lineCoords = editor.view.coordsAtPos(paragraphPosition);
    const scrollRect = scrollContainer.getBoundingClientRect();
    const paddingLeft = parseFloat(getComputedStyle(scrollContainer).paddingLeft) || 0;
    return {
      top: (lineCoords.top + lineCoords.bottom) / 2 - HANDLE_SIZE / 2,
      left: scrollRect.left + paddingLeft - HANDLE_SIZE - GUTTER_GAP,
    };
  } catch {
    return null;
  }
}

export function BlockInsertMenu({ editor, editorScrollRef }: BlockInsertMenuProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);
  const activePositionRef = useRef<number | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<HoveredBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageInsertOpen, setImageInsertOpen] = useState(false);

  const menuItems = useMemo<MenuItem[]>(
    () => [
      { action: 'image', icon: ImageIcon, label: t('editor.image') },
      { action: 'heading1', icon: Heading1, label: t('editor.heading1') },
      { action: 'heading2', icon: Heading2, label: t('editor.heading2') },
      { action: 'heading3', icon: Heading3, label: t('editor.heading3') },
      { action: 'bulletList', icon: List, label: t('editor.bulletList') },
      { action: 'orderedList', icon: ListOrdered, label: t('editor.orderedList') },
      { action: 'taskList', icon: CheckSquare, label: t('editor.checklist') },
      { action: 'blockquote', icon: Quote, label: t('editor.blockquote') },
      { action: 'codeBlock', icon: Code2, label: t('editor.codeBlock') },
      { action: 'table', icon: Table2, label: t('editor.table') },
      { action: 'divider', icon: Minus, label: t('editor.divider') },
    ],
    [t]
  );

  const applyOverlayCoords = useCallback((top: number, left: number) => {
    const overlay = overlayRef.current;
    if (overlay) {
      // Write styles immediately so panel-resize tracking isn't stuck behind React.
      overlay.style.top = `${top}px`;
      overlay.style.left = `${left}px`;
    }
  }, []);

  const showAtPosition = useCallback((paragraphPosition: number) => {
    const scrollContainer = editorScrollRef.current;
    if (!editor || !scrollContainer) return;
    const coords = getHandleCoords(editor, paragraphPosition, scrollContainer);
    if (!coords) {
      activePositionRef.current = null;
      setHoveredBlock(null);
      return;
    }

    activePositionRef.current = paragraphPosition;
    applyOverlayCoords(coords.top, coords.left);
    setHoveredBlock({
      position: paragraphPosition,
      top: coords.top,
      left: coords.left,
    });
  }, [applyOverlayCoords, editor, editorScrollRef]);

  const clearHandle = useCallback(() => {
    activePositionRef.current = null;
    setHoveredBlock(null);
  }, []);

  const syncHandlePosition = useCallback(() => {
    const scrollContainer = editorScrollRef.current;
    if (!editor || !scrollContainer) return;
    const position = activePositionRef.current;
    if (position === null) return;

    if (getEmptyParagraphPosition(editor, position) === null) {
      clearHandle();
      return;
    }

    const coords = getHandleCoords(editor, position, scrollContainer);
    if (!coords) {
      clearHandle();
      return;
    }

    applyOverlayCoords(coords.top, coords.left);
    setHoveredBlock((current) => {
      if (
        current
        && current.position === position
        && current.top === coords.top
        && current.left === coords.left
      ) {
        return current;
      }
      return {
        position,
        top: coords.top,
        left: coords.left,
      };
    });
  }, [applyOverlayCoords, clearHandle, editor, editorScrollRef]);

  useEffect(() => {
    if (!editor) return;

    const syncSelectedBlock = () => {
      if (menuOpen || imageInsertOpen) return;

      const paragraphPosition = getEmptyParagraphPosition(editor, editor.state.selection.$from.pos);
      if (paragraphPosition !== null) {
        showAtPosition(paragraphPosition);
        return;
      }

      if (activePositionRef.current !== null && getEmptyParagraphPosition(editor, activePositionRef.current) === null) {
        clearHandle();
      }
    };

    syncSelectedBlock();
    editor.on('selectionUpdate', syncSelectedBlock);
    editor.on('update', syncSelectedBlock);
    return () => {
      editor.off('selectionUpdate', syncSelectedBlock);
      editor.off('update', syncSelectedBlock);
    };
  }, [clearHandle, editor, imageInsertOpen, menuOpen, showAtPosition]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (overlayRef.current?.contains(event.target as Node)) return;

      const scrollContainer = editorScrollRef.current;
      if (!editor || !scrollContainer?.contains(event.target as Node)) {
        return;
      }

      if (menuOpen || imageInsertOpen) return;

      const resolved = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!resolved) return;

      const paragraphPosition = getEmptyParagraphPosition(editor, resolved.pos);
      if (paragraphPosition === null) return;

      showAtPosition(paragraphPosition);
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [editor, editorScrollRef, imageInsertOpen, menuOpen, showAtPosition]);

  useEffect(() => {
    const scrollContainer = editorScrollRef.current;
    if (!scrollContainer || !editor) return;

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncHandlePosition();
      });
    };

    // Panel drag resizes layout without firing window.resize — observe the editor box.
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(scrollContainer);
    resizeObserver.observe(editor.view.dom);

    scrollContainer.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      scrollContainer.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [editor, editorScrollRef, syncHandlePosition]);

  useEffect(() => {
    if (!menuOpen && !imageInsertOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!overlayRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setImageInsertOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setImageInsertOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [imageInsertOpen, menuOpen]);

  const runAction = (action: MenuAction) => {
    if (!editor || !hoveredBlock) return;

    const chain = editor.chain().focus().setTextSelection(hoveredBlock.position);

    if (action === 'image') {
      chain.run();
      setMenuOpen(false);
      setImageInsertOpen(true);
      return;
    }

    switch (action) {
      case 'heading1':
        chain.setNode('heading', { level: 1 }).run();
        break;
      case 'heading2':
        chain.setNode('heading', { level: 2 }).run();
        break;
      case 'heading3':
        chain.setNode('heading', { level: 3 }).run();
        break;
      case 'bulletList':
        chain.toggleBulletList().run();
        break;
      case 'orderedList':
        chain.toggleOrderedList().run();
        break;
      case 'taskList':
        chain.toggleTaskList().run();
        break;
      case 'blockquote':
        chain.toggleBlockquote().run();
        break;
      case 'codeBlock':
        chain.toggleCodeBlock().run();
        break;
      case 'table':
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
      case 'divider':
        chain.setHorizontalRule().run();
        break;
    }

    setMenuOpen(false);
    clearHandle();
  };

  if (!hoveredBlock) return null;

  return (
    <div
      ref={overlayRef}
      className="block-insert-overlay"
      style={{ top: hoveredBlock.top, left: hoveredBlock.left }}
    >
      <button
        type="button"
       className="ui-icon-button block-insert-handle"
        aria-label={t('editor.addBlock')}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Plus className="ui-icon" strokeWidth={2.5} />
      </button>

      {menuOpen && (
        <div className="drop block-insert-menu" role="menu">
          {menuItems.map(({ action, icon: Icon, label }) => (
            <button
              key={action}
              type="button"
              className="drop-item"
              role="menuitem"
              onClick={() => runAction(action)}
            >
              <Icon className="ui-icon" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {imageInsertOpen && (
        <ImageInsert
          editor={editor}
          onClose={() => {
            setImageInsertOpen(false);
            if (!editor || activePositionRef.current === null) {
              clearHandle();
              return;
            }
            if (getEmptyParagraphPosition(editor, activePositionRef.current) === null) {
              clearHandle();
              return;
            }
            syncHandlePosition();
          }}
        />
      )}
    </div>
  );
}
