import { useMemo } from 'react';
import { useCrmStore } from '../../../stores/crmStore';
import type { CRMActivityType } from '../../../types/crm';
import { useActivityFilterUI, type ActivityDateRange } from './activityFilterStore';

const TYPE_OPTIONS: { value: '' | CRMActivityType; label: string }[] = [
  { value: '', label: 'All activity' },
  { value: 'form_submitted', label: 'Form submissions' },
  { value: 'lead_created', label: 'Lead created' },
  { value: 'lead_updated', label: 'Lead updates' },
  { value: 'note_added', label: 'Notes' },
  { value: 'task_linked', label: 'Task links' },
  { value: 'deal_stage_changed', label: 'Pipeline moves' },
  { value: 'ai_suggestion_applied', label: 'AI actions' },
  { value: 'export_created', label: 'Exports' },
  { value: 'email_sent', label: 'Emails sent' },
  { value: 'email_opened', label: 'Email opens' },
  { value: 'contact_created', label: 'Contacts' },
  { value: 'company_created', label: 'Companies' },
  { value: 'deal_created', label: 'Deals' },
];

const DATE_RANGES = [
  { value: '' as const, label: 'All time' },
  { value: 'today' as const, label: 'Today' },
  { value: '7d' as const, label: 'Last 7 days' },
  { value: '30d' as const, label: 'Last 30 days' },
];

export function ActivityFilters() {
  const { activities, filters, setActivityFilters } = useCrmStore();
  const { type } = filters.activity;
  const { dateRange, setDateRange } = useActivityFilterUI();

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const a of activities) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
    }
    return byType;
  }, [activities]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="crm-list-section-label">Filters</div>

      <div className="crm-list-filters">
        <select
          className="ui-input crm-list-filter-select"
          value={type ?? ''}
          onChange={(e) => setActivityFilters({ type: (e.target.value || undefined) as CRMActivityType | undefined })}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="ui-input crm-list-filter-select"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as ActivityDateRange)}
        >
          {DATE_RANGES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="crm-list-section-label">Quick types</div>
      <div className="crm-quick-filters">
        {TYPE_OPTIONS.filter((o) => o.value).map((o) => (
          <button data-active={type === o.value}
            key={o.value}
            type="button"
            className={"ui-button " + (`crm-quick-filter${type === o.value ? ' crm-quick-filter--active' : ''}`)}
            onClick={() => setActivityFilters({ type: (type === o.value ? undefined : o.value) as CRMActivityType | undefined })}
          >
            {o.label} · {counts[o.value ?? ''] ?? 0}
          </button>
        ))}
      </div>
    </div>
  );
}
