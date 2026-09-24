// FormBuilder — the form builder shell.
// Renders the toolbar (name + status + save/preview/publish), the inner tab bar
// (Build | Style | Logic | Embed | Submissions | Settings), and the active tab
// body. StyleTab / LogicTab / EmbedTab are created by other agents and imported
// here via default imports at the agreed paths.

import { useState } from 'react';
import type { LeadForm, LeadFormField } from '../../../types/forms';
import { useFormsStore, type BuilderTab, type PreviewMode } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { StatusBadge } from '../components/StatusBadge';
import { FormsEmptyState } from '../components/FormsEmptyState';
import BuildTab from './BuildTab';
import StyleTab from './StyleTab';
import LogicTab from './LogicTab';
import EmbedTab from './EmbedTab';
import SubmissionsTab from './SubmissionsTab';
import SettingsTab from './SettingsTab';
import {
  Save,
  Eye,
  Send,
  Archive,
  FilePlus2,
  X,
  Monitor,
  Tablet,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import './builder.css';

const BUILDER_TABS: ReadonlyArray<{ key: BuilderTab; label: string }> = [
  { key: 'build', label: 'Build' },
  { key: 'style', label: 'Style' },
  { key: 'logic', label: 'Logic' },
  { key: 'embed', label: 'Embed' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'settings', label: 'Settings' },
];

const PREVIEW_MODES: ReadonlyArray<{ key: PreviewMode; label: string; icon: LucideIcon }> = [
  { key: 'desktop', label: 'Desktop', icon: Monitor },
  { key: 'tablet', label: 'Tablet', icon: Tablet },
  { key: 'mobile', label: 'Mobile', icon: Smartphone },
];

export default function FormBuilder() {
  const activeTemplateId = useFormsStore((s) => s.activeTemplateId);
  const activeForm = useFormsStore((s) => s.getActiveBuilderForm());
  const isTemplateMode = Boolean(activeTemplateId);
  const activeBuilderTab = useFormsStore((s) => s.activeBuilderTab);
  const setActiveBuilderTab = useFormsStore((s) => s.setActiveBuilderTab);
  const createForm = useFormsStore((s) => s.createForm);
  const createFormFromTemplate = useFormsStore((s) => s.createFormFromTemplate);
  const updateForm = useFormsStore((s) => s.updateForm);
  const publishForm = useFormsStore((s) => s.publishForm);
  const archiveForm = useFormsStore((s) => s.archiveForm);
  const previewMode = useFormsStore((s) => s.previewMode);
  const setPreviewMode = useFormsStore((s) => s.setPreviewMode);
  const showToast = useUIStore((s) => s.showToast);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);

  const [previewing, setPreviewing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  if (!activeForm) {
    return (
      <div className="forms-builder">
        <FormsEmptyState
          icon={FilePlus2}
          title="No form selected"
          subtitle="Pick a form in the left panel, or create a new one."
          action={
            <button
              type="button"
              className="forms-action-btn forms-action-btn--primary"
              onClick={() => {
                void createForm();
                setActiveBuilderTab('build');
              }}
            >
              <FilePlus2 size={15} /> New form
            </button>
          }
        />
      </div>
    );
  }

  const handleSave = (): void => {
    // Updates are live (every keystroke calls updateForm); this is an explicit
    // "Saved" indicator for user reassurance.
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1500);
  };

  const handlePublishOrArchive = (): void => {
    if (activeForm.status === 'published') {
      void archiveForm(activeForm.id);
    } else {
      void publishForm(activeForm.id);
    }
  };

  const handleCreateFromTemplate = async (): Promise<void> => {
    const form = await createFormFromTemplate(activeForm.id, activeForm.name);
    if (form) {
      setActiveFormsPage('builder');
      showToast(`Created form “${form.name}” from template.`, 'info');
    }
  };

  const renderTab = (): React.ReactNode => {
    switch (activeBuilderTab) {
      case 'build':
        return <BuildTab form={activeForm} />;
      case 'style':
        return <StyleTab form={activeForm} />;
      case 'logic':
        return <LogicTab form={activeForm} />;
      case 'embed':
        return <EmbedTab form={activeForm} />;
      case 'submissions':
        return <SubmissionsTab form={activeForm} />;
      case 'settings':
        return <SettingsTab form={activeForm} />;
      default:
        return <BuildTab form={activeForm} />;
    }
  };

  return (
    <div className="forms-builder">
      {/* Toolbar */}
      <div className="forms-builder-toolbar">
        <div className="forms-builder-title-wrap">
          <input
            className="forms-builder-title-input"
            value={activeForm.name}
            onChange={(e) => void updateForm(activeForm.id, { name: e.target.value })}
            placeholder="Untitled form"
          />
          <StatusBadge status={activeForm.status} variant={isTemplateMode ? 'template' : 'form'} />
        </div>
        <div className="forms-builder-toolbar-spacer" />
        <div className="forms-builder-toolbar-actions">
          <button
            type="button"
            className="forms-action-btn forms-action-btn--ghost"
            onClick={handleSave}
            disabled={justSaved}
          >
            <Save size={15} /> {justSaved ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            className="forms-action-btn forms-action-btn--ghost"
            onClick={() => setPreviewing((p) => !p)}
            aria-pressed={previewing}
          >
            <Eye size={15} /> Preview
          </button>
          {isTemplateMode ? (
            <button
              type="button"
              className="forms-action-btn forms-action-btn--primary"
              onClick={() => void handleCreateFromTemplate()}
            >
              <FilePlus2 size={15} /> Create form
            </button>
          ) : activeForm.status === 'published' ? (
            <button
              type="button"
              className="forms-action-btn"
              onClick={handlePublishOrArchive}
            >
              <Archive size={15} /> Archive
            </button>
          ) : (
            <button
              type="button"
              className="forms-action-btn forms-action-btn--primary"
              onClick={handlePublishOrArchive}
            >
              <Send size={15} /> Publish
            </button>
          )}
        </div>
      </div>

      {/* Inner tab bar */}
      <div className="forms-builder-tabs" role="tablist">
        {BUILDER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeBuilderTab === tab.key}
            className={`forms-builder-tab${
              activeBuilderTab === tab.key ? ' forms-builder-tab--active' : ''
            }`}
            onClick={() => setActiveBuilderTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="forms-builder-body">{renderTab()}</div>

      {previewing && (
        <FormPreviewOverlay
          form={activeForm}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  );
}

/* ---------- Preview overlay ---------- */
interface FormPreviewOverlayProps {
  form: LeadForm;
  previewMode: PreviewMode;
  setPreviewMode: (m: PreviewMode) => void;
  onClose: () => void;
}

function FormPreviewOverlay({ form, previewMode, setPreviewMode, onClose }: FormPreviewOverlayProps) {
  const surfaceStyle = {
    '--tabs-form-primary': form.style.primaryColor ?? '#4f46e5',
    '--tabs-form-bg': form.style.backgroundColor ?? '#ffffff',
    '--tabs-form-text': form.style.textColor ?? '#111827',
    '--tabs-form-label': form.style.labelColor ?? '#374151',
    '--tabs-form-border': form.style.borderColor ?? '#d1d5db',
    '--tabs-form-radius': (form.style.borderRadius ?? 8) > 29 ? 'var(--radius-full)' : 'var(--radius-sm)',
    '--tabs-form-font': form.style.fontFamily ?? "'Inter', system-ui, sans-serif",
    '--tabs-form-font-size': `${form.style.fontSize ?? 14}px`,
    '--tabs-form-padding': `${form.style.padding ?? 20}px`,
  } as Record<string, string> as React.CSSProperties;

  const sortedFields = [...form.fields].sort((a, b) => a.order - b.order);

  return (
    <div className="forms-builder-preview-overlay" role="dialog" aria-label="Form preview">
      <div className="forms-builder-preview-bar">
        <div className="forms-builder-preview-toggle">
          {PREVIEW_MODES.map((m) => {
            const Icon = m.icon;
            const isActive = previewMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                title={m.label}
                className={`forms-builder-preview-toggle-btn${
                  isActive ? ' forms-builder-preview-toggle-btn--active' : ''
                }`}
                onClick={() => setPreviewMode(m.key)}
              >
                <Icon size={14} /> <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="forms-action-btn forms-action-btn--ghost"
          onClick={onClose}
        >
          <X size={15} /> Close preview
        </button>
      </div>
      <div className="forms-builder-preview-stage">
        <div
          className={`forms-builder-preview-surface forms-builder-preview-surface--${previewMode}`}
          style={surfaceStyle}
        >
          <div className="forms-builder-form">
            <h2 className="forms-builder-form-title">{form.name}</h2>
            {sortedFields.map((field) => (
              <PreviewField key={field.id} field={field} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ field }: { field: LeadFormField }) {
  const labelEl = (
    <label className="forms-builder-form-label">
      {field.label || '(untitled)'}
      {field.required ? <span className="forms-builder-form-label-req">*</span> : null}
    </label>
  );
  const helpEl = field.helpText ? (
    <p className="forms-builder-form-help">{field.helpText}</p>
  ) : null;

  switch (field.type) {
    case 'textarea':
      return (
        <div className="forms-builder-form-field">
          {labelEl}
          <textarea className="forms-builder-form-textarea" placeholder={field.placeholder} disabled />
          {helpEl}
        </div>
      );
    case 'select':
      return (
        <div className="forms-builder-form-field">
          {labelEl}
          <select className="forms-builder-form-select" disabled>
            <option value="">Select…</option>
            {(field.options ?? []).map((o) => (
              <option key={o.id} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {helpEl}
        </div>
      );
    case 'radio':
      return (
        <div className="forms-builder-form-field">
          {labelEl}
          <div className="forms-builder-form-options">
            {(field.options ?? []).map((o) => (
              <label key={o.id} className="forms-builder-form-option">
                <input type="radio" name={field.name} disabled /> {o.label}
              </label>
            ))}
          </div>
          {helpEl}
        </div>
      );
    case 'checkbox':
      return (
        <div className="forms-builder-form-field">
          {labelEl}
          <div className="forms-builder-form-options">
            {(field.options ?? []).map((o) => (
              <label key={o.id} className="forms-builder-form-option">
                <input type="checkbox" disabled /> {o.label}
              </label>
            ))}
          </div>
          {helpEl}
        </div>
      );
    case 'consent':
      return (
        <div className="forms-builder-form-field">
          <label className="forms-builder-form-consent">
            <input type="checkbox" disabled /> {field.label || 'I consent'}
            {field.required ? <span className="forms-builder-form-label-req">*</span> : null}
          </label>
          {helpEl}
        </div>
      );
    case 'file':
      // CRM_FORMS_FILE_UPLOAD_TODO: file upload disabled in published embeds until VPS storage
      return (
        <div className="forms-builder-form-field">
          {labelEl}
          <div className="forms-builder-form-file-disabled">
            {field.disabledInPublishedEmbed
              ? 'File upload is disabled until storage is connected.'
              : (field.placeholder ?? 'File upload')}
          </div>
          {helpEl}
        </div>
      );
    case 'hidden':
      return null;
    case 'submit':
      return (
        <button type="button" className="forms-builder-form-submit" disabled>
          {field.label || 'Submit'}
        </button>
      );
    default: {
      const inputType =
        field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : 'text';
      return (
        <div className="forms-builder-form-field">
          {labelEl}
          <input
            className="forms-builder-form-input"
            type={inputType}
            placeholder={field.placeholder}
            disabled
          />
          {helpEl}
        </div>
      );
    }
  }
}
