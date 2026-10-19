import { useMemo, useState } from 'react';
import { Building2, FileText, Globe, MapPin } from 'lucide-react';
import type { CRMCompany } from '../../../types/crm';
import { useCrmStore } from '../../../stores/crmStore';
import { useUIStore } from '../../../stores/uiStore';
import {
  ActivityTimeline,
  CRMTabBar,
  CRMEmptyState,
  CRMNoteInput,
  ScoreBadge,
  StatusBadge,
  TagChips,
  formatDate,
  formatRelative,
  fullName,
} from '../components';

const COMPANY_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'leads', label: 'Leads' },
  { id: 'deals', label: 'Deals' },
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
];

interface CompanyDetailProps {
  company: CRMCompany;
}

export function CompanyDetail({ company }: CompanyDetailProps) {
  const { contacts, leads, deals, activities, notes, addNote, setActiveContactId, setActiveLeadId, setActiveDealId } = useCrmStore();
  const { setActiveCRMPage } = useUIStore();
  const [tab, setTab] = useState<string>('overview');

  const companyContacts = useMemo(() => contacts.filter((c) => c.companyId === company.id), [contacts, company.id]);
  const companyLeads = useMemo(() => leads.filter((l) => l.companyId === company.id), [leads, company.id]);
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === company.id), [deals, company.id]);
  const companyActivities = useMemo(
    () => activities.filter((a) => a.companyId === company.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [activities, company.id],
  );
  const companyNotes = useMemo(
    () => notes.filter((n) => n.companyId === company.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [notes, company.id],
  );

  return (
    <div className="crm-page">
      <div className="ui-card crm-page-header">
        <div className="crm-page-header-main">
          <div className="crm-page-header-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Building2 className="subtle" /> {company.name}
          </div>
          <div className="crm-page-header-meta">
            {company.industry && <span className="crm-page-header-meta-item">{company.industry}</span>}
            {company.size && <span className="crm-page-header-meta-item">{company.size}</span>}
            {(company.city || company.country) && (
              <span className="crm-page-header-meta-item"><MapPin /> {[company.city, company.country].filter(Boolean).join(', ')}</span>
            )}
            {company.tags.length > 0 && <TagChips tags={company.tags} max={4} />}
          </div>
        </div>
      </div>

      <CRMTabBar tabs={COMPANY_TABS} active={tab} onChange={setTab} />

      <div className="ui-panel-body crm-page-body">
        {tab === 'overview' && (
          <>
            <div className="ui-card crm-card">
              <div className="crm-card-title">Company overview</div>
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
                  <span className="crm-detail-field-label">Country</span>
                  <span className="crm-detail-field-value crm-detail-field-value--muted">{company.country ?? '—'}</span>
                </div>
                <div className="crm-detail-field">
                  <span className="crm-detail-field-label">City</span>
                  <span className="crm-detail-field-value crm-detail-field-value--muted">{company.city ?? '—'}</span>
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
                  <div className="crm-card-title" style={{ marginTop: 4 }}>Notes</div>
                  <div className="crm-muted-block">{company.notes}</div>
                </>
              )}
            </div>

            {companyNotes.length > 0 && (
              <div className="ui-card crm-card">
                <div className="crm-card-title">Recent notes</div>
                <div className="crm-stacked">
                  {companyNotes.slice(0, 3).map((note) => (
                    <div key={note.id} className="ui-list-row crm-compact-row">
                      <div className="crm-compact-row-main">
                        <span className="crm-compact-row-title">{note.body}</span>
                        <span className="crm-compact-row-sub">{note.createdBy ?? 'You'} · {formatRelative(note.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'contacts' && (
          <div className="crm-stacked">
            {companyContacts.length === 0 ? (
              <div className="crm-muted-block">No contacts at this company.</div>
            ) : (
              companyContacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  className="ui-list-row crm-list-item"
                  onClick={() => {
                    setActiveContactId(contact.id);
                    setActiveCRMPage('contacts');
                  }}
                >
                  <div className="crm-list-item-row">
                    <span className="crm-list-item-title">{fullName(contact.firstName, contact.lastName)}</span>
                    <span className="crm-list-item-sub">{formatRelative(contact.lastActivityAt)}</span>
                  </div>
                  <div className="crm-list-item-row">
                    <span className="crm-list-item-sub">{contact.jobTitle ?? '—'} · {contact.email ?? '—'}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'leads' && (
          <div className="crm-stacked">
            {companyLeads.length === 0 ? (
              <div className="crm-muted-block">No leads for this company.</div>
            ) : (
              companyLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  className="ui-list-row crm-list-item"
                  onClick={() => {
                    setActiveLeadId(lead.id);
                    setActiveCRMPage('leads');
                  }}
                >
                  <div className="crm-list-item-row">
                    <span className="crm-list-item-title">{lead.title}</span>
                    <StatusBadge stage={lead.status} />
                  </div>
                  <div className="crm-list-item-row">
                    <span className="crm-list-item-sub">{formatRelative(lead.lastActivityAt)}</span>
                    <ScoreBadge score={lead.score} compact />
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'deals' && (
          <div className="crm-stacked">
            {companyDeals.length === 0 ? (
              <div className="crm-muted-block">No deals for this company.</div>
            ) : (
              companyDeals.map((deal) => (
                <button
                  key={deal.id}
                  type="button"
                  className="ui-list-row crm-list-item"
                  onClick={() => {
                    setActiveDealId(deal.id);
                    setActiveCRMPage('pipeline');
                  }}
                >
                  <div className="crm-list-item-row">
                    <span className="crm-list-item-title">{deal.title}</span>
                    <StatusBadge stage={deal.stage} />
                  </div>
                  <div className="crm-list-item-row">
                    <span className="crm-list-item-sub">
                      {deal.value ?? '—'} {deal.currency ?? ''} · close {formatDate(deal.expectedCloseDate)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'activity' && (
          <ActivityTimeline activities={companyActivities} emptyText="No activity for this company." />
        )}

        {tab === 'files' && (
          <CRMEmptyState
            icon={FileText}
            title="No files attached"
            subtitle="File attachments will appear here once file upload storage is connected."
          />
        )}
      </div>

      {tab === 'overview' && (
        <div className="tdp-comment-footer panel-footer">
          <CRMNoteInput
            placeholder="Add a note about this company…"
            onSubmit={async (body) => {
              await addNote({ body, companyId: company.id, createdBy: 'you' });
            }}
          />
        </div>
      )}
    </div>
  );
}
