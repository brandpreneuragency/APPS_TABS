import type { CRMDeal, PipelineStage, CRMContact, CRMCompany } from '../../../types/crm';
import { KanbanCard } from './KanbanCard';
import { useKanbanDropIndicator } from '../../../hooks/useKanbanDropIndicator';
import { sortKanbanCards } from '../../../services/kanbanOrder';

interface KanbanBoardProps {
  stages: PipelineStage[];
  deals: CRMDeal[];
  contacts: CRMContact[];
  companies: CRMCompany[];
  onMoveDeal?: (dealId: string, toStage: CRMDeal['stage'], beforeId: string | null) => void;
  onSelectDeal?: (dealId: string) => void;
  onEditDeal?: (dealId: string) => void;
  activeDealId?: string | null;
}

export function KanbanBoard({
  stages,
  deals,
  contacts,
  companies,
  onMoveDeal,
  onSelectDeal,
  onEditDeal,
  activeDealId,
}: KanbanBoardProps) {
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const drop = useKanbanDropIndicator('application/x-crm-deal');

  return (
    <div className="crm-kanban">
      {stages.map((stage) => {
        const stageDeals = sortKanbanCards(deals.filter((d) => d.stage === stage.key));
        const totalValue = stageDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
        const valueLabel =
          totalValue > 0
            ? `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(totalValue)}`
            : '';
        const isDropTarget = drop.targetColumn === stage.key;
        return (
          <div key={stage.id} className={`crm-kanban-column${isDropTarget ? ' crm-kanban-column--drop-target' : ''}`} data-stage={stage.key}>
            <div className="crm-kanban-column-header">
              <span className="crm-kanban-column-title">
                <span className={`crm-kanban-column-dot crm-kanban-column-dot--${stage.key}`} />
                {stage.label}
              </span>
              <span className="crm-kanban-column-count">
                {stageDeals.length}
                {valueLabel && <span className="crm-kanban-column-value subtle"> · {valueLabel}</span>}
              </span>
            </div>
            <div
              className="crm-kanban-column-body"
              {...drop.handlers(stage.key, (dealId, beforeId) => {
                if (deals.some((deal) => deal.id === dealId)) onMoveDeal?.(dealId, stage.key, beforeId);
              })}
            >
              {drop.indicator(stage.key)}
              {stageDeals.length === 0 && (
                <div className="crm-kanban-column-empty subtle">No deals</div>
              )}
              {stageDeals.map((deal) => (
                <KanbanCard
                  key={deal.id}
                  deal={deal}
                  contact={deal.contactId ? contactMap.get(deal.contactId) : undefined}
                  company={deal.companyId ? companyMap.get(deal.companyId) : undefined}
                  onClick={onSelectDeal}
                  onEdit={onEditDeal}
                  isActive={deal.id === activeDealId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
