import type { ReactNode } from 'react';
import { CENTER_MIN_PX } from '../../../stores/layoutGeometry';

interface CenterContentPanelProps {
  children: ReactNode;
  subtasksBar?: ReactNode;
  showSubtasksBar?: boolean;
  leadingControls?: ReactNode;
}

/**
 * Common center panel shell: optional subtasks bar + scrollable body.
 * Stable identity — not remounted on wrapper swap.
 */
export function CenterContentPanel({
  children,
  subtasksBar,
  showSubtasksBar,
  leadingControls,
}: CenterContentPanelProps) {
  return (
    <div
      id="center-panel"
      className="center-content-panel panel"
      style={{ minWidth: CENTER_MIN_PX }}
    >
      {(showSubtasksBar && subtasksBar) || leadingControls ? (
        <div className="center-panel-toolbar subtasks-bar-wrapper">
          {leadingControls}
          {showSubtasksBar ? subtasksBar : null}
        </div>
      ) : null}
      <div id="center-panel-body" className="center-panel-body panel-body">
        {children}
      </div>
    </div>
  );
}
