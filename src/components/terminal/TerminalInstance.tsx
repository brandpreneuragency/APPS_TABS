import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useUIStore } from '../../stores/uiStore';
import { isTauriRuntime } from '../../services/runtime';

interface TerminalInstanceProps {
  id: string;
  active: boolean;
  onExit?: (id: string) => void;
}

function buildTheme() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    background: get('--c-background-1', '#1e1e1e'),
    foreground: get('--c-text-1', '#d4d4d4'),
    cursor: get('--c-accent-center-panel', '#ffffff'),
    selectionBackground: get('--c-accent-center-panel', '#ffffff'),
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  };
}

export function TerminalInstance({ id, active, onExit }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionReadyRef = useRef<Promise<void> | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const namedTheme = useUIStore((s) => s.theme);
  const native = isTauriRuntime();

  // Create the xterm instance once.
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontFamily: 'Consolas, "Cascadia Code", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: buildTheme(),
      convertEol: true,
      disableStdin: !native,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    termRef.current = term;
    fitRef.current = fit;

    if (!native) {
      term.write(
        '\x1b[90mShell requires the TABS desktop app.\x1b[0m\r\n' +
          '\x1b[90mThe terminal panel is available here for layout parity;\x1b[0m\r\n' +
          '\x1b[90mPTY sessions run in the desktop build.\x1b[0m\r\n',
      );
      return () => {
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    }

    term.onData((data) => {
      writeQueueRef.current = writeQueueRef.current
        .then(() => ensureSession(term)) // eslint-disable-line react-hooks/immutability
        .then(() => invoke('terminal_write', {
          id,
          data: btoa(data),
        }))
        .then(() => undefined)
        .catch(() => undefined);
    });

    const onResize = () => {
      try {
        fit.fit();
        void invoke('terminal_resize', {
          id,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => undefined);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);

    const unlistenFns: UnlistenFn[] = [];
    let disposed = false;
    const trackUnlisten = (promise: Promise<UnlistenFn>) => {
      void promise.then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlistenFns.push(fn);
      });
    };

    trackUnlisten(listen<{ id: string; data: string }>('terminal://output', (e) => {
      if (disposed || e.payload.id !== id) return;
      const bytes = Uint8Array.from(atob(e.payload.data), (c) => c.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      term.write(text);
    }));

    trackUnlisten(listen<{ id: string; exit_code: number }>('terminal://exit', (e) => {
      if (disposed || e.payload.id !== id) return;
      term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
      onExit?.(id);
    }));

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      unlistenFns.forEach((fn) => fn());
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-fit + re-theme when becoming active or theme changes.
  useEffect(() => {
    if (active && termRef.current && fitRef.current) {
      // Defer fit until the element is visible.
      requestAnimationFrame(() => {
        const term = termRef.current;
        const fit = fitRef.current;
        if (!term || !fit) return;
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
        if (!native) return;
        void ensureSession(term) // eslint-disable-line react-hooks/immutability
          .then(() => invoke('terminal_resize', {
            id,
            cols: term.cols,
            rows: term.rows,
          }))
          .then(() => undefined)
          .catch(() => undefined);
      });
    }
  }, [active, id, native]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = buildTheme();
    }
  }, [namedTheme]);

  function ensureSession(term: XTerm) {
    if (!sessionReadyRef.current) {
      sessionReadyRef.current = startSession(term).catch((err) => {
        sessionReadyRef.current = null;
        throw err;
      });
    }
    return sessionReadyRef.current;
  }

  async function startSession(term: XTerm) {
    try {
      await invoke('terminal_create', { id, cwd: null, shell: null });
    } catch (err) {
      const message = String(err);
      if (!message.includes('already exists')) {
        term.write(`\r\n\x1b[31mFailed to start terminal: ${message}\x1b[0m\r\n`);
        throw err;
      }
    }

    try {
      // Push an initial resize so the PTY matches the viewport.
      fitRef.current?.fit();
      await invoke('terminal_resize', {
        id,
        cols: term.cols,
        rows: term.rows,
      });
    } catch (err) {
      term.write(`\r\n\x1b[31mFailed to resize terminal: ${String(err)}\x1b[0m\r\n`);
      throw err;
    }
  }

  return (
    <div
      ref={containerRef}
      className={`terminal-instance${active ? '' : ' terminal-instance--hidden'}`}
    />
  );
}
