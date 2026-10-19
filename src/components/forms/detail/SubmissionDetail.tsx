import { useMemo } from 'react';
import type { LeadForm, LeadFormSubmission } from '../../../types/forms';
import { useFormsStore } from '../../../stores/formsStore';
import { useCrmStore } from '../../../stores/crmStore';
import { useUIStore } from '../../../stores/uiStore';
import { SpamBadge } from '../components/SpamBadge';
import {
  User,
  Building2,
  Target,
  ShieldOff,
  CheckCircle2,
  ExternalLink,
  Mail,
  Phone,
  Calendar,
  ClipboardList,
  Globe,
} from 'lucide-react';
import '../forms.css';

interface SubmissionDetailProps {
  submission: LeadFormSubmission;
  form?: LeadForm;
}

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'landing_page',
  'page_url',
  'device_type',
  'submitted_at',
] as const;

function asDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SubmissionDetail({ submission, form }: SubmissionDetailProps) {
  const setSubmissionStatus = useFormsStore((s) => s.setSubmissionStatus);
  const showToast = useUIStore((s) => s.showToast);
  const setCrmMode = useUIStore((s) => s.setCrmMode);
  const setActiveCRMPage = useUIStore((s) => s.setActiveCRMPage);
  const setActiveLeadId = useCrmStore((s) => s.setActiveLeadId);
  const setActiveContactId = useCrmStore((s) => s.setActiveContactId);
  const setActiveCompanyId = useCrmStore((s) => s.setActiveCompanyId);
  const lead = useCrmStore((s) => (submission.leadId ? s.getLeadById(submission.leadId) : undefined));
  const contact = useCrmStore((s) =>
    submission.contactId ? s.getContactById(submission.contactId) : undefined,
  );
  const company = useCrmStore((s) =>
    submission.companyId ? s.getCompanyById(submission.companyId) : undefined,
  );

  const fieldLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    if (form) {
      for (const f of form.fields) {
        if (f.type === 'submit') continue;
        map.set(f.name, f.label);
      }
    }
    return map;
  }, [form]);

  const submittedEntries = useMemo(() => {
    return Object.entries(submission.fields)
      .filter(([name]) => {
        const lower = name.toLowerCase();
        return lower !== 'submit' && lower !== 'consent';
      })
      .map(([name, value]) => ({
        name,
        label: fieldLabelMap.get(name) ?? name,
        value: asDisplay(value),
      }))
      .filter((e) => e.value !== '');
  }, [submission.fields, fieldLabelMap]);

  const consentValue = asDisplay(submission.fields['consent']);

  const utmEntries = useMemo(() => {
    return UTM_KEYS.map((key) => ({
      key,
      value: asDisplay((submission.hiddenFields as Record<string, unknown>)[key]),
    })).filter((e) => e.value !== '');
  }, [submission.hiddenFields]);

  const openLead = () => {
    if (!submission.leadId) return;
    setActiveLeadId(submission.leadId);
    setActiveCRMPage('leads');
    setCrmMode(true);
  };
  const openContact = () => {
    if (!submission.contactId) return;
    setActiveContactId(submission.contactId);
    setActiveCRMPage('contacts');
    setCrmMode(true);
  };
  const openCompany = () => {
    if (!submission.companyId) return;
    setActiveCompanyId(submission.companyId);
    setActiveCRMPage('companies');
    setCrmMode(true);
  };

  const handleConvert = () => {
    // CRM_FORMS_SUBMISSION_CONVERT_TODO:
    // Marking a submission 'converted' here only flips its status flag.
    // The actual CRM lead/contact/company merge + duplicate resolution
    // runs at ingestion time (submissionService.ingestSubmission). A manual
    // re-merge / re-create UI is future server-side work (see CRM_FORMS_PUBLIC_CAPTURE_TODO).
    void setSubmissionStatus(submission.id, 'converted');
    showToast('Submission marked as converted.', 'info');
  };

  const handleMarkSpam = () => {
    void setSubmissionStatus(submission.id, 'spam');
    showToast('Submission marked as spam.', 'info');
  };

  const handleFollowUpTask = () => {
    // CRM_FORMS_FOLLOWUP_TASK_TODO:
    // Bridging a form submission into a Tasks-module follow-up task is not
    // wired yet. The Tasks and Forms modules use separate stores; a future
    // agent should add a createFollowUpTask bridge (taskStore.createTask with
    // a CRM task link via crmStore.linkTask).
    showToast('Follow-up task creation bridges to the Tasks module (future).', 'info');
  };

  const formName = form?.name ?? submission.formId;

  return (
    <div className="ui-panel-body forms-page forms-page--scroll" >
      <div className="forms-spread">
        <div className="forms-stack" style={{ gap: 2 }}>
          <span className="forms-page-title">{formName}</span>
          <span className="forms-section-hint">
            Submitted {timeLabel(submission.createdAt)}
          </span>
        </div>
        <SpamBadge spamScore={submission.spamScore} />
      </div>

      <div className="forms-actions">
        <button
          type="button"
          className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary"
          onClick={handleConvert}
          disabled={submission.status === 'converted'}
        >
          <CheckCircle2 />
          Convert / merge
        </button>
        <button
          type="button"
          className="ui-button forms-action-btn ui-button--danger forms-action-btn--danger"
          onClick={handleMarkSpam}
          disabled={submission.status === 'spam'}
        >
          <ShieldOff />
          Mark spam
        </button>
        <button type="button" className="ui-button forms-action-btn" onClick={handleFollowUpTask}>
          <ClipboardList />
          Create follow-up task
        </button>
      </div>

      {/* Linked CRM records */}
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <User /> Linked CRM records
        </p>
        <div className="forms-link-chips">
          {lead ? (
            <button type="button" className="ui-button forms-link-chip" onClick={openLead} title="Open lead in CRM">
              <Target /> Lead: {lead.title}
              <ExternalLink />
            </button>
          ) : (
            <span className="ui-button forms-link-chip forms-link-chip--muted">No linked lead</span>
          )}
          {contact ? (
            <button type="button" className="ui-button forms-link-chip" onClick={openContact} title="Open contact in CRM">
              <User /> {contact.firstName} {contact.lastName}
              <ExternalLink />
            </button>
          ) : (
            <span className="ui-button forms-link-chip forms-link-chip--muted">No linked contact</span>
          )}
          {company ? (
            <button type="button" className="ui-button forms-link-chip" onClick={openCompany} title="Open company in CRM">
              <Building2 /> {company.name}
              <ExternalLink />
            </button>
          ) : (
            <span className="ui-button forms-link-chip forms-link-chip--muted">No linked company</span>
          )}
        </div>
        {contact ? (
          <div className="forms-row forms-row--wrap" style={{ gap: 12, marginTop: 2 }}>
            {contact.email ? (
              <span className="forms-list-item-meta">
                <Mail /> {contact.email}
              </span>
            ) : null}
            {contact.phone ? (
              <span className="forms-list-item-meta">
                <Phone /> {contact.phone}
              </span>
            ) : null}
            {contact.jobTitle ? <span className="forms-list-item-meta">{contact.jobTitle}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Spam + domain result */}
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <Globe /> Source & spam
        </p>
        <div className="forms-field-row">
          <span className="forms-field-label">Source domain</span>
          <span className="forms-field-value">
            {submission.sourceDomain ? (
              submission.sourceDomain
            ) : (
              <span className="forms-field-value--muted">Unknown</span>
            )}
          </span>
        </div>
        <div className="forms-field-row">
          <span className="forms-field-label">Allowed domain match</span>
          <span className="forms-field-value">
            {submission.allowedDomainMatched ? (
              <span style={{ color: 'var(--c-success)' }}>Yes — matched an allowed domain</span>
            ) : submission.allowedDomainMatched === false ? (
              <span style={{ color: 'var(--c-warning)' }}>No — did not match an allowed domain</span>
            ) : (
              <span className="forms-field-value--muted">Not checked</span>
            )}
          </span>
        </div>
        <div className="forms-field-row">
          <span className="forms-field-label">Spam score</span>
          <span className="forms-field-value">
            <SpamBadge spamScore={submission.spamScore} />
          </span>
        </div>
        {submission.honeypot ? (
          <div className="forms-field-row">
            <span className="forms-field-label">Honeypot</span>
            <span className="forms-field-value" style={{ color: 'var(--c-danger)' }}>
              Triggered
            </span>
          </div>
        ) : null}
      </div>

      {/* Submitted fields */}
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <Mail /> Submitted fields
        </p>
        {submittedEntries.length === 0 ? (
          <p className="forms-section-hint">No visible field values.</p>
        ) : (
          submittedEntries.map((entry) => (
            <div className="forms-field-row" key={entry.name}>
              <span className="forms-field-label">{entry.label}</span>
              <span className="forms-field-value">{entry.value}</span>
            </div>
          ))
        )}
        {consentValue ? (
          <div className="forms-field-row">
            <span className="forms-field-label">Consent</span>
            <span className="forms-field-value">{consentValue}</span>
          </div>
        ) : null}
      </div>

      {/* UTM / source attribution */}
      <div className="ui-card forms-section">
        <p className="forms-section-title">
          <Calendar /> UTM & source attribution
        </p>
        {utmEntries.length === 0 ? (
          <p className="forms-section-hint">No UTM or source data captured.</p>
        ) : (
          utmEntries.map((entry) => (
            <div className="forms-field-row" key={entry.key}>
              <span className="forms-field-label">{entry.key}</span>
              <span className="forms-field-value forms-field-value--mono">{entry.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
