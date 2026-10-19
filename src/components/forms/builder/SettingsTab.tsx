// SettingsTab — per-form settings (NOT the module Forms Settings page).
// Covers success message, notification email, allowed embed domains, file-upload
// notice, webhook pointer, and status control. All updates go through updateForm.

// CRM_FORMS_WEBHOOK_DELIVERY_TODO:
// Webhook settings are stored now, but delivery/retry/logging is deferred.
// Future backend agent must implement signed payloads, timeout handling,
// retry policy, webhook logs, failure states, and test-send action.

import { useState } from 'react';
import type { LeadForm, FormStatus } from '../../../types/forms';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { AlertTriangle, ExternalLink, Plus, X, FileEdit, CheckCircle2, Archive } from 'lucide-react';

const STATUS_OPTIONS: ReadonlyArray<{ value: FormStatus; label: string; icon: typeof FileEdit }> = [
  { value: 'draft', label: 'Draft', icon: FileEdit },
  { value: 'published', label: 'Published', icon: CheckCircle2 },
  { value: 'archived', label: 'Archived', icon: Archive },
];

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export default function SettingsTab({ form }: { form: LeadForm }) {
  const updateForm = useFormsStore((s) => s.updateForm);
  const publishForm = useFormsStore((s) => s.publishForm);
  const archiveForm = useFormsStore((s) => s.archiveForm);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);
  const [domainInput, setDomainInput] = useState('');

  const allowedDomains = form.embed.allowedDomains ?? [];

  const addDomain = (): void => {
    const d = normalizeDomain(domainInput);
    if (!d || allowedDomains.includes(d)) {
      setDomainInput('');
      return;
    }
    void updateForm(form.id, {
      embed: { ...form.embed, allowedDomains: [...allowedDomains, d] },
    });
    setDomainInput('');
  };
  const removeDomain = (d: string): void => {
    void updateForm(form.id, {
      embed: { ...form.embed, allowedDomains: allowedDomains.filter((x) => x !== d) },
    });
  };

  const setStatus = (status: FormStatus): void => {
    if (status === form.status) return;
    if (status === 'published') {
      void publishForm(form.id);
      return;
    }
    if (status === 'archived') {
      void archiveForm(form.id);
      return;
    }
    void updateForm(form.id, { status: 'draft' });
  };

  // CRM_FORMS_FILE_UPLOAD_TODO:
  // File upload field UI/config is intentionally included,
  // but live upload storage is not implemented yet.
  // Future VPS agent must connect this to object storage or server storage,
  // signed upload URLs, MIME/type validation, file size limits,
  // virus/security checks, and submission attachment linking
  // before enabling production file uploads.
  const fileUploadsPanel = (
    <div className="forms-builder-disabled-panel">
      <AlertTriangle />
      <div>
        <p className="forms-empty-state-title" style={{ fontSize: 'var(--fs-sm)' }}>
          File uploads not enabled
        </p>
        <p className="forms-section-hint">
          File fields render disabled in published embeds until VPS storage is connected. Configure
          file fields in the Build tab; they remain inert until storage is wired up.
        </p>
      </div>
    </div>
  );

  return (
    <div className="forms-builder-settings">
      <div className="ui-panel-body forms-builder-settings-scroll">
        {/* Success message */}
        <div className="ui-card forms-section">
          <h3 className="forms-section-title">Success message</h3>
          <p className="forms-section-hint">Shown to respondents after they submit.</p>
          <textarea
            className="ui-input forms-textarea"
            value={form.successMessage}
            onChange={(e) => void updateForm(form.id, { successMessage: e.target.value })}
          />
        </div>

        {/* Notification email */}
        <div className="ui-card forms-section">
          <h3 className="forms-section-title">Notification email</h3>
          <p className="forms-section-hint">New submissions are forwarded to this address.</p>
          <input
            className="ui-input forms-input"
            type="email"
            placeholder="you@example.com"
            value={form.notificationEmail ?? ''}
            onChange={(e) =>
              void updateForm(form.id, { notificationEmail: e.target.value || undefined })
            }
          />
        </div>

        {/* Allowed embed domains */}
        <div className="ui-card forms-section">
          <h3 className="forms-section-title">Allowed embed domains</h3>
          <p className="forms-section-hint">
            Restrict where this form can be embedded. Empty = unrestricted (not recommended).
          </p>
          <div className="forms-domains-editor">
            {allowedDomains.map((d) => (
              <span key={d} className="forms-domain-chip">
                {d}
                <button className="ui-icon-button" type="button" title="Remove" onClick={() => removeDomain(d)}>
                  <X />
                </button>
              </span>
            ))}
            <div className="forms-domains-add">
              <input className="ui-input"
                value={domainInput}
                placeholder="example.com"
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addDomain();
                  }
                }}
              />
              <button
                type="button"
                className="ui-button forms-action-btn forms-action-btn--ghost"
                onClick={addDomain}
              >
                <Plus /> Add
              </button>
            </div>
          </div>
        </div>

        {/* File uploads */}
        <div className="ui-card forms-section">
          <h3 className="forms-section-title">File uploads</h3>
          {fileUploadsPanel}
        </div>

        {/* Webhooks */}
        <div className="ui-card forms-section">
          <h3 className="forms-section-title">Webhooks</h3>
          <p className="forms-section-hint">Webhook delivery config lives in Forms Settings.</p>
          <button
            type="button"
            className="ui-button forms-action-btn forms-action-btn--ghost"
            onClick={() => setActiveFormsPage('settings')}
          >
            <ExternalLink /> Open Forms Settings
          </button>
        </div>

        {/* Status control */}
        <div className="ui-card forms-section">
          <h3 className="forms-section-title">Status</h3>
          <p className="forms-section-hint">
            Publish to make the form embeddable. Archive to retire it.
          </p>
          <div className="forms-builder-status-control">
            {STATUS_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = form.status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={"ui-button " + (`forms-action-btn${isActive ? ' ui-button--primary forms-action-btn--primary' : ''}`)}
                  onClick={() => setStatus(opt.value)}
                >
                  <Icon /> {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
