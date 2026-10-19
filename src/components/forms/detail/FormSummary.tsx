import type { LeadForm } from '../../../types/forms';
import { StatusBadge } from '../components/StatusBadge';
import { Inbox, Target, ShieldOff, Globe, FileText } from 'lucide-react';
import '../forms.css';

interface FormSummaryProps {
  form: LeadForm;
  kpis: { total: number; converted: number; spam: number; conversionRate: number };
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function FormSummary({ form, kpis }: FormSummaryProps) {
  const allowedDomains = form.embed.allowedDomains ?? [];

  return (
    <div className="ui-card forms-section">
      <div className="forms-spread">
        <div className="forms-row">
          <span className="forms-kpi-card-icon" style={{ width: 28, height: 28 }}>
            <FileText />
          </span>
          <div className="forms-stack" style={{ gap: 2 }}>
            <span className="forms-page-title">{form.name}</span>
            {form.description ? (
              <span className="forms-section-hint">{form.description}</span>
            ) : null}
          </div>
        </div>
        <StatusBadge status={form.status} />
      </div>

      <div className="forms-kpi-grid" style={{ marginTop: 4 }}>
        <div className="ui-card forms-kpi-card">
          <div className="forms-kpi-card-row">
            <span className="forms-kpi-card-label">Submissions</span>
            <span className="forms-kpi-card-icon">
              <Inbox />
            </span>
          </div>
          <span className="forms-kpi-card-value">{kpis.total}</span>
        </div>
        <div className="ui-card forms-kpi-card">
          <div className="forms-kpi-card-row">
            <span className="forms-kpi-card-label">Conversion</span>
            <span className="forms-kpi-card-icon">
              <Target />
            </span>
          </div>
          <span className="forms-kpi-card-value">{pct(kpis.conversionRate)}</span>
          <span className="forms-kpi-card-delta">{kpis.converted} converted</span>
        </div>
        <div className="ui-card forms-kpi-card">
          <div className="forms-kpi-card-row">
            <span className="forms-kpi-card-label">Spam</span>
            <span className="forms-kpi-card-icon">
              <ShieldOff />
            </span>
          </div>
          <span className="forms-kpi-card-value">{kpis.spam}</span>
        </div>
        <div className="ui-card forms-kpi-card">
          <div className="forms-kpi-card-row">
            <span className="forms-kpi-card-label">Fields</span>
            <span className="forms-kpi-card-icon">
              <FileText />
            </span>
          </div>
          <span className="forms-kpi-card-value">{form.fields.length}</span>
        </div>
      </div>

      <div className="forms-field-row">
        <span className="forms-field-label">Allowed domains</span>
        <span className="forms-field-value">
          {allowedDomains.length === 0 ? (
            <span className="forms-field-value--muted">Unrestricted (any domain)</span>
          ) : (
            <span className="forms-row forms-row--wrap" style={{ gap: 6 }}>
              <Globe className="forms-muted" />
              {allowedDomains.map((d) => (
                <span key={d} className="forms-domain-chip">
                  {d}
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
      <div className="forms-field-row">
        <span className="forms-field-label">Success message</span>
        <span className="forms-field-value">{form.successMessage}</span>
      </div>
      {form.notificationEmail ? (
        <div className="forms-field-row">
          <span className="forms-field-label">Notification email</span>
          <span className="forms-field-value">{form.notificationEmail}</span>
        </div>
      ) : null}
    </div>
  );
}
