import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTerminalStore } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';
import { invoke } from '@tauri-apps/api/core';

interface TerminalTabsProps {
  onSelect: (id: string) => void;
  activeId: string | null;
}

export function TerminalTabs({ onSelect, activeId }: TerminalTabsProps) {
  const { t } = useTranslation();
  const terminals = useTerminalStore((s) => s.terminals);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const closeTerminal = useTerminalStore((s) => s.closeTerminal);
  const renameTerminal = useTerminalStore((s) => s.renameTerminal);
  const setTerminalPanelOpen = useUIStore((s) => s.setTerminalPanelOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const handleClose = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTerminal(id);
    await invoke('terminal_kill', { id }).catch(() => undefined);
  };

  const handleNew = () => {
    const id = createTerminal();
    onSelect(id);
  };

  const commitRename = (id: string) => {
    if (draft.trim()) renameTerminal(id, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="terminal-tabs-strip">
      {terminals.map((tItem) => (
        <div
          key={tItem.id}
          className={`terminal-tab${tItem.id === activeId ? ' terminal-tab--active' : ' terminal-tab--passive'}`}
          onClick={() => onSelect(tItem.id)}
          onDoubleClick={() => {
            setEditingId(tItem.id);
            setDraft(tItem.name);
          }}
        >
          {editingId === tItem.id ? (
            <input
              autoFocus
              className="terminal-tab-rename-input"
              aria-label={t('terminal.renameTerminal')}
              placeholder={tItem.name}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(tItem.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(tItem.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="terminal-tab-label">{tItem.name}</span>
          )}
          <button
            type="button"
            className="terminal-tab-close"
            title={t('terminal.closeTerminal')}
            aria-label={t('terminal.closeTerminal')}
            onClick={(e) => void handleClose(e, tItem.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="terminal-new-tab"
        onClick={handleNew}
        title={t('terminal.newTerminal')}
        aria-label={t('terminal.newTerminal')}
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        className="terminal-hide-panel"
        onClick={() => setTerminalPanelOpen(false)}
        title={t('terminal.hideTerminal')}
        aria-label={t('terminal.hideTerminal')}
      >
        <X size={14} />
      </button>
    </div>
  );
}
