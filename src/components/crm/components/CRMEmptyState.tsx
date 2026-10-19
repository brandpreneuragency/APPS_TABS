import type { LucideIcon } from 'lucide-react';

interface CRMEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  /** Optional call-to-action button rendered below the subtitle. */
  actionLabel?: string;
  onAction?: () => void;
}

export function CRMEmptyState({ icon: Icon, title, subtitle, actionLabel, onAction }: CRMEmptyStateProps) {
  return (
    <div className="crm-empty-state">
      {Icon && (
        <div className="crm-empty-state-icon">
          <Icon />
        </div>
      )}
      <div className="crm-empty-state-title">{title}</div>
      {subtitle && <div className="crm-empty-state-subtitle subtle">{subtitle}</div>}
      {actionLabel && onAction && (
        <button type="button" className="ui-button crm-btn ui-button--primary crm-btn--primary crm-btn--sm" onClick={onAction} style={{ marginTop: 12 }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
