import { useMemo } from 'react';
import { Plus, Search } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import type { CRMLead, CRMLeadStatus } from '../../../types/crm';
import type { CRMLeadScoreBand } from '../../../stores/crmStore';
import { ScoreBadge, StatusBadge } from '../components';
import { byNewestFirst, formatRelative } from '../components/format';

const STATUS_OPTIONS: { value: '' | CRMLeadStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'spam', label: 'Spam' },
];

const SCORE_OPTIONS: { value: '' | CRMLeadScoreBand; label: string }[] = [
  { value: '', label: 'All scores' },
  { value: 'high', label: 'High (80+)' },
  { value: 'med', label: 'Medium (50–79)' },
  { value: 'low', label: 'Low (<50)' },
  { value: 'none', label: 'No score' },
];

function leadScoreBand(score?: number): CRMLeadScoreBand {
  if (score === undefined || score === null || Number.isNaN(score)) return 'none';
  if (score >= 80) return 'high';
  if (score >= 50) return 'med';
  return 'low';
}

function leadTitle(lead: CRMLead): string {
  return lead.title;
}

function leadCompanyLabel(lead: CRMLead, companies: ReturnType<typeof useCrmStore.getState>['companies']): string {
  if (!lead.companyId) return 'No company';
  return companies.find((c) => c.id === lead.companyId)?.name ?? 'Unknown company';
}

interface LeadListProps {
  onAddLead?: () => void;
}

export function LeadList({ onAddLead }: LeadListProps) {
  const {
    leads,
    companies,
    contacts,
    activeLeadId,
    setActiveLeadId,
    filters,
    setLeadFilters,
  } = useCrmStore();

  const filtered = useMemo(() => {
    const { status, scoreBand, ownerId, search, tags } = filters.lead;
    const searchLower = search?.trim().toLowerCase();
    return leads
      .filter((l) => (status ? l.status === status : true))
      .filter((l) => (scoreBand ? leadScoreBand(l.score) === scoreBand : true))
      .filter((l) => (ownerId ? l.ownerId === ownerId : true))
      .filter((l) => (tags && tags.length > 0 ? tags.every((t) => l.tags.includes(t)) : true))
      .filter((l) => {
        if (!searchLower) return true;
        const contact = l.contactId ? contacts.find((c) => c.id === l.contactId) : undefined;
        const company = l.companyId ? companies.find((c) => c.id === l.companyId) : undefined;
        const haystack = [
          l.title,
          l.source ?? '',
          contact ? `${contact.firstName} ${contact.lastName} ${contact.email ?? ''}` : '',
          company?.name ?? '',
          l.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchLower);
      })
      .sort(byNewestFirst((l) => l.lastActivityAt));
  }, [leads, contacts, companies, filters.lead]);

  return (
    <div className="crm-list-content-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="crm-list-search">
        <Search className="crm-list-search-icon" />
        <input className="ui-input"
          type="text"
          placeholder="Search leads…"
          value={filters.lead.search ?? ''}
          onChange={(e) => setLeadFilters({ search: e.target.value })}
        />
      </div>

      <div className="crm-list-filters">
        <div className="crm-list-filter-row">
          <select
            className="ui-input crm-list-filter-select"
            value={filters.lead.status ?? ''}
            onChange={(e) => setLeadFilters({ status: (e.target.value || undefined) as CRMLeadStatus | undefined })}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="ui-input crm-list-filter-select"
            value={filters.lead.scoreBand ?? ''}
            onChange={(e) => setLeadFilters({ scoreBand: (e.target.value || undefined) as CRMLeadScoreBand | undefined })}
          >
            {SCORE_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="crm-list-section-label">Leads · {filtered.length}</div>

      {filtered.length === 0 && (
        <div className="crm-list-empty">
          <p className="txt-xs subtle">No leads match your filters.</p>
        </div>
      )}

      {filtered.map((lead) => {
        const isActive = lead.id === activeLeadId;
        const company = leadCompanyLabel(lead, companies);
        return (
          <button data-active={isActive}
            key={lead.id}
            type="button"
            className={"ui-list-row " + (`crm-list-item${isActive ? ' crm-list-item--active' : ''}`)}
            onClick={() => setActiveLeadId(lead.id)}
          >
            <div className="crm-list-item-row">
              <span className="crm-list-item-title">{leadTitle(lead)}</span>
              <ScoreBadge score={lead.score} compact />
            </div>
            <div className="crm-list-item-row">
              <span className="crm-list-item-sub">{company}</span>
              <StatusBadge stage={lead.status} />
            </div>
            <div className="crm-list-item-row">
              <span className="crm-list-item-sub">{formatRelative(lead.lastActivityAt)}</span>
            </div>
          </button>
        );
      })}

      {onAddLead && (
        <button type="button" className="ui-button crm-btn crm-btn--ghost crm-btn--sm" onClick={onAddLead} style={{ marginTop: 6 }}>
          <Plus /> Add lead
        </button>
      )}
    </div>
  );
}
