import { useMemo, useState } from 'react';
import { Briefcase, Building2, Mail, Phone } from 'lucide-react';
import type { CRMContact } from '../../../types/crm';
import { useCrmStore } from '../../../stores/crmStore';
import {
  ActivityTimeline,
  CRMTabBar,
  CRMNoteInput,
  TagChips,
  formatDate,
  formatRelative,
  fullName,
} from '../components';

const CONTACT_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'leads', label: 'Leads' },
  { id: 'deals', label: 'Deals' },
  { id: 'activity', label: 'Activity' },
  { id: 'notes', label: 'Notes' },
];

interface ContactDetailProps {
  contact: CRMContact;
}

export function ContactDetail({ contact }: ContactDetailProps) {
  const { companies, leads, deals, activities, notes, addNote } = useCrmStore();
  const [tab, setTab] = useState<string>('profile');

  const company = contact.companyId ? companies.find((c) => c.id === contact.companyId) : undefined;
  const contactLeads = useMemo(() => leads.filter((l) => l.contactId === contact.id), [leads, contact.id]);
  const contactDeals = useMemo(() => deals.filter((d) => d.contactId === contact.id), [deals, contact.id]);
  const contactActivities = useMemo(
    () => activities.filter((a) => a.contactId === contact.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [activities, contact.id],
  );
  const contactNotes = useMemo(
    () => notes.filter((n) => n.contactId === contact.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [notes, contact.id],
  );

  return (
    <div className="crm-page">
      <div className="ui-card crm-page-header">
        <div className="crm-page-header-main">
          <div className="crm-page-header-title">{fullName(contact.firstName, contact.lastName)}</div>
          <div className="crm-page-header-meta">
            {contact.jobTitle && (
              <span className="crm-page-header-meta-item"><Briefcase /> {contact.jobTitle}</span>
            )}
            {company && (
              <span className="crm-page-header-meta-item"><Building2 /> {company.name}</span>
            )}
            {contact.lifecycleStatus && <span className="crm-page-header-meta-item">{contact.lifecycleStatus}</span>}
            {contact.tags.length > 0 && <TagChips tags={contact.tags} max={4} />}
          </div>
        </div>
      </div>

      <CRMTabBar tabs={CONTACT_TABS} active={tab} onChange={setTab} />

      <div className="ui-panel-body crm-page-body">
        {tab === 'profile' && (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Contact details</div>
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
                <span className="crm-detail-field-value crm-detail-field-value--muted">{contact.jobTitle ?? '—'}</span>
              </div>
              <div className="crm-detail-field">
                <span className="crm-detail-field-label">Company</span>
                <span className="crm-detail-field-value crm-detail-field-value--muted">{company?.name ?? '—'}</span>
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
                <div className="crm-card-title" style={{ marginTop: 4 }}>Notes</div>
                <div className="crm-muted-block">{contact.notes}</div>
              </>
            )}
          </div>
        )}

        {tab === 'leads' && (
          <div className="crm-stacked">
            {contactLeads.length === 0 ? (
              <div className="crm-muted-block">No leads linked to this contact.</div>
            ) : (
              contactLeads.map((lead) => (
                <div key={lead.id} className="ui-card crm-card">
                  <div className="crm-card-header">
                    <span className="crm-card-title">{lead.title}</span>
                    <span className="crm-list-item-sub">{formatRelative(lead.lastActivityAt)}</span>
                  </div>
                  <div className="crm-card-body crm-muted-block">Stage: {lead.stage} · Score: {lead.score ?? '—'}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'deals' && (
          <div className="crm-stacked">
            {contactDeals.length === 0 ? (
              <div className="crm-muted-block">No deals linked to this contact.</div>
            ) : (
              contactDeals.map((deal) => (
                <div key={deal.id} className="ui-card crm-card">
                  <div className="crm-card-header">
                    <span className="crm-card-title">{deal.title}</span>
                    <span className="crm-list-item-sub">{deal.stage}</span>
                  </div>
                  <div className="crm-card-body crm-muted-block">
                    Value: {deal.value ?? '—'} {deal.currency ?? ''} · Close: {formatDate(deal.expectedCloseDate)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'activity' && (
          <ActivityTimeline activities={contactActivities} emptyText="No activity for this contact." />
        )}

        {tab === 'notes' && (
          <div className="crm-stacked">
            {contactNotes.length === 0 ? (
              <div className="crm-muted-block">No notes yet. Add one below.</div>
            ) : (
              contactNotes.map((note) => (
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
      </div>

      {tab === 'notes' && (
        <div className="tdp-comment-footer panel-footer">
          <CRMNoteInput
            placeholder="Add a note about this contact…"
            onSubmit={async (body) => {
              await addNote({ body, contactId: contact.id, companyId: contact.companyId, createdBy: 'you' });
            }}
          />
        </div>
      )}
    </div>
  );
}
