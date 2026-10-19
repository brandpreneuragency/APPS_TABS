import { useEffect, useMemo } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { FormsKPICard } from '../components/FormsKPICard';
import { FormsEmptyState } from '../components/FormsEmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { SpamBadge } from '../components/SpamBadge';
import {
  FileInput,
  Inbox,
  Target,
  ShieldOff,
  LayoutDashboard,
  ArrowRight,
} from 'lucide-react';
import '../forms.css';

function asString(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '';
}

function submissionLabel(fields: Record<string, unknown>): string {
  return asString(fields['name']) || asString(fields['first_name']) || asString(fields['email']) || 'Anonymous';
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function FormsDashboardPage() {
  const forms = useFormsStore((s) => s.forms);
  const submissions = useFormsStore((s) => s.submissions);
  const isLoaded = useFormsStore((s) => s.isLoaded);
  const loadForms = useFormsStore((s) => s.loadForms);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const setActiveSubmissionId = useFormsStore((s) => s.setActiveSubmissionId);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);

  useEffect(() => {
    if (!isLoaded) void loadForms();
  }, [isLoaded, loadForms]);

  const kpis = useMemo(() => {
    const activeForms = forms.filter((f) => f.status === 'published').length;
    const totalSubmissions = submissions.length;
    const spamBlocked = submissions.filter((s) => s.status === 'spam').length;
    const legitimate = totalSubmissions - spamBlocked;
    const converted = submissions.filter((s) => s.status === 'converted').length;
    const conversionRate = legitimate > 0 ? converted / legitimate : 0;
    return { activeForms, totalSubmissions, conversionRate, spamBlocked };
  }, [forms, submissions]);
  const formNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of forms) map.set(f.id, f.name);
    return map;
  }, [forms]);

  const recentSubmissions = useMemo(
    () =>
      [...submissions]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 8),
    [submissions],
  );

  const activeForms = useMemo(
    () => forms.filter((f) => f.status === 'published'),
    [forms],
  );

  const openForm = (formId: string) => {
    setActiveFormId(formId);
    setActiveFormsPage('list');
  };

  const openSubmission = (submissionId: string) => {
    setActiveSubmissionId(submissionId);
    setActiveFormsPage('submissions');
  };

  if (forms.length === 0) {
    return (
      <div className="ui-panel-body forms-page forms-page--scroll">
        <FormsEmptyState
          icon={LayoutDashboard}
          title="No forms yet"
          subtitle="Create your first form to start collecting leads. Submissions, conversion and spam stats will appear here."
          action={
            <button
              type="button"
              className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary"
              onClick={() => setActiveFormsPage('list')}
            >
              Go to Forms <ArrowRight />
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="ui-panel-body forms-page forms-page--scroll">
      <div className="forms-page-head">
        <h2 className="forms-page-title">Forms Dashboard</h2>
        <p className="forms-page-subtitle">
          {kpis.activeForms} active form{kpis.activeForms === 1 ? '' : 's'} ·{' '}
          {kpis.totalSubmissions} submission{kpis.totalSubmissions === 1 ? '' : 's'}
        </p>
      </div>

      <div className="forms-kpi-grid">
        <FormsKPICard
          label="Active Forms"
          value={kpis.activeForms}
          icon={FileInput}
          delta={`${forms.length} total`}
        />
        <FormsKPICard
          label="Submissions"
          value={kpis.totalSubmissions}
          icon={Inbox}
          delta={`${kpis.spamBlocked} spam blocked`}
        />
        <FormsKPICard
          label="Conversion"
          value={`${Math.round(kpis.conversionRate * 100)}%`}
          icon={Target}
          delta={`${submissions.filter((s) => s.status === 'converted').length} converted`}
          deltaTone={kpis.conversionRate > 0 ? 'up' : 'neutral'}
        />
        <FormsKPICard
          label="Spam Blocked"
          value={kpis.spamBlocked}
          icon={ShieldOff}
          delta={
            kpis.totalSubmissions > 0
              ? `${Math.round((kpis.spamBlocked / kpis.totalSubmissions) * 100)}% of submissions`
              : '0% of submissions'
          }
          deltaTone={kpis.spamBlocked > 0 ? 'down' : 'neutral'}
        />
      </div>

      {/* Recent submissions */}
      <div className="ui-card forms-section">
        <div className="forms-spread">
          <p className="forms-section-title">
            <Inbox /> Recent submissions
          </p>
          <button
            type="button"
            className="ui-button forms-action-btn forms-action-btn--ghost"
            onClick={() => setActiveFormsPage('submissions')}
          >
            View all <ArrowRight />
          </button>
        </div>
        {recentSubmissions.length === 0 ? (
          <p className="forms-section-hint">No submissions yet.</p>
        ) : (
          <div className="forms-table-wrap">
            <table className="forms-table">
              <thead>
                <tr>
                  <th>Submission</th>
                  <th>Form</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Spam</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentSubmissions.map((s) => (
                  <tr key={s.id} onClick={() => openSubmission(s.id)}>
                    <td>{submissionLabel(s.fields)}</td>
                    <td>{formNameById.get(s.formId) ?? '—'}</td>
                    <td>{s.sourceDomain ?? <span className="forms-muted">—</span>}</td>
                    <td style={{ textTransform: 'capitalize' }}>{s.status}</td>
                    <td>
                      <SpamBadge spamScore={s.spamScore} />
                    </td>
                    <td className="forms-muted">{timeLabel(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active forms */}
      <div className="ui-card forms-section">
        <div className="forms-spread">
          <p className="forms-section-title">
            <FileInput /> Active forms
          </p>
          <button
            type="button"
            className="ui-button forms-action-btn forms-action-btn--ghost"
            onClick={() => setActiveFormsPage('list')}
          >
            All forms <ArrowRight />
          </button>
        </div>
        {activeForms.length === 0 ? (
          <p className="forms-section-hint">No published forms. Publish a form to see it here.</p>
        ) : (
          <div className="forms-form-grid">
            {activeForms.map((form) => {
              const subs = submissions.filter((s) => s.formId === form.id);
              const converted = subs.filter((s) => s.status === 'converted').length;
              const spam = subs.filter((s) => s.status === 'spam').length;
              const legit = subs.length - spam;
              const rate = legit > 0 ? Math.round((converted / legit) * 100) : 0;
              return (
                <div key={form.id} className="ui-card forms-form-card" onClick={() => openForm(form.id)}>
                  <div className="forms-form-card-head">
                    <span className="forms-form-card-name">{form.name}</span>
                    <StatusBadge status={form.status} />
                  </div>
                  <div className="forms-form-card-meta">
                    <span className="forms-form-card-meta-item">
                      <Inbox /> {subs.length} submissions
                    </span>
                    <span className="forms-form-card-meta-item">
                      <Target /> {rate}% converted
                    </span>
                    <span className="forms-form-card-meta-item">
                      <ShieldOff /> {spam} spam
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
