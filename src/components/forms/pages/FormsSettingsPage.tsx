import { useEffect, useMemo, useState } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import type { FormsSettingsSection } from '../components/settingsSectionState';
import {
  useFormsSettingsSection,
  setFormsSettingsSection,
  FORMS_SETTINGS_SECTIONS,
} from '../components/settingsSectionState';
import { FormsTabBar, type FormsTab } from '../components/FormsTabBar';
import {
  Download,
  Save,
  Plus,
  Trash2,
  Upload,
  Lock,
  ShieldCheck,
  Bell,
  Webhook,
  Settings2,
  Globe,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '../forms.css';

// CRM_FORMS_FILE_UPLOAD_TODO:
// File upload field UI/config is included, but storage is not implemented yet.
// Future VPS agent must connect object/server storage, signed upload URLs,
// MIME/type validation, file size limits, security scanning, and attachment linking.

// CRM_FORMS_WEBHOOK_DELIVERY_TODO:
// Webhook settings are stored now, but delivery/retry/logging is deferred.
// Future backend agent must implement signed payloads, timeout handling,
// retry policy, webhook logs, failure states, and test-send action.

const SECTION_ICONS: Record<FormsSettingsSection, LucideIcon> = {
  defaults: Settings2,
  spam: ShieldCheck,
  notifications: Bell,
  webhooks: Webhook,
  file_uploads: Upload,
  embed_security: Lock,
  export: Download,
};

export default function FormsSettingsPage() {
  const activeSection = useFormsSettingsSection();
  const isLoaded = useFormsStore((s) => s.isLoaded);
  const loadForms = useFormsStore((s) => s.loadForms);

  useEffect(() => {
    if (!isLoaded) void loadForms();
  }, [isLoaded, loadForms]);

  const tabs: FormsTab[] = useMemo(
    () =>
      FORMS_SETTINGS_SECTIONS.map((sec) => ({
        key: sec.key,
        label: sec.label,
        icon: SECTION_ICONS[sec.key],
      })),
    [],
  );

  return (
    <div className="ui-panel-body forms-page forms-page--scroll" >
      <div className="forms-page-head">
        <h2 className="forms-page-title">Forms Settings</h2>
        <p className="forms-page-subtitle">Defaults, spam protection, notifications, webhooks, embed security and export.</p>
      </div>
      <FormsTabBar tabs={tabs} active={activeSection} onChange={(k) => setFormsSettingsSection(k as FormsSettingsSection)} />
      {activeSection === 'defaults' && <DefaultsSection />}
      {activeSection === 'spam' && <SpamSection />}
      {activeSection === 'notifications' && <NotificationsSection />}
      {activeSection === 'webhooks' && <WebhooksSection />}
      {activeSection === 'file_uploads' && <FileUploadsSection />}
      {activeSection === 'embed_security' && <EmbedSecuritySection />}
      {activeSection === 'export' && <ExportSection />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Defaults                                                           */
/* ------------------------------------------------------------------ */

function DefaultsSection() {
  const forms = useFormsStore((s) => s.forms);
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const updateForm = useFormsStore((s) => s.updateForm);
  const showToast = useUIStore((s) => s.showToast);

  const formId = activeFormId ?? forms[0]?.id ?? null;
  const form = useFormsStore((s) => s.getFormById(formId));
  const [successMessage, setSuccessMessage] = useState(form?.successMessage ?? '');
  const [notificationEmail, setNotificationEmail] = useState(form?.notificationEmail ?? '');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuccessMessage(form?.successMessage ?? '');
    setNotificationEmail(form?.notificationEmail ?? '');
  }, [form?.id, form?.successMessage, form?.notificationEmail]);

  if (forms.length === 0) {
    return <NoFormsHint />;
  }

  const save = async () => {
    if (!form) return;
    await updateForm(form.id, {
      successMessage: successMessage.trim() || 'Thanks for your submission!',
      notificationEmail: notificationEmail.trim() || undefined,
    });
    showToast('Default form settings saved.', 'info');
  };

  return (
    <div className="ui-card forms-section">
      <p className="forms-section-title">
        <Settings2 /> Form defaults
      </p>
      <p className="forms-section-hint">
        Applied to the selected form. New forms inherit the built-in default success message until you change it here.
      </p>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Form</label>
        <select className="ui-input forms-select" value={formId ?? ''} onChange={(e) => setActiveFormId(e.target.value)}>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Default success message</label>
        <textarea
          className="ui-input forms-textarea"
          value={successMessage}
          onChange={(e) => setSuccessMessage(e.target.value)}
          placeholder="Thanks for your submission!"
        />
      </div>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Default notification email</label>
        <input
          className="ui-input forms-input"
          type="email"
          value={notificationEmail}
          onChange={(e) => setNotificationEmail(e.target.value)}
          placeholder="you@company.com"
        />
        <span className="forms-field-group-hint">Where new submission notifications are sent (future backend feature).</span>
      </div>
      <div className="forms-actions">
        <button type="button" className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary" onClick={save}>
          <Save /> Save defaults
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spam protection                                                    */
/* ------------------------------------------------------------------ */

function SpamSection() {
  const [honeypot, setHoneypot] = useState(true);
  return (
    <div className="forms-stack">
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <ShieldCheck /> Honeypot field
        </p>
        <p className="forms-section-hint">
          A hidden honeypot field is added to every form. Bots that fill it are flagged with a high spam score.
        </p>
        <label className={`forms-toggle${!honeypot ? ' forms-toggle--disabled' : ''}`}>
          <span
            className={`forms-toggle-track${honeypot ? ' forms-toggle-track--on' : ''}`}
            onClick={() => setHoneypot((v) => !v)}
            role="switch"
            aria-checked={honeypot}
          >
            <span className="forms-toggle-thumb" />
          </span>
          <span>Honeypot enabled (recommended)</span>
        </label>
        <span className="forms-field-group-hint">
          Enforced at ingestion time (submissionService.computeSpamScore). Toggle is a UI preference.
        </span>
      </div>

      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <ShieldCheck /> Rate limiting
        </p>
        <p className="forms-section-hint">
          Per-IP / per-domain submission throttling is enforced on the future public VPS endpoint, not the local app.
        </p>
        <input className="ui-input forms-input" disabled placeholder="Future backend rate-limit config" />
      </div>

      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <ShieldCheck /> CAPTCHA
        </p>
        <p className="forms-section-hint">
          CAPTCHA integration is deferred. The honeypot + allowed-domain + spam-score heuristics cover MVP spam protection.
        </p>
        <input className="ui-input forms-input" disabled placeholder="CAPTCHA provider — coming later" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

function NotificationsSection() {
  const forms = useFormsStore((s) => s.forms);
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const updateForm = useFormsStore((s) => s.updateForm);
  const showToast = useUIStore((s) => s.showToast);

  const formId = activeFormId ?? forms[0]?.id ?? null;
  const form = useFormsStore((s) => s.getFormById(formId));
  const [email, setEmail] = useState(form?.notificationEmail ?? '');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail(form?.notificationEmail ?? '');
  }, [form?.id, form?.notificationEmail]);

  if (forms.length === 0) return <NoFormsHint />;

  const save = async () => {
    if (!form) return;
    await updateForm(form.id, { notificationEmail: email.trim() || undefined });
    showToast('Notification email saved.', 'info');
  };

  return (
    <div className="ui-card forms-section">
      <p className="forms-section-title">
        <Bell /> Notifications
      </p>
      <p className="forms-section-hint">
        Notification email is stored per form. Actual email delivery is a future backend feature.
      </p>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Form</label>
        <select className="ui-input forms-select" value={formId ?? ''} onChange={(e) => setActiveFormId(e.target.value)}>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Notification email</label>
        <input
          className="ui-input forms-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </div>
      <div className="forms-actions">
        <button type="button" className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary" onClick={save}>
          <Save /> Save
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                           */
/* ------------------------------------------------------------------ */

function WebhooksSection() {
  const forms = useFormsStore((s) => s.forms);
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const webhooks = useFormsStore((s) => s.webhooks);
  const createWebhook = useFormsStore((s) => s.createWebhook);
  const updateWebhook = useFormsStore((s) => s.updateWebhook);
  const deleteWebhook = useFormsStore((s) => s.deleteWebhook);
  const showToast = useUIStore((s) => s.showToast);

  const formId = activeFormId ?? forms[0]?.id ?? null;
  const formWebhooks = useMemo(() => webhooks.filter((w) => w.formId === formId), [webhooks, formId]);

  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');

  if (forms.length === 0) return <NoFormsHint />;

  const addWebhook = async () => {
    if (!formId) return;
    if (!url.trim()) {
      showToast('Enter a webhook URL.', 'error');
      return;
    }
    const created = await createWebhook({
      formId,
      url: url.trim(),
      secret: secret.trim() || '',
      enabled: true,
    });
    if (created) {
      setUrl('');
      setSecret('');
      showToast('Webhook added.', 'info');
    }
  };

  return (
    <div className="ui-card forms-section">
      <div className="forms-spread">
        <p className="forms-section-title">
          <Webhook /> Webhooks
        </p>
        <span className="forms-section-hint">
          {/* CRM_FORMS_WEBHOOK_DELIVERY_TODO lives in the file header */}
          Delivery/retry/logging is deferred (see CRM_FORMS_WEBHOOK_DELIVERY_TODO).
        </span>
      </div>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Form</label>
        <select className="ui-input forms-select" value={formId ?? ''} onChange={(e) => setActiveFormId(e.target.value)}>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {/* Existing webhooks */}
      {formWebhooks.length === 0 ? (
        <p className="forms-section-hint">No webhooks for this form yet.</p>
      ) : (
        formWebhooks.map((w) => (
          <div className="forms-webhook-row" key={w.id}>
            <input
              className="ui-input forms-input"
              value={w.url}
              onChange={(e) => void updateWebhook(w.id, { url: e.target.value })}
              placeholder="https://example.com/webhook"
            />
            <input
              className="ui-input forms-input"
              value={w.secret}
              onChange={(e) => void updateWebhook(w.id, { secret: e.target.value })}
              placeholder="Signing secret"
            />
            <label className="forms-toggle">
              <span
                className={`forms-toggle-track${w.enabled ? ' forms-toggle-track--on' : ''}`}
                onClick={() => void updateWebhook(w.id, { enabled: !w.enabled })}
                role="switch"
                aria-checked={w.enabled}
              >
                <span className="forms-toggle-thumb" />
              </span>
            </label>
            <button
              type="button"
              className="ui-icon-button forms-action-btn forms-action-btn--ghost ui-button--danger forms-action-btn--danger"
              onClick={() => void deleteWebhook(w.id)}
              title="Delete webhook"
            >
              <Trash2 />
            </button>
          </div>
        ))
      )}

      <div className="forms-divider" />
      <p className="forms-section-title" style={{ fontSize: 'var(--fs-xs)' }}>Add webhook</p>
      <div className="forms-webhook-row" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
        <input
          className="ui-input forms-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
        />
        <input
          className="ui-input forms-input"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Signing secret"
        />
        <button type="button" className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary" onClick={addWebhook}>
          <Plus /> Add
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* File uploads (disabled)                                            */
/* ------------------------------------------------------------------ */

function FileUploadsSection() {
  return (
    <div className="ui-card forms-section" style={{ opacity: 0.85 }}>
      <p className="forms-section-title">
        <Upload /> File uploads
      </p>
      {/* CRM_FORMS_FILE_UPLOAD_TODO lives in the file header */}
      <p className="forms-section-hint">
        File upload fields can be configured in the form builder, but live upload storage is not enabled yet.
        Published embeds render file fields disabled until VPS storage is connected.
      </p>
      <input className="ui-input forms-input" disabled placeholder="Storage backend — not connected" />
      <input className="ui-input forms-input" disabled placeholder="Max file size — future VPS config" />
      <input className="ui-input forms-input" disabled placeholder="Allowed MIME types — future VPS config" />
      <span className="forms-field-group-hint">
        See CRM_FORMS_FILE_UPLOAD_TODO for the future VPS work (object/server storage, signed upload URLs,
        MIME validation, size limits, security scanning, attachment linking).
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Embed security                                                     */
/* ------------------------------------------------------------------ */

function EmbedSecuritySection() {
  const forms = useFormsStore((s) => s.forms);
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const updateForm = useFormsStore((s) => s.updateForm);
  const showToast = useUIStore((s) => s.showToast);

  const formId = activeFormId ?? forms[0]?.id ?? null;
  const form = useFormsStore((s) => s.getFormById(formId));
  const [newDomain, setNewDomain] = useState('');

  if (forms.length === 0) return <NoFormsHint />;

  const allowedDomains = form?.embed.allowedDomains ?? [];

  const addDomain = async () => {
    if (!form) return;
    const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d) return;
    if (allowedDomains.includes(d)) {
      showToast('Domain already allowed.', 'error');
      return;
    }
    await updateForm(form.id, {
      embed: { ...form.embed, allowedDomains: [...allowedDomains, d] },
    });
    setNewDomain('');
  };

  const removeDomain = async (d: string) => {
    if (!form) return;
    await updateForm(form.id, {
      embed: { ...form.embed, allowedDomains: allowedDomains.filter((x) => x !== d) },
    });
  };

  return (
    <div className="ui-card forms-section">
      <p className="forms-section-title">
        <Lock /> Embed security
      </p>
      <p className="forms-section-hint">
        Allowed domains are configured per form. Leave empty to allow any domain (not recommended). Enforcement
        runs on the future public VPS endpoint (see CRM_FORMS_PUBLIC_CAPTURE_TODO).
      </p>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Form</label>
        <select className="ui-input forms-select" value={formId ?? ''} onChange={(e) => setActiveFormId(e.target.value)}>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field forms-field-group">
        <label className="forms-field-group-label">Allowed domains</label>
        <div className="forms-domains-editor">
          <Globe className="forms-muted" />
          {allowedDomains.length === 0 ? (
            <span className="forms-field-group-hint">Unrestricted (any domain)</span>
          ) : (
            allowedDomains.map((d) => (
              <span className="forms-domain-chip" key={d}>
                {d}
                <button className="ui-icon-button" type="button" onClick={() => void removeDomain(d)} title="Remove">
                  <Trash2 />
                </button>
              </span>
            ))
          )}
          <div className="forms-domains-add">
            <input className="ui-input"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addDomain();
              }}
              placeholder="example.com"
            />
            <button type="button" className="ui-button forms-action-btn forms-action-btn--ghost" onClick={addDomain}>
              <Plus /> Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function ExportSection() {
  const forms = useFormsStore((s) => s.forms);
  const submissions = useFormsStore((s) => s.submissions);
  const exportSubmissions = useFormsStore((s) => s.exportSubmissions);
  const showToast = useUIStore((s) => s.showToast);
  const setCrmMode = useUIStore((s) => s.setCrmMode);
  const setActiveCRMPage = useUIStore((s) => s.setActiveCRMPage);
  const [exportFormId, setExportFormId] = useState<string>('all');

  const handleExport = async () => {
    await exportSubmissions(exportFormId === 'all' ? undefined : exportFormId);
    showToast('Submissions exported to CSV.', 'info');
  };

  const openCrmSettings = () => {
    setActiveCRMPage('settings');
    setCrmMode(true);
  };

  return (
    <div className="forms-stack">
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <Download /> Submission export
        </p>
        <p className="forms-section-hint">
          Export submissions to a CSV file (RFC 4180 compliant, BOM-prefixed for Excel). Submitted fields are
          flattened under a <code>field_*</code> prefix and UTM/source data under <code>utm_*</code>.
        </p>
        <div className="ui-field forms-field-group">
          <label className="forms-field-group-label">Scope</label>
          <select className="ui-input forms-select" value={exportFormId} onChange={(e) => setExportFormId(e.target.value)}>
            <option value="all">All forms ({submissions.length} submissions)</option>
            {forms.map((f) => {
              const count = submissions.filter((s) => s.formId === f.id).length;
              return (
                <option key={f.id} value={f.id}>
                  {f.name} ({count})
                </option>
              );
            })}
          </select>
        </div>
        <div className="forms-actions">
          <button
            type="button"
            className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary"
            onClick={handleExport}
            disabled={submissions.length === 0}
          >
            <Download /> Export CSV
          </button>
        </div>
      </div>

      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <Download /> Leads export
        </p>
        <p className="forms-section-hint">
          Leads live in the CRM module. Use CRM Settings to export leads (contacts + companies + lead fields) to CSV.
        </p>
        <div className="forms-actions">
          <button type="button" className="ui-button forms-action-btn" onClick={openCrmSettings}>
            Open CRM Settings <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared                                                             */
/* ------------------------------------------------------------------ */

function NoFormsHint() {
  return (
    <div className="ui-card forms-section">
      <p className="forms-section-title">No forms available</p>
      <p className="forms-section-hint">Create a form first to configure its settings here.</p>
    </div>
  );
}
