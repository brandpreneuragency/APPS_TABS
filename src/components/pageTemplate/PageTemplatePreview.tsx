import { useState } from 'react';
import { ReusablePageTemplate } from './ReusablePageTemplate';
import type { PanelId, PageTemplatePanelConfig } from './types';
import './pageTemplate.css';

function PanelBar({
  side,
  onToggle,
}: {
  side: 'left' | 'right';
  onToggle: () => void;
}) {
  return (
    <div className="reusable-page-template__preview-bar">
      <span>{side === 'left' ? 'Left Header' : 'Right Header'}</span>
      <button
        type="button"
        className="reusable-page-template__preview-toggle ui-button"
        onClick={onToggle}
        aria-label={`Toggle ${side} panel`}
      >
        {side === 'left' ? '◀ Hide' : 'Hide ▶'}
      </button>
    </div>
  );
}

function PreviewSection({
  variant,
  children,
}: {
  variant?: 'orange' | 'orange-strong' | 'center-main' | 'center-footer';
  children: React.ReactNode;
}) {
  const className = [
    'reusable-page-template__preview-section',
    variant ? `reusable-page-template__preview-section--${variant}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <div className={className}>{children}</div>;
}

/**
 * Local preview that demonstrates the ReusablePageTemplate using
 * orange-tinted panels matching the design screenshots.
 *
 * It is intentionally self-contained and is not wired into the live TABS
 * app shell. Mount it from a story, route, or temporary preview page to
 * verify the template visually.
 */
export function PageTemplatePreview() {
  const [leftConfig, setLeftConfig] = useState<PageTemplatePanelConfig>({
    open: true,
    widthVw: 20,
    minWidthVw: 20,
    maxWidthVw: 40,
  });
  const [rightConfig, setRightConfig] = useState<PageTemplatePanelConfig>({
    open: true,
    widthVw: 30,
    minWidthVw: 20,
    maxWidthVw: 50,
  });

  const handleResize = (panel: PanelId, widthVw: number) => {
    if (panel === 'left') setLeftConfig((c) => ({ ...c, widthVw }));
    if (panel === 'right') setRightConfig((c) => ({ ...c, widthVw }));
  };

  const handleOpenChange = (panel: PanelId, open: boolean) => {
    if (panel === 'left') setLeftConfig((c) => ({ ...c, open }));
    if (panel === 'right') setRightConfig((c) => ({ ...c, open }));
  };

  const toggleLeft = () =>
    setLeftConfig((c) => ({ ...c, open: !(c.open ?? c.defaultOpen ?? true) }));
  const toggleRight = () =>
    setRightConfig((c) => ({ ...c, open: !(c.open ?? c.defaultOpen ?? true) }));

  return (
    <div className="reusable-page-template__preview-root">
      <ReusablePageTemplate
        left={leftConfig}
        right={rightConfig}
        onPanelResize={handleResize}
        onPanelOpenChange={handleOpenChange}
        slots={{
          leftHeader: <PanelBar side="left" onToggle={toggleLeft} />,
          leftMain: <PreviewSection variant="orange">Left Main</PreviewSection>,
          leftFooter: <PreviewSection variant="orange-strong">Left Footer</PreviewSection>,
          centerHeader: (
            <span className="reusable-page-template__preview-label">
              Center Header (4vh)
            </span>
          ),
          centerMain: <PreviewSection variant="center-main">Center Main</PreviewSection>,
          centerFooter: (
            <PreviewSection variant="center-footer">Center Footer (10vh)</PreviewSection>
          ),
          rightHeader: <PanelBar side="right" onToggle={toggleRight} />,
          rightMain: <PreviewSection variant="orange">Right Main</PreviewSection>,
          rightFooter: <PreviewSection variant="orange-strong">Right Footer</PreviewSection>,
        }}
      />
    </div>
  );
}
