import { useEffect, useMemo } from 'react';
import { History } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import type { CRMActivityType } from '../../../types/crm';
import { ActivityTimeline, CRMEmptyState } from '../components';
import { inActivityDateRange, useActivityFilterUI } from '../lists/activityFilterStore';
import '../crm.css';

const TYPE_LABELS: Partial<Record<CRMActivityType, string>> = {
  form_submitted: 'Form submissions',
  lead_created: 'Leads created',
  lead_updated: 'Lead updates',
  contact_created: 'Contacts',
  company_created: 'Companies',
  deal_created: 'Deals',
  deal_stage_changed: 'Pipeline moves',
  note_added: 'Notes',
  task_linked: 'Task links',
  ai_suggestion_applied: 'AI actions',
  export_created: 'Exports',
  email_sent: 'Emails sent',
  email_opened: 'Email opens',
};

/**
 * Panel 2 for the CRM Activities page. Renders a unified <ActivityTimeline>
 * across every activity type, filtered by the Panel 1 <ActivityFilters/>
 * state — the activity `type` filter from crmStore.filters.activity and the
 * date-range filter from the local activityFilterUI store. A small summary
 * card at the top shows per-type counts for the current filter set. Empty
 * state when nothing matches.
 */
export default function CRMActivitiesPage() {
  const { isLoaded, loadCrm, activities, filters } = useCrmStore();
  const { dateRange } = useActivityFilterUI();
  const typeFilter = filters.activity.type;

  useEffect(() => {
    if (!isLoaded) void loadCrm();
  }, [isLoaded, loadCrm]);

  const filtered = useMemo(() => {
    return activities
      .filter((a) => (typeFilter ? a.type === typeFilter : true))
      .filter((a) => inActivityDateRange(a.createdAt, dateRange))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [activities, typeFilter, dateRange]);

  const countsByType = useMemo(() => {
    const counts: Partial<Record<CRMActivityType, number>> = {};
    for (const a of filtered) {
      counts[a.type] = (counts[a.type] ?? 0) + 1;
    }
    return counts;
  }, [filtered]);

  if (filtered.length === 0) {
    return (
      <div className="crm-page">
        <CRMEmptyState
          icon={History}
          title="No activities match"
          subtitle="Adjust the filters on the left, or generate activity by adding leads, notes, moving deals, or receiving form submissions."
        />
      </div>
    );
  }

  const summaryEntries = (Object.keys(countsByType) as CRMActivityType[]).sort();

  return (
    <div className="crm-page">
      <div className="ui-card crm-page-header">
        <div className="crm-page-header-main">
          <div className="crm-page-header-title">Activity</div>
          <div className="crm-page-header-meta">
            <span className="crm-page-header-meta-item">{filtered.length} events</span>
            {typeFilter && (
              <span className="crm-page-header-meta-item">
                Filtered: {TYPE_LABELS[typeFilter] ?? typeFilter}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="ui-panel-body crm-page-body" >
        <div className="ui-card crm-card">
          <div className="crm-card-title">Summary</div>
          <div className="crm-tag-chips">
            {summaryEntries.map((t) => (
              <span key={t} className="crm-tag-chip">
                {TYPE_LABELS[t] ?? t} · {countsByType[t]}
              </span>
            ))}
          </div>
        </div>

        <ActivityTimeline activities={filtered} emptyText="No activities match your filters." />
      </div>
    </div>
  );
}
