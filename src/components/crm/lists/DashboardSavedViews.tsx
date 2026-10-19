import { useMemo } from 'react';
import { Building2, KanbanSquare, UserPlus } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import { useUIStore } from '../../../stores/uiStore';
import { StatusBadge } from '../components';
import { byNewestFirst, formatRelative } from '../components/format';

/**
 * Panel 1 content for the CRM Dashboard page — quick filter shortcuts and
 * a "recent objects" list (latest leads/companies/deals).
 */
export function DashboardSavedViews() {
  const { leads, companies, deals, setActiveLeadId, setActiveCompanyId, setActiveDealId } = useCrmStore();
  const { setActiveCRMPage } = useUIStore();

  const recentLeads = useMemo(
    () => [...leads].sort(byNewestFirst((l) => l.lastActivityAt)).slice(0, 4),
    [leads],
  );
  const recentCompanies = useMemo(
    () => [...companies].sort(byNewestFirst((c) => c.lastActivityAt)).slice(0, 3),
    [companies],
  );
  const recentDeals = useMemo(
    () => [...deals].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 3),
    [deals],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="crm-list-section-label">Quick filters</div>
      <div className="crm-quick-filters">
        <button type="button" className="ui-button crm-quick-filter" onClick={() => setActiveCRMPage('leads')}>
          <UserPlus /> Leads · {leads.length}
        </button>
        <button type="button" className="ui-button crm-quick-filter" onClick={() => setActiveCRMPage('pipeline')}>
          <KanbanSquare /> Deals · {deals.length}
        </button>
      </div>

      <div className="crm-list-section-label">Recent leads</div>
      {recentLeads.map((lead) => (
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
          </div>
        </button>
      ))}

      <div className="crm-list-section-label">Recent deals</div>
      {recentDeals.map((deal) => (
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
        </button>
      ))}

      <div className="crm-list-section-label">Recent companies</div>
      {recentCompanies.map((company) => (
        <button
          key={company.id}
          type="button"
          className="ui-list-row crm-list-item"
          onClick={() => {
            setActiveCompanyId(company.id);
            setActiveCRMPage('leads');
          }}
        >
          <div className="crm-list-item-row">
            <span className="crm-list-item-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Building2 className="subtle" />
              {company.name}
            </span>
          </div>
          <div className="crm-list-item-row">
            <span className="crm-list-item-sub">{company.industry ?? '—'} · {formatRelative(company.lastActivityAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
