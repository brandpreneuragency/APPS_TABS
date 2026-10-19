import { useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  Globe,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  User,
} from 'lucide-react';
import type { CRMLead } from '../../../types/crm';
import { useCrmStore } from '../../../stores/crmStore';
import { useFormsStore } from '../../../stores/formsStore';
import {
  ActivityTimeline,
  CRMEmptyState,
  CRMNoteInput,
  CRMTabBar,
  ScoreBadge,
  StatusBadge,
  TagChips,
  formatDate,
  formatRelative,
  fullName,
} from '../components';

const LEAD_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'notes', label: 'Notes' },
  { id: 'activity', label: 'Activity' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'formdata', label: 'Form Data' },
  { id: 'emails', label: 'Emails' },
];

interface LeadDetailProps {
  lead: CRMLead;
}

export function LeadDetail({ lead }: LeadDetailProps) {
  const {
    contacts,
    companies,
    notes,
    activities,
    taskLinks,
    addNote,
    updateLead,
  } = useCrmStore();

  const { submissions, getFormById } = useFormsStore();

  const [tab, setTab] = useState<string>('overview');

  const contact = lead.contactId ? contacts.find((c) => c.id === lead.contactId) : undefined;
  const company = lead.companyId ? companies.find((c) => c.id === lead.companyId) : undefined;

  const leadNotes = useMemo(
    () => notes.filter((n) => n.leadId === lead.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [notes, lead.id],
  );
  const leadActivities = useMemo(
    () => activities.filter((a) => a.leadId === lead.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [activities, lead.id],
  );
  const leadTaskLinks = useMemo(() => taskLinks.filter((t) => t.leadId === lead.id), [taskLinks, lead.id]);
  const emailActivities = useMemo(
    () => leadActivities.filter((a) => a.type === 'email_sent' || a.type === 'email_opened'),
    [leadActivities],
  );

  const submission = lead.sourceSubmissionId ? submissions.find((s) => s.id === lead.sourceSubmissionId) : undefined;
  const sourceForm = lead.sourceFormId ? getFormById(lead.sourceFormId) : undefined;

  return (
    <div className="crm-page">
      <div className="ui-card crm-page-header">
        <div className="crm-page-header-main">
          <div className="crm-page-header-title">{lead.title}</div>
          <div className="crm-page-header-meta">
            {contact && (
              <span className="crm-page-header-meta-item">
                <User /> {fullName(contact.firstName, contact.lastName)}
              </span>
            )}
            {company && (
              <span className="crm-page-header-meta-item">
                <Building2 /> {company.name}
              </span>
            )}
            <span className="crm-page-header-meta-item">Stage: <StatusBadge stage={lead.stage} /></span>
            <span className="crm-page-header-meta-item">Score: <ScoreBadge score={lead.score} compact /></span>
          </div>
        </div>
        <div className="crm-page-header-actions">
          <button
            type="button"
            className="ui-icon-button crm-btn crm-btn--ghost crm-btn--sm"
            title="Edit lead"
            aria-label="Edit lead"
            onClick={() => {
              const next = window.prompt('Lead title', lead.title);
              if (next && next.trim() && next.trim() !== lead.title) {
                void updateLead(lead.id, { title: next.trim() });
              }
            }}
          >
            <Pencil />
          </button>
        </div>
      </div>

      <CRMTabBar tabs={LEAD_TABS} active={tab} onChange={setTab} />

      <div className="ui-panel-body crm-page-body">
        {tab === 'overview' && (
          <>
            {contact ? (
              <div className="ui-card crm-card">
                <div className="crm-card-title">Contact</div>
                <div className="crm-detail-grid">
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">First name</span>
                    <span className="crm-detail-field-value">{contact.firstName}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Last name</span>
                    <span className="crm-detail-field-value">{contact.lastName}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Email</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">
                      {contact.email ? (
                        <span className="crm-detail-field-row"><Mail /> {contact.email}</span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Phone</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">
                      {contact.phone ? (
                        <span className="crm-detail-field-row"><Phone /> {contact.phone}</span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Job title</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">
                      {contact.jobTitle ? (
                        <span className="crm-detail-field-row"><Briefcase /> {contact.jobTitle}</span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Lifecycle status</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{contact.lifecycleStatus ?? '—'}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Tags</span>
                    <span className="crm-detail-field-value">
                      {contact.tags.length > 0 ? <TagChips tags={contact.tags} max={6} /> : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Created</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{formatDate(contact.createdAt)}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Last activity</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{formatRelative(contact.lastActivityAt)}</span>
                  </div>
                </div>
                {contact.notes && (
                  <>
                    <div className="crm-card-title" style={{ marginTop: 4 }}>Contact notes</div>
                    <div className="crm-muted-block">{contact.notes}</div>
                  </>
                )}
              </div>
            ) : (
              <div className="ui-card crm-card">
                <div className="crm-card-title">Contact</div>
                <div className="crm-muted-block">No contact linked to this lead.</div>
              </div>
            )}

            {company ? (
              <div className="ui-card crm-card">
                <div className="crm-card-title">Company</div>
                <div className="crm-detail-grid">
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Name</span>
                    <span className="crm-detail-field-value">{company.name}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Website</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">
                      {company.website ? (
                        <span className="crm-detail-field-row"><Globe /> {company.website}</span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Industry</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{company.industry ?? '—'}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Size</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{company.size ?? '—'}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Location</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">
                      {(company.city || company.country) ? (
                        <span className="crm-detail-field-row">
                          <MapPin /> {[company.city, company.country].filter(Boolean).join(', ')}
                        </span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Owner</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{company.ownerId ?? '—'}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Tags</span>
                    <span className="crm-detail-field-value">
                      {company.tags.length > 0 ? <TagChips tags={company.tags} max={6} /> : '—'}
                    </span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Created</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{formatDate(company.createdAt)}</span>
                  </div>
                  <div className="crm-detail-field">
                    <span className="crm-detail-field-label">Last activity</span>
                    <span className="crm-detail-field-value crm-detail-field-value--muted">{formatRelative(company.lastActivityAt)}</span>
                  </div>
                </div>
                {company.notes && (
                  <>
                    <div className="crm-card-title" style={{ marginTop: 4 }}>Company notes</div>
                    <div className="crm-muted-block">{company.notes}</div>
                  </>
                )}
              </div>
            ) : (
              <div className="ui-card crm-card">
                <div className="crm-card-title">Company</div>
                <div className="crm-muted-block">No company linked to this lead.</div>
              </div>
            )}

          </>
        )}

        {tab === 'notes' && (
          <div className="crm-stacked">
            {leadNotes.length === 0 ? (
              <div className="crm-muted-block">No notes yet. Add one below.</div>
            ) : (
              leadNotes.map((note) => (
                <div key={note.id} className="ui-card crm-card">
                  <div className="crm-card-header">
                    <span className="crm-card-title">{note.createdBy ?? 'You'}</span>
                    <span className="crm-list-item-sub">{formatRelative(note.createdAt)}</span>
                  </div>
                  <div className="crm-card-body">{note.body}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'activity' && (
          <ActivityTimeline activities={leadActivities} emptyText="No activity recorded for this lead." />
        )}

        {tab === 'tasks' && (
          <div className="crm-stacked">
            {leadTaskLinks.length === 0 ? (
              <div className="crm-muted-block">No tasks linked to this lead yet.</div>
            ) : (
              leadTaskLinks.map((link) => (
                <div key={link.id} className="ui-card crm-card">
                  <div className="crm-card-header">
                    <span className="crm-card-title">
                      <Link2 /> Task {link.taskId}
                    </span>
                    <span className="crm-list-item-sub">{formatRelative(link.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
            <button type="button" className="ui-button crm-btn crm-btn--ghost crm-btn--sm" disabled title="Linking creation is a placeholder for now.">
              <Plus /> Link a task
            </button>
          </div>
        )}

        {tab === 'formdata' && (
          <div className="crm-stacked">
            {submission ? (
              <div className="ui-card crm-card">
                <div className="crm-card-title">Submission · {submission.id}</div>
                <div className="crm-list-item-sub" style={{ marginBottom: 6 }}>
                  {sourceForm?.name ?? lead.sourceFormId ?? '—'} · {formatDate(submission.createdAt)}
                </div>
                <div className="crm-detail-grid">
                  {Object.entries(submission.fields).map(([k, v]) => (
                    <div className="crm-detail-field" key={k}>
                      <span className="crm-detail-field-label">{k}</span>
                      <span className="crm-detail-field-value crm-detail-field-value--muted">
                        {v === null || v === undefined ? '—' : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
                {Object.keys(submission.hiddenFields ?? {}).length > 0 && (
                  <>
                    <div className="crm-card-title" style={{ marginTop: 6 }}>Hidden / UTM capture</div>
                    <div className="crm-detail-grid">
                      {Object.entries(submission.hiddenFields)
                        .filter(([, v]) => v !== undefined && v !== '')
                        .map(([k, v]) => (
                          <div className="crm-detail-field" key={k}>
                            <span className="crm-detail-field-label">{k}</span>
                            <span className="crm-detail-field-value crm-detail-field-value--muted">{String(v)}</span>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <CRMEmptyState icon={Mail} title="No source submission" subtitle="This lead was not created from a form submission." />
            )}
          </div>
        )}

        {tab === 'emails' && (
          <div className="crm-stacked">
            {emailActivities.length === 0 ? (
              <CRMEmptyState
                icon={Mail}
                title="No email activity yet"
                subtitle="Follow-up emails and opens will appear here once sent."
              />
            ) : (
              <ActivityTimeline activities={emailActivities} emptyText="No email activity yet." />
            )}
          </div>
        )}
      </div>

      {tab === 'notes' && (
        <div className="tdp-comment-footer panel-footer">
          <CRMNoteInput
            placeholder="Add a note about this lead…"
            onSubmit={async (body) => {
              await addNote({
                body,
                leadId: lead.id,
                contactId: lead.contactId,
                companyId: lead.companyId,
                createdBy: 'you',
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
