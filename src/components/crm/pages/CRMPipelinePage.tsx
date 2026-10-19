import { useEffect, useMemo, useState } from 'react';
import { Calculator, DollarSign, KanbanSquare, Scale } from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import type { CRMDealStage } from '../../../types/crm';
import { CRMEmptyState, KanbanBoard, KPICard, StatusBadge, TagChips } from '../components';
import { LeadDetailModal } from '../detail/LeadDetailModal';
import { formatCurrency, formatDate } from '../components/format';
import '../crm.css';

/** Open (non-terminal) pipeline stages used for the metric row. */
const OPEN_STAGES: CRMDealStage[] = ['new', 'contacted', 'qualified', 'proposal'];

/**
 * Panel 2 for the CRM Pipeline page. Top metric row (Total Pipeline, Weighted
 * Pipeline, Open Deals, Average Deal Size) computed inline from crmStore.deals,
 * then a Kanban board across the 7 default stages with stage-move wired to
 * crmStore.setDealStage. Falls back to a flat deal table when the user toggles
 * the list view (crmStore.activePipelineView). Filters/saved views come from
 * Panel 1's <PipelineFilters/>. Shows an empty state when there are no deals.
 */
export default function CRMPipelinePage() {
  const {
    isLoaded,
    loadCrm,
    deals,
    contacts,
    companies,
    pipelineStages,
    activeDealId,
    activePipelineView,
    setDealStage,
    setActiveDealId,
    createDeal,
  } = useCrmStore();

  const [leadDetailModalId, setLeadDetailModalId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) void loadCrm();
  }, [isLoaded, loadCrm]);

  const metrics = useMemo(() => {
    const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
    const totalPipeline = openDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
    const weightedPipeline = openDeals.reduce(
      (sum, d) => sum + (d.value ?? 0) * (d.probability ?? 0),
      0,
    );
    const openCount = openDeals.length;
    const avgDealSize = openCount > 0 ? totalPipeline / openCount : 0;
    return { totalPipeline, weightedPipeline, openCount, avgDealSize, totalDeals: deals.length };
  }, [deals]);

  const handleAddDeal = async () => {
    const title = window.prompt('New deal title');
    if (!title || !title.trim()) return;
    await createDeal({ title: title.trim(), stage: 'new', ownerId: 'you', value: 0 });
  };

  const handleEditDeal = (dealId: string) => {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal?.leadId) return;
    setLeadDetailModalId(deal.leadId);
  };

  if (deals.length === 0) {
    return (
      <div className="crm-page">
        <CRMEmptyState
          icon={KanbanSquare}
          title="No deals yet"
          subtitle="Create your first deal to start tracking pipeline. Deals created from leads or added manually will appear on the Kanban board."
          actionLabel="Add deal"
          onAction={handleAddDeal}
        />
      </div>
    );
  }

  return (
    <div className="crm-page">
      {leadDetailModalId && (
        <LeadDetailModal leadId={leadDetailModalId} onClose={() => setLeadDetailModalId(null)} />
      )}
      <div className="ui-panel-body crm-page-body" >
        <div className="crm-kpi-row">
          <KPICard
            label="Total Pipeline"
            value={formatCurrency(metrics.totalPipeline)}
            icon={DollarSign}
            delta={`${metrics.openCount} open`}
            deltaPositive
          />
          <KPICard
            label="Weighted Pipeline"
            value={formatCurrency(metrics.weightedPipeline)}
            icon={Scale}
            delta="by probability"
            deltaPositive
          />
          <KPICard
            label="Open Deals"
            value={metrics.openCount}
            icon={KanbanSquare}
            delta={`${metrics.totalDeals} total`}
            deltaPositive
          />
          <KPICard
            label="Average Deal Size"
            value={formatCurrency(metrics.avgDealSize)}
            icon={Calculator}
            delta="open deals"
            deltaPositive
          />
        </div>

        {activePipelineView === 'list' ? (
          <div className="ui-card crm-card">
            <div className="crm-card-title">Deals (list)</div>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Stage</th>
                  <th>Value</th>
                  <th>Close</th>
                  <th>Owner</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr
                    key={deal.id}
                    onClick={() => setActiveDealId(deal.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="trunc">{deal.title}</td>
                    <td><StatusBadge stage={deal.stage} /></td>
                    <td>{formatCurrency(deal.value, deal.currency)}</td>
                    <td>{formatDate(deal.expectedCloseDate)}</td>
                    <td>{deal.ownerId ?? '—'}</td>
                    <td>{deal.tags.length > 0 ? <TagChips tags={deal.tags} max={2} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <KanbanBoard
            stages={pipelineStages}
            deals={deals}
            contacts={contacts}
            companies={companies}
            onMoveDeal={(dealId, toStage, beforeId) => {
              void setDealStage(dealId, toStage, beforeId);
            }}
            onSelectDeal={(dealId) => setActiveDealId(dealId)}
            onEditDeal={handleEditDeal}
            activeDealId={activeDealId}
          />
        )}
      </div>
    </div>
  );
}
