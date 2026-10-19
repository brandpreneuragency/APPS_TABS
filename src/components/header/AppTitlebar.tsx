import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../../services/runtime';

interface AppTitlebarProps {
  children: ReactNode;
}

export function AppTitlebar({ children }: AppTitlebarProps) {
  const isTauriWindow = isTauriRuntime();
  const [isMaximized, setIsMaximized] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isTauriWindow) {
      const onFsChange = () => setIsMaximized(Boolean(document.fullscreenElement));
      document.addEventListener('fullscreenchange', onFsChange);
      return () => document.removeEventListener('fullscreenchange', onFsChange);
    }

    const appWindow = getCurrentWindow();
    let unlistenResize: (() => void) | null = null;

    const syncMaximized = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
      } catch {
        // Ignore browser/runtime mismatches and keep the default icon state.
      }
    };

    void syncMaximized();
    void appWindow.onResized(() => {
      void syncMaximized();
    }).then((unlisten) => {
      unlistenResize = unlisten;
    }).catch(() => {
      unlistenResize = null;
    });

    // Programmatic window drag: start dragging on mousedown in non-interactive areas
    const header = headerRef.current;
    if (!header) return;

    const handleMouseDown = (event: MouseEvent) => {
      // Don't start drag if clicking on interactive elements
      const target = event.target as HTMLElement;
      const interactiveSelectors = [
        'button',
        '[role="tab"]',
        '[role="button"]',
        'a',
        'input',
        'select',
        'textarea',
        '.tab-active',
        '.tab-passive',
        '.tab',
        '.ai-toggle-btn',
        '.app-titlebar__window-control',
        '.app-titlebar__window-controls',
        '#tab-plus-button',
        '#tab-plus-button-task',
      ];
      
      // Check if target or any ancestor is interactive
      let element: HTMLElement | null = target;
      while (element && element !== header) {
        if (interactiveSelectors.some(sel => element?.matches?.(sel))) {
          return; // Let the interactive element handle the click
        }
        element = element.parentElement;
      }

      // Start dragging the window
      void appWindow.startDragging();
    };

    header.addEventListener('mousedown', handleMouseDown);
    return () => {
      header.removeEventListener('mousedown', handleMouseDown);
      unlistenResize?.();
    };
  }, [isTauriWindow]);

  const stopWindowDrag = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleMinimize = () => {
    if (isTauriWindow) {
      void getCurrentWindow().minimize();
      return;
    }
    // Browser has no minimize; blur is the closest equivalent.
    window.blur();
  };

  const handleToggleMaximize = () => {
    if (isTauriWindow) {
      void (async () => {
        const appWindow = getCurrentWindow();
        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
      })();
      return;
    }
    void (async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          setIsMaximized(false);
        } else {
          await document.documentElement.requestFullscreen();
          setIsMaximized(true);
        }
      } catch {
        // Fullscreen may be blocked by the browser.
      }
    })();
  };

  const handleClose = () => {
    if (isTauriWindow) {
      void getCurrentWindow().close();
      return;
    }
    window.close();
  };

  return (
    <header ref={headerRef} className="app-titlebar">
      <div className="app-titlebar__main">
        {children}
      </div>

      <div className="app-titlebar__window-controls">
        <button
          type="button"
          className="ui-icon-button app-titlebar__window-control"
          onMouseDown={stopWindowDrag}
          onClick={handleMinimize}
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus className="ui-icon"  />
        </button>

        <button
          type="button"
          className="ui-icon-button app-titlebar__window-control"
          onMouseDown={stopWindowDrag}
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Copy className="ui-icon"  /> : <Square className="ui-icon"  />}
        </button>

        <button
          type="button"
          className="ui-icon-button app-titlebar__window-control app-titlebar__window-control--close"
          onMouseDown={stopWindowDrag}
          onClick={handleClose}
          aria-label="Close window"
          title="Close"
        >
          <X className="ui-icon"  />
        </button>
      </div>
    </header>
  );
}
