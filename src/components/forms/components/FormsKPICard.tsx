import type { LucideIcon } from 'lucide-react';
import '../forms.css';

interface FormsKPICardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'neutral';
  icon?: LucideIcon;
}

export function FormsKPICard({ label, value, delta, deltaTone = 'neutral', icon: Icon }: FormsKPICardProps) {
  const deltaClass =
    deltaTone === 'up'
      ? 'forms-kpi-card-delta forms-kpi-card-delta--up'
      : deltaTone === 'down'
        ? 'forms-kpi-card-delta forms-kpi-card-delta--down'
        : 'forms-kpi-card-delta';

  return (
    <div className="ui-card forms-kpi-card">
      <div className="forms-kpi-card-row">
        <span className="forms-kpi-card-label">{label}</span>
        {Icon ? (
          <span className="forms-kpi-card-icon">
            <Icon />
          </span>
        ) : null}
      </div>
      <span className="forms-kpi-card-value">{value}</span>
      {delta ? <span className={deltaClass}>{delta}</span> : null}
    </div>
  );
}
