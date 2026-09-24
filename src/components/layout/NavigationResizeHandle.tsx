import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { NAVIGATION_WIDTH_MAX_PX, NAVIGATION_WIDTH_MIN_PX } from '../../stores/uiLayoutState';

export function NavigationResizeHandle() {
  const { t } = useTranslation();
  const width = useUIStore((state) => state.navigationWidth);
  const setWidth = useUIStore((state) => state.setNavigationWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    setWidth(useUIStore.getState().navigationWidth);
  };

  return (
    <div className="navigation-resize-handle" role="separator" tabIndex={0}
      aria-label={t('navigation.resize')} aria-orientation="vertical"
      aria-valuemin={NAVIGATION_WIDTH_MIN_PX} aria-valuemax={NAVIGATION_WIDTH_MAX_PX} aria-valuenow={width}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) setWidth(drag.current.width + event.clientX - drag.current.x, { persist: false });
      }}
      onPointerUp={(event) => {
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const next = event.key === 'Home' ? NAVIGATION_WIDTH_MIN_PX
          : event.key === 'End' ? NAVIGATION_WIDTH_MAX_PX
          : event.key === 'ArrowLeft' ? width - step
          : event.key === 'ArrowRight' ? width + step : null;
        if (next === null) return;
        event.preventDefault();
        setWidth(next);
      }}
    />
  );
}
