import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import {
  CONTEXT_MAX_PX,
  CONTEXT_MIN_PX,
  HANDLE_WIDTH_PX,
  KEYBOARD_RESIZE_STEP_LARGE_PX,
  KEYBOARD_RESIZE_STEP_PX,
  applyContextKeyboardDelta,
  clampContextWidthPx,
  pxToVw,
  vwToPx,
} from '../stores/layoutGeometry';
import { useUIStore } from '../stores/uiStore';

function setResizingState(active: boolean) {
  if (active) {
    document.documentElement.dataset.resizing = 'context';
  } else if (document.documentElement.dataset.resizing === 'context') {
    delete document.documentElement.dataset.resizing;
  }
}

/**
 * Resize the contextual panel inside the primary wrapper.
 * Context always sits on the leading edge of primary (left in LTR).
 * Uses an explicit context panel ref — never previousElementSibling.
 *
 * Drag: update in-memory width only; persist on pointerup/cancel.
 * Keyboard: ArrowLeft/Right (Shift = larger step); persists each step.
 */
export function useContextPanelResize(options: {
  contextRef: RefObject<HTMLElement | null>;
  /** Primary content row — used to protect center min width. */
  primaryContentRef?: RefObject<HTMLElement | null>;
  /** Optional mode-scoped pixel width; defaults to the shared layout setting. */
  widthPx?: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthChange?: (widthPx: number, persist: boolean) => void;
}) {
  const { contextRef, primaryContentRef, widthPx, minWidthPx, maxWidthPx, onWidthChange } = options;
  const minWidth = minWidthPx ?? CONTEXT_MIN_PX;
  const maxWidth = maxWidthPx ?? CONTEXT_MAX_PX;
  const setContextPanelWidth = useUIStore((s) => s.setContextPanelWidth);
  const dragging = useRef(false);
  const cleanupDrag = useRef<(() => void) | null>(null);

  const endDragSession = useCallback(() => {
    if (cleanupDrag.current) {
      cleanupDrag.current();
      cleanupDrag.current = null;
    }
  }, []);

  useEffect(() => () => endDragSession(), [endDragSession]);

  const resolvePrimaryWidth = useCallback(() => {
    const primaryEl = primaryContentRef?.current;
    if (primaryEl) return primaryEl.getBoundingClientRect().width;
    // Fallback: walk up from context panel to primary content row.
    const panel = contextRef.current;
    const row = panel?.closest('.primary-workspace-content') as HTMLElement | null;
    return row?.getBoundingClientRect().width;
  }, [primaryContentRef, contextRef]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const panelEl = contextRef.current;
      const handleEl = e.currentTarget;
      if (!panelEl) return;

      endDragSession();
      dragging.current = true;
      handleEl.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startWidth = panelEl.getBoundingClientRect().width;
      const handleWidth = handleEl.getBoundingClientRect().width || HANDLE_WIDTH_PX;
      const primaryWidth = resolvePrimaryWidth();

      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      setResizingState(true);

      const onPointerMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX;
        const newWidth = startWidth + delta;
        const livePrimary = resolvePrimaryWidth() ?? primaryWidth;
        const clampedPx = clampContextWidthPx(newWidth, livePrimary, handleWidth, undefined, minWidth, maxWidth);
        if (onWidthChange) onWidthChange(clampedPx, false);
        else setContextPanelWidth(pxToVw(clampedPx, window.innerWidth), { persist: false });
      };

      const endDrag = (ev?: PointerEvent) => {
        if (!dragging.current && !cleanupDrag.current) return;
        dragging.current = false;
        if (ev) {
          try {
            handleEl.releasePointerCapture(ev.pointerId);
          } catch {
            // already released
          }
        }
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        setResizingState(false);
        handleEl.removeEventListener('pointermove', onPointerMove);
        handleEl.removeEventListener('pointerup', endDrag);
        handleEl.removeEventListener('pointercancel', endDrag);
        cleanupDrag.current = null;
        if (onWidthChange) onWidthChange(panelEl.getBoundingClientRect().width, true);
        else {
          const current = useUIStore.getState().contextPanelWidth;
          setContextPanelWidth(current, { persist: true });
        }
      };

      cleanupDrag.current = () => endDrag();
      handleEl.addEventListener('pointermove', onPointerMove);
      handleEl.addEventListener('pointerup', endDrag);
      handleEl.addEventListener('pointercancel', endDrag);
    },
    [contextRef, setContextPanelWidth, endDragSession, resolvePrimaryWidth, minWidth, maxWidth, onWidthChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();

      const step = e.shiftKey ? KEYBOARD_RESIZE_STEP_LARGE_PX : KEYBOARD_RESIZE_STEP_PX;
      const currentVw = useUIStore.getState().contextPanelWidth;
      const currentPx = widthPx ?? vwToPx(currentVw, window.innerWidth);
      const nextRaw = applyContextKeyboardDelta(currentPx, e.key, step);
      const handleWidth =
        e.currentTarget.getBoundingClientRect().width || HANDLE_WIDTH_PX;
      const primaryWidth = resolvePrimaryWidth();
      const clampedPx = clampContextWidthPx(nextRaw, primaryWidth, handleWidth, undefined, minWidth, maxWidth);
      if (onWidthChange) onWidthChange(clampedPx, true);
      else setContextPanelWidth(pxToVw(clampedPx, window.innerWidth), { persist: true });
    },
    [resolvePrimaryWidth, setContextPanelWidth, widthPx, minWidth, maxWidth, onWidthChange],
  );

  return {
    onPointerDown,
    onKeyDown,
    ariaValueMin: CONTEXT_MIN_PX,
    ariaValueMax: CONTEXT_MAX_PX,
  };
}
