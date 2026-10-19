import type { LucideIcon } from 'lucide-react';
import '../forms.css';

interface FormsEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function FormsEmptyState({ icon: Icon, title, subtitle, action }: FormsEmptyStateProps) {
  return (
    <div className="forms-empty-state">
      {Icon ? (
        <span className="forms-empty-state-icon">
          <Icon />
        </span>
      ) : null}
      <p className="forms-empty-state-title">{title}</p>
      {subtitle ? <p className="forms-empty-state-subtitle">{subtitle}</p> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}
