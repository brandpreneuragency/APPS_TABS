import {
  FileText,
  UserPlus,
  Users,
  Building2,
  KanbanSquare,
  ArrowRightLeft,
  StickyNote,
  Link2,
  Sparkles,
  Download,
  Send,
  Eye,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import type { CRMActivity, CRMActivityType } from '../../../types/crm';

const ACTIVITY_ICON: Record<CRMActivityType, LucideIcon> = {
  lead_created: UserPlus,
  lead_updated: UserPlus,
  contact_created: Users,
  company_created: Building2,
  deal_created: KanbanSquare,
  deal_stage_changed: ArrowRightLeft,
  form_submitted: FileText,
  note_added: StickyNote,
  task_linked: Link2,
  ai_suggestion_applied: Sparkles,
  export_created: Download,
  email_sent: Send,
  email_opened: Eye,
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' });
}

interface ActivityTimelineProps {
  activities: CRMActivity[];
  /** When true, shows the relative timestamp on each row. */
  showTimestamp?: boolean;
  /** Optional empty-state message when there are no activities. */
  emptyText?: string;
}

export function ActivityTimeline({ activities, showTimestamp = true, emptyText = 'No activity yet.' }: ActivityTimelineProps) {
  if (!activities || activities.length === 0) {
    return <div className="crm-timeline-empty subtle">{emptyText}</div>;
  }
  return (
    <div className="crm-timeline">
      {activities.map((activity) => {
        const Icon = ACTIVITY_ICON[activity.type] ?? Mail;
        return (
          <div key={activity.id} className="crm-timeline-item">
            <div className="crm-timeline-rail">
              <span className="crm-timeline-icon">
                <Icon />
              </span>
            </div>
            <div className="crm-timeline-body">
              <div className="crm-timeline-title-row">
                <span className="crm-timeline-title">{activity.title}</span>
                {showTimestamp && (
                  <span className="crm-timeline-meta subtle">{formatRelative(activity.createdAt)}</span>
                )}
              </div>
              {activity.description && (
                <div className="crm-timeline-desc subtle">{activity.description}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
