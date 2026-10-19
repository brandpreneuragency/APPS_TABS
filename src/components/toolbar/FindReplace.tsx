import { useState, useEffect, useCallback, type RefObject } from 'react';
import { X, ChevronUp, ChevronDown, Replace } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useUIStore } from '../../stores/uiStore';

interface FindReplaceProps {
  editor: Editor | null;
  anchorRef?: RefObject<HTMLButtonElement | null>;
}

export function FindReplace({ editor, anchorRef }: FindReplaceProps) {
  const { findReplaceOpen, setFindReplaceOpen } = useUIStore();
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    if (findReplaceOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      return () => window.removeEventListener('resize', updatePosition);
    }
  }, [findReplaceOpen, updatePosition]);

  const close = () => {
    setFindReplaceOpen(false);
    setFindText('');
    setReplaceText('');
  };

  const countMatches = useCallback(() => {
    if (!editor || !findText) { setMatchCount(0); return; }
    const text = editor.getText();
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    setMatchCount(matches?.length ?? 0);
  }, [editor, findText]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { countMatches(); }, [countMatches]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    if (findReplaceOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [findReplaceOpen]);

  const handleReplace = () => {
    if (!editor || !findText) return;
    const { state, dispatch } = editor.view;
    const text = state.doc.textContent;
    const idx = text.toLowerCase().indexOf(findText.toLowerCase());
    if (idx === -1) return;
    const tr = state.tr.replaceWith(
      idx + 1,
      idx + 1 + findText.length,
      state.schema.text(replaceText)
    );
    dispatch(tr);
    countMatches();
  };

  const handleReplaceAll = () => {
    if (!editor || !findText) return;
    const content = editor.getHTML();
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replaced = content.replace(new RegExp(escaped, 'gi'), replaceText);
    editor.commands.setContent(replaced);
    setMatchCount(0);
  };

  if (!findReplaceOpen) return null;

  return (
    <div id="find-replace-panel" className="drop" style={{ position: 'fixed', top: position.top, left: position.left, width: 320, padding: 12, zIndex: 9999 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="label semibold">Find & Replace</span>
        <button onClick={close} className="ui-icon-button tt-primary">
          <X className="ui-icon"  />
        </button>
      </div>

      <div className="col">
        <div className="row">
          <input
            id="find-replace-input"
            autoFocus
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            placeholder="Find..."
            className="ui-input flex-1"
          />
          <span id="find-replace-count" className="label nowrap">
            {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : '0/0'}
          </span>
          <button
            id="find-replace-prev"
            onClick={() => setCurrentMatch((v) => Math.max(0, v - 1))}
            className="ui-icon-button tt-primary"
          >
            <ChevronUp className="ui-icon"  />
          </button>
          <button
            id="find-replace-next"
            onClick={() => setCurrentMatch((v) => Math.min(matchCount - 1, v + 1))}
            className="ui-icon-button tt-primary"
          >
            <ChevronDown className="ui-icon"  />
          </button>
        </div>

        <div className="row">
          <input
            id="replace-input"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with..."
            className="ui-input flex-1"
          />
          <button
            id="find-replace-btn"
            onClick={handleReplace}
            className="ui-button nowrap" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-accent-1)', fontWeight: 500, textDecoration: 'none' }}
          >
            Replace
          </button>
          <button
            id="find-replace-all-btn"
            onClick={handleReplaceAll}
            className="ui-button row-xs nowrap" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-accent-1)', fontWeight: 500 }}
          >
            <Replace className="ui-icon"  />
            All
          </button>
        </div>
      </div>
    </div>
  );
}
