import type { RefObject } from 'react';
import { useContextPanelResize } from '../../../hooks/useContextPanelResize';
import { CONTEXT_MAX_PX, CONTEXT_MIN_PX, vwToPx } from '../../../stores/layoutGeometry';
import { useUIStore } from '../../../stores/uiStore';

interface ContextResizeHandleProps {
  contextRef: RefObject<HTMLElement | null>;
  primaryContentRef?: RefObject<HTMLElement | null>;
  widthPx?: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthChange?: (widthPx: number, persist: boolean) => void;
  ariaLabel?: string;
}

/** Resize handle between contextual panel and center content (inside primary). */
export function ContextResizeHandle({
  contextRef,
  primaryContentRef,
  widthPx,
  minWidthPx,
  maxWidthPx,
  onWidthChange,
  ariaLabel,
}: ContextResizeHandleProps) {
  const { onPointerDown, onKeyDown, ariaValueMin, ariaValueMax } = useContextPanelResize({
    contextRef,
    primaryContentRef,
    widthPx,
    minWidthPx,
    maxWidthPx,
    onWidthChange,
  });
  const widthVw = useUIStore((s) => s.contextPanelWidth);
  const viewport =
    typeof window !== 'undefined' ? window.innerWidth : 1200;
  const valueNow = Math.round(widthPx ?? vwToPx(widthVw, viewport));

  return (
    <div
      id="context-resize-handle"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={ariaLabel ?? 'Resize context panel'}
      aria-valuemin={minWidthPx ?? ariaValueMin ?? CONTEXT_MIN_PX}
      aria-valuemax={maxWidthPx ?? ariaValueMax ?? CONTEXT_MAX_PX}
      aria-valuenow={valueNow}
      title={ariaLabel ?? 'Drag or use arrow keys to resize context panel'}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="context-resize-handle resize-handle workspace-handle"
    >
      <div className="context-resize-handle__line" />
    </div>
  );
}
