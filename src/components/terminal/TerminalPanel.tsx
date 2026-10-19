import { useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { TerminalTabs } from './TerminalTabs';
import { TerminalInstance } from './TerminalInstance';
import './terminal.css';

export function TerminalPanel() {
  const open = useUIStore((s) => s.terminalPanelOpen);
  const height = useUIStore((s) => s.terminalPanelHeight);
  const setHeight = useUIStore((s) => s.setTerminalPanelHeight);

  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeTerminalId);
  const setActive = useTerminalStore((s) => s.setActiveTerminal);
  const loadTerminals = useTerminalStore((s) => s.loadTerminals);
  const createTerminal = useTerminalStore((s) => s.createTerminal);

  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    void loadTerminals();
  }, [loadTerminals]);

  // Apply persisted height via DOM (avoids inline-style lint).
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.height = `${height}px`;
    }
  }, [height, open]);

  // Ensure at least one terminal exists when the panel opens.
  useEffect(() => {
    if (open && terminals.length === 0) {
      const id = createTerminal();
      setActive(id);
    }
  }, [open, terminals.length, createTerminal, setActive]);

  if (!open) return null;

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startY - ev.clientY;
      setHeight(startH + delta);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={panelRef}
      className="ui-panel-body terminal-panel"
    >
      <div className="terminal-resize-handle" onMouseDown={onResizeStart} />
      <TerminalTabs
        activeId={activeId}
        onSelect={(id) => setActive(id)}
      />
      <div className="terminal-body">
        {terminals.length === 0 ? (
          <div className="terminal-empty">No terminals. Click + to create one.</div>
        ) : (
          terminals.map((t) => (
            <TerminalInstance
              key={t.id}
              id={t.id}
              active={t.id === activeId}
              onExit={() => {
                // Keep the tab; user can re-type to restart (lazy start).
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
