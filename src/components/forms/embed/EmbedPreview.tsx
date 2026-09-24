// EmbedPreview — in-app preview of a published/embedded form.
//
// Wraps FormRenderer in a sized viewport (desktop / tablet / mobile) so the
// Forms builder Embed tab can show how the form will look at common widths.
// The wrapper chrome (viewport frame + header) is app-side UI and may use app
// tokens; the FormRenderer inside keeps its own isolated `--tabs-form-*` vars.

import { Monitor, Tablet, Smartphone } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { LeadForm } from '../../../types/forms';
import { FormRenderer } from './FormRenderer';

export type EmbedPreviewMode = 'desktop' | 'tablet' | 'mobile';

export interface EmbedPreviewProps {
  form: LeadForm;
  /** Viewport width preset. Defaults to 'desktop'. */
  previewMode?: EmbedPreviewMode;
}

const VIEWPORT_WIDTH: Record<EmbedPreviewMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

const VIEWPORT_HEIGHT: Record<EmbedPreviewMode, string> = {
  desktop: 'auto',
  tablet: '1024px',
  mobile: '667px',
};

const VIEWPORT_LABEL: Record<EmbedPreviewMode, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

const VIEWPORT_DIMENSION: Record<EmbedPreviewMode, string> = {
  desktop: 'Fluid · 100% width',
  tablet: '768 × 1024',
  mobile: '375 × 667',
};

const VIEWPORT_ICON: Record<EmbedPreviewMode, typeof Monitor> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

const wrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(120, 120, 130, 0.08)',
  color: '#475569',
  fontSize: 12,
  fontWeight: 500,
  userSelect: 'none',
};

const stageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  width: '100%',
  overflow: 'auto',
  padding: '16px 0',
};

function viewportStyle(mode: EmbedPreviewMode): CSSProperties {
  return {
    width: VIEWPORT_WIDTH[mode],
    minHeight: mode === 'desktop' ? '480px' : VIEWPORT_HEIGHT[mode],
    maxWidth: '100%',
    background: '#ffffff',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(15, 23, 42, 0.12)',
    overflow: 'hidden',
    transition: 'width 200ms ease, min-height 200ms ease',
  };
}

export function EmbedPreview({ form, previewMode = 'desktop' }: EmbedPreviewProps): ReactNode {
  const mode: EmbedPreviewMode = previewMode;
  const Icon = VIEWPORT_ICON[mode];

  return (
    <div style={wrapperStyle}>
      <div style={headerStyle}>
        <Icon size={16} strokeWidth={2} />
        <span>{VIEWPORT_LABEL[mode]}</span>
        <span style={{ opacity: 0.6 }}>· {VIEWPORT_DIMENSION[mode]}</span>
      </div>

      <div style={stageStyle}>
        <div style={viewportStyle(mode)}>
          {/*
            isPublishedEmbed=false so file fields are NOT force-disabled in
            preview (the builder wants to see the real field chrome). The
            form's own style.customCss (if any) is injected by FormRenderer.
          */}
          <FormRenderer form={form} isPublishedEmbed={false} />
        </div>
      </div>
    </div>
  );
}

export default EmbedPreview;
