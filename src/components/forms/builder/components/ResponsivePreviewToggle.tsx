// ResponsivePreviewToggle — the Style tab top bar.
//
// Three-segment Desktop | Tablet | Mobile switch bound to the shared
// `previewMode` / `setPreviewMode` on the forms store. Reuses the
// `.forms-builder-preview-bar` + `.forms-builder-preview-toggle*`
// classes defined in builder.css.

import { Monitor, Tablet, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFormsStore } from '../../../../stores/formsStore';
import type { PreviewMode } from '../../../../stores/formsStore';

interface PreviewModeOption {
  mode: PreviewMode;
  label: string;
  Icon: LucideIcon;
}

const OPTIONS: readonly PreviewModeOption[] = [
  { mode: 'desktop', label: 'Desktop', Icon: Monitor },
  { mode: 'tablet', label: 'Tablet', Icon: Tablet },
  { mode: 'mobile', label: 'Mobile', Icon: Smartphone },
];

export function ResponsivePreviewToggle() {
  const previewMode = useFormsStore((s) => s.previewMode);
  const setPreviewMode = useFormsStore((s) => s.setPreviewMode);

  return (
    <div className="ui-toolbar forms-builder-preview-bar">
      <span className="forms-builder-style-bar-label">Live preview</span>
      <div
        className="forms-builder-preview-toggle"
        role="group"
        aria-label="Preview viewport size"
      >
        {OPTIONS.map(({ mode, label, Icon }) => {
          const active = previewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              className={"ui-button " + ('forms-builder-preview-toggle-btn' +
                (active ? ' forms-builder-preview-toggle-btn--active' : ''))}
              onClick={() => setPreviewMode(mode)}
              aria-pressed={active}
            >
              <Icon strokeWidth={2} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
