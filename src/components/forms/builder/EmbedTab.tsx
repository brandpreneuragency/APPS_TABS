import { useState } from 'react';
import {
  Upload,
  Archive,
  RotateCcw,
  Plus,
  Trash2,
  Globe,
  Code2,
  Eye,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import type { LeadForm, FormStatus } from '../../../types/forms';
import { useFormsStore } from '../../../stores/formsStore';
import { buildSnippet } from '../../../services/embedService';
import { EmbedSnippetTabs } from './components/EmbedSnippetTabs';
import './embedTab.css';

interface EmbedTabProps {
  form: LeadForm;
}

// Basic domain format: accepts host.tld and sub.host.tld, no protocol/path.
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

function extractIframeSrc(code: string): string | null {
  const match = code.match(/src="([^"]+)"/);
  return match ? match[1] : null;
}

function statusBadgeClass(status: FormStatus): string {
  if (status === 'published') return 'forms-builder-embed-status-badge--published';
  if (status === 'archived') return 'forms-builder-embed-status-badge--archived';
  return 'forms-builder-embed-status-badge--draft';
}

export default function EmbedTab({ form }: EmbedTabProps) {
  const updateForm = useFormsStore((s) => s.updateForm);
  const publishForm = useFormsStore((s) => s.publishForm);
  const archiveForm = useFormsStore((s) => s.archiveForm);

  const [newDomain, setNewDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);

  const allowedDomains = form.embed.allowedDomains ?? [];

  const addDomain = () => {
    const trimmed = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!trimmed) return;
    if (!DOMAIN_RE.test(trimmed)) {
      setDomainError('Enter a valid domain (e.g. example.com or sub.example.com).');
      return;
    }
    if (allowedDomains.includes(trimmed)) {
      setDomainError('Domain already in the allow list.');
      return;
    }
    setDomainError(null);
    setNewDomain('');
    void updateForm(form.id, {
      embed: { ...form.embed, allowedDomains: [...allowedDomains, trimmed] },
    });
  };

  const removeDomain = (domain: string) => {
    void updateForm(form.id, {
      embed: { ...form.embed, allowedDomains: allowedDomains.filter((d) => d !== domain) },
    });
  };

  const handleRevertToDraft = () => {
    void updateForm(form.id, { status: 'draft' });
  };

  // Build the iframe snippet synchronously to derive the preview src URL.
  const iframeSnippet = buildSnippet(form.id, 'iframe', form);
  const previewSrc = extractIframeSrc(iframeSnippet.code);

  return (
    <div className="ui-panel-body forms-builder-embed">
      {/* ---------- Publish state ---------- */}
      <section className="ui-card forms-builder-embed-section">
        <div className="forms-builder-embed-section-head">
          <span className="forms-builder-embed-section-title">
            <Upload className="forms-builder-embed-section-title-icon" />
            Publish State
          </span>
        </div>
        <p className="forms-builder-embed-section-hint">
          Drafts are editable but not embeddable. Published forms are live via embed snippets.
          Archived forms stop accepting submissions.
        </p>
        <div className="forms-builder-embed-status">
          <span className={`forms-builder-embed-status-badge ${statusBadgeClass(form.status)}`}>
            <span className="forms-builder-embed-status-dot" />
            {form.status}
          </span>
          <div className="forms-builder-embed-status-actions">
            <button
              type="button"
              className="ui-button forms-builder-embed-btn ui-button--primary forms-builder-embed-btn--primary"
              onClick={() => void publishForm(form.id)}
              disabled={form.status === 'published'}
            >
              <Upload /> Publish
            </button>
            <button
              type="button"
              className="ui-button forms-builder-embed-btn"
              onClick={handleRevertToDraft}
              disabled={form.status === 'draft'}
            >
              <RotateCcw /> Revert to Draft
            </button>
            <button
              type="button"
              className="ui-button forms-builder-embed-btn ui-button--danger forms-builder-embed-btn--danger"
              onClick={() => void archiveForm(form.id)}
              disabled={form.status === 'archived'}
            >
              <Archive /> Archive
            </button>
          </div>
        </div>
      </section>

      {/* ---------- Allowed domains ---------- */}
      <section className="ui-card forms-builder-embed-section">
        <div className="forms-builder-embed-section-head">
          <span className="forms-builder-embed-section-title">
            <Globe className="forms-builder-embed-section-title-icon" />
            Allowed Domains
            <span className="forms-builder-logic-section-count">{allowedDomains.length}</span>
          </span>
        </div>
        <p className="forms-builder-embed-section-hint">
          Restrict which domains may embed this form. Leave empty for unrestricted (not recommended
          for production).
        </p>
        <div className="forms-builder-embed-domains-list">
          {allowedDomains.length === 0 ? (
            <div className="forms-builder-logic-empty" style={{ padding: '14px 12px' }}>
              <Globe />
              <span className="forms-builder-logic-empty-sub">
                No allow list — form can be embedded anywhere.
              </span>
            </div>
          ) : (
            allowedDomains.map((domain) => (
              <div key={domain} className="forms-builder-embed-domain-row">
                <input
                  type="text"
                  className="ui-input forms-builder-embed-domain-input"
                  value={domain}
                  readOnly
                />
                <button
                  type="button"
                  className="ui-icon-button forms-builder-embed-domain-remove"
                  onClick={() => removeDomain(domain)}
                  aria-label={`Remove ${domain}`}
                  title="Remove domain"
                >
                  <Trash2 />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="forms-builder-embed-domain-row" style={{ marginTop: 4 }}>
          <input
            type="text"
            className={"ui-input " + (`forms-builder-embed-domain-input${domainError ? ' forms-builder-embed-domain-input--invalid' : ''}`)}
            value={newDomain}
            placeholder="add domain, e.g. example.com"
            onChange={(e) => {
              setNewDomain(e.target.value);
              if (domainError) setDomainError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
              }
            }}
          />
          <button type="button" className="ui-button forms-builder-embed-domain-add" onClick={addDomain}>
            <Plus /> Add
          </button>
        </div>
        {domainError && <span className="forms-builder-embed-domain-error">{domainError}</span>}
      </section>

      {/* ---------- Embed options (snippet tabs) ---------- */}
      <section className="ui-card forms-builder-embed-section">
        <div className="forms-builder-embed-section-head">
          <span className="forms-builder-embed-section-title">
            <Code2 className="forms-builder-embed-section-title-icon" />
            Embed Snippets
          </span>
        </div>
        <p className="forms-builder-embed-section-hint">
          Four snippet formats are generated. Iframe is the default. Copy and paste into your site.
        </p>
        <EmbedSnippetTabs formId={form.id} />
      </section>

      {/* ---------- Preview ---------- */}
      <section className="ui-card forms-builder-embed-section">
        <div className="forms-builder-embed-section-head">
          <span className="forms-builder-embed-section-title">
            <Eye className="forms-builder-embed-section-title-icon" />
            Live Preview
          </span>
          {previewSrc && (
            <a
              className="ui-button forms-builder-embed-btn"
              href={previewSrc}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink /> Open
            </a>
          )}
        </div>
        <p className="forms-builder-embed-preview-note">
          <ShieldAlert style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Preview uses the public embed URL. Until the public capture endpoint exists, the iframe
          will not render a real form.
        </p>
        {/* CRM_FORMS_PUBLIC_CAPTURE_TODO:
            The embed snippets are generated now, but production lead capture requires
            a public VPS/API endpoint. Future backend agent must implement public form
            rendering, allowed-domain validation, CORS policy, rate limiting, spam checks,
            submission persistence, duplicate matching, and CRM lead creation. */}
        <div className="forms-builder-embed-preview">
          <div className="forms-builder-embed-preview-head">
            <span>Iframe preview</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', textTransform: 'none' }}>
              {previewSrc ?? '—'}
            </span>
          </div>
          <iframe
            className="forms-builder-embed-preview-frame"
            src={previewSrc ?? 'about:blank'}
            title="Embed preview"
            sandbox="allow-scripts allow-forms allow-same-origin"
          />
        </div>
      </section>
    </div>
  );
}
