import { useMemo } from 'react';
import { useCrmStore } from '../../../stores/crmStore';
import type { CRMDealStage } from '../../../types/crm';

const STAGE_OPTIONS: { value: '' | CRMDealStage; label: string }[] = [
  { value: '', label: 'All stages' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'spam', label: 'Spam' },
];

const OWNER_OPTIONS = [
  { value: '', label: 'All owners' },
  { value: 'you', label: 'You' },
];

export function PipelineFilters() {
  const {
    deals,
    filters,
    setDealFilters,
    savedViews,
    activeSavedViewId,
    applySavedView,
  } = useCrmStore();

  const dealSavedViews = savedViews.filter((v) => v.entity === 'deal');

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of deals) {
      counts[d.stage] = (counts[d.stage] ?? 0) + 1;
    }
    return counts;
  }, [deals]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="crm-list-section-label">Filters</div>

      <div className="crm-list-filters">
        <select
          className="ui-input crm-list-filter-select"
          value={filters.deal.stage ?? ''}
          onChange={(e) => setDealFilters({ stage: (e.target.value || undefined) as CRMDealStage | undefined })}
        >
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="ui-input crm-list-filter-select"
          value={filters.deal.ownerId ?? ''}
          onChange={(e) => setDealFilters({ ownerId: e.target.value || undefined })}
        >
          {OWNER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="crm-list-search">
          <input className="ui-input"
            type="text"
            placeholder="Search deals…"
            value={filters.deal.search ?? ''}
            onChange={(e) => setDealFilters({ search: e.target.value })}
          />
        </div>
      </div>

      {dealSavedViews.length > 0 && (
        <>
          <div className="crm-list-section-label">Saved views</div>
          <div className="crm-saved-views">
            <button data-active={!activeSavedViewId}
              type="button"
              className={"ui-list-row " + (`crm-saved-view-item${!activeSavedViewId ? ' crm-saved-view-item--active' : ''}`)}
              onClick={() => applySavedView(null)}
            >
              All deals
            </button>
            {dealSavedViews.map((v) => (
              <button data-active={activeSavedViewId === v.id}
                key={v.id}
                type="button"
                className={"ui-list-row " + (`crm-saved-view-item${activeSavedViewId === v.id ? ' crm-saved-view-item--active' : ''}`)}
                onClick={() => applySavedView(v.id)}
              >
                {v.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="crm-list-section-label">By stage</div>
      <div className="crm-quick-filters">
        {STAGE_OPTIONS.filter((o) => o.value).map((o) => (
          <button data-active={filters.deal.stage === o.value}
            key={o.value}
            type="button"
            className={"ui-button " + (`crm-quick-filter${filters.deal.stage === o.value ? ' crm-quick-filter--active' : ''}`)}
            onClick={() => setDealFilters({ stage: (filters.deal.stage === o.value ? undefined : o.value) as CRMDealStage | undefined })}
          >
            {o.label} · {stageCounts[o.value ?? ''] ?? 0}
          </button>
        ))}
      </div>
    </div>
  );
}
