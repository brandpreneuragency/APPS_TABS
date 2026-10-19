import { useMemo } from 'react';
import { Building2, Plus, Search } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import { TagChips } from '../components';
import { byNewestFirst, formatRelative } from '../components/format';

interface CompanyListProps {
  onAddCompany?: () => void;
}

export function CompanyList({ onAddCompany }: CompanyListProps) {
  const {
    companies,
    contacts,
    leads,
    activeCompanyId,
    setActiveCompanyId,
    filters,
    setCompanyFilters,
  } = useCrmStore();

  const filtered = useMemo(() => {
    const { search, industry } = filters.company;
    const lower = search?.trim().toLowerCase();
    return companies
      .filter((c) => (industry ? c.industry === industry : true))
      .filter((c) => {
        if (!lower) return true;
        const haystack = [c.name, c.website ?? '', c.industry ?? '', c.city ?? '', c.country ?? '', c.tags.join(' ')]
          .join(' ')
          .toLowerCase();
        return haystack.includes(lower);
      })
      .sort(byNewestFirst((c) => c.lastActivityAt));
  }, [companies, filters.company]);

  const industries = useMemo(() => {
    const set = new Set<string>();
    companies.forEach((c) => { if (c.industry) set.add(c.industry); });
    return Array.from(set).sort();
  }, [companies]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="crm-list-search">
        <Search className="crm-list-search-icon" />
        <input className="ui-input"
          type="text"
          placeholder="Search companies…"
          value={filters.company.search ?? ''}
          onChange={(e) => setCompanyFilters({ search: e.target.value })}
        />
      </div>

      <div className="crm-list-filter-row">
        <select
          className="ui-input crm-list-filter-select"
          value={filters.company.industry ?? ''}
          onChange={(e) => setCompanyFilters({ industry: e.target.value || undefined })}
        >
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      <div className="crm-list-section-label">Companies · {filtered.length}</div>

      {filtered.length === 0 && (
        <div className="crm-list-empty">
          <p className="txt-xs subtle">No companies match your search.</p>
        </div>
      )}

      {filtered.map((company) => {
        const isActive = company.id === activeCompanyId;
        const companyContacts = contacts.filter((c) => c.companyId === company.id).length;
        const companyLeads = leads.filter((l) => l.companyId === company.id).length;
        return (
          <button data-active={isActive}
            key={company.id}
            type="button"
            className={"ui-list-row " + (`crm-list-item${isActive ? ' crm-list-item--active' : ''}`)}
            onClick={() => setActiveCompanyId(company.id)}
          >
            <div className="crm-list-item-row">
              <span className="crm-list-item-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Building2 className="subtle" />
                {company.name}
              </span>
              <span className="crm-list-item-sub">{formatRelative(company.lastActivityAt)}</span>
            </div>
            <div className="crm-list-item-row">
              <span className="crm-list-item-sub">
                {company.industry ?? '—'} · {companyContacts} contacts · {companyLeads} leads
              </span>
            </div>
            {company.tags.length > 0 && (
              <div className="crm-list-item-row">
                <TagChips tags={company.tags} max={3} />
              </div>
            )}
          </button>
        );
      })}

      {onAddCompany && (
        <button type="button" className="ui-button crm-btn crm-btn--ghost crm-btn--sm" onClick={onAddCompany} style={{ marginTop: 6 }}>
          <Plus /> Add company
        </button>
      )}
    </div>
  );
}
