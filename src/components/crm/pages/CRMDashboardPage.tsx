import { useEffect, useMemo } from 'react';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  KanbanSquare,
  SquarePen,
  Target,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCrmStore } from '../../../stores/crmStore';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import '../crm.css';
import { KPICard, ScoreBadge, StatusBadge } from '../components';
import { byNewestFirst, formatCurrency, formatPercent, formatRelative } from '../components/format';

export default function CRMDashboardPage() {
  const {
    isLoaded,
    loadCrm,
    leads,
    deals,
    companies,
    pipelineStages,
    selectDashboardKPIs,
    setActiveLeadId,
    createLead,
    createCompany,
  } = useCrmStore();
  const { submissions, forms, isLoaded: formsLoaded, loadForms } = useFormsStore();
  const { setActiveCRMPage, setActiveFormsPage } = useUIStore();

  useEffect(() => {
    if (!isLoaded) void loadCrm();
  }, [isLoaded, loadCrm]);

  useEffect(() => {
    if (!formsLoaded) void loadForms();
  }, [formsLoaded, loadForms]);

  // selectDashboardKPIs reads leads/deals via store get(); deps trigger recompute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kpis = useMemo(() => selectDashboardKPIs(0), [selectDashboardKPIs, leads, deals]);

  const recentLeads = useMemo(() => [...leads].sort(byNewestFirst((l) => l.lastActivityAt)).slice(0, 5), [leads]);

  const followUpsDue = useMemo(() => {
    // Leads not yet won/lost/spam with no activity in the last 5 days.
    // eslint-disable-next-line react-hooks/purity -- cutoff intentionally reads current time
    const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
    return leads
      .filter((l) => !['won', 'lost', 'spam'].includes(l.status))
      .filter((l) => {
        const t = l.lastActivityAt ? new Date(l.lastActivityAt).getTime() : 0;
        return t < cutoff;
      })
      .slice(0, 5);
  }, [leads]);

  const pipelineSnapshot = useMemo(() => {
    const openStages = pipelineStages.filter((s) => !s.isWon && !s.isLost && !s.isSpam);
    const totalValue = deals
      .filter((d) => openStages.some((s) => s.key === d.stage))
      .reduce((sum, d) => sum + (d.value ?? 0), 0);
    const segments = openStages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage.key);
      const value = stageDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
      return { stage, count: stageDeals.length, value };
    });
    return { segments, totalValue };
  }, [deals, pipelineStages]);

  const recentSubmissions = useMemo(
    () => [...submissions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
    [submissions],
  );

  const stageColors: Record<string, string> = {
    new: '#3b82f6',
    contacted: '#f59e0b',
    qualified: '#6366f1',
    proposal: '#0ea5e9',
    won: '#22c55e',
    lost: '#ef4444',
    spam: '#64748b',
  };

  const handleAddLead = async () => {
    const title = window.prompt('New lead title');
    if (!title || !title.trim()) return;
    await createLead({ title: title.trim(), ownerId: 'you' });
    setActiveCRMPage('leads');
  };
  const handleAddCompany = async () => {
    const name = window.prompt('New company name');
    if (!name || !name.trim()) return;
    await createCompany({ name: name.trim(), ownerId: 'you' });
    setActiveCRMPage('companies');
  };
  const handleCreateFollowUp = () => {
    // Switch to the lead most needing follow-up; the AI sidebar can draft.
    if (followUpsDue[0]) {
      setActiveLeadId(followUpsDue[0].id);
      setActiveCRMPage('leads');
    }
  };

  return (
    <div className="crm-page">
      <div className="ui-card crm-page-header">
        <div className="crm-page-header-main">
          <div className="crm-page-header-title">CRM Dashboard</div>
          <div className="crm-page-header-meta">
            <span className="crm-page-header-meta-item">
              <CalendarClock /> {new Date().toLocaleDateString('tr-TR', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <span className="crm-page-header-meta-item">{leads.length} leads · {deals.length} deals · {companies.length} companies</span>
          </div>
        </div>
        <div className="crm-page-header-actions">
          <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={handleAddLead}>
            <UserPlus /> Add lead
          </button>
          <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={handleAddCompany}>
            <Building2 /> Add company
          </button>
          <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={handleCreateFollowUp}>
            <CalendarClock /> Follow-up
          </button>
          <button type="button" className="ui-button crm-btn crm-btn--sm ui-button--primary crm-btn--primary" onClick={() => { setActiveCRMPage('forms'); setActiveFormsPage('list'); }}>
            <SquarePen /> Open Forms
          </button>
        </div>
      </div>

      <div className="ui-panel-body crm-page-body">
        <div className="crm-kpi-row">
          <KPICard label="New Leads" value={kpis.newLeads} icon={UserPlus} delta="this period" deltaPositive />
          <KPICard label="Open Deals" value={kpis.openDeals} icon={KanbanSquare} delta={`${formatCurrency(kpis.totalPipelineValue)} pipeline`} deltaPositive />
          <KPICard label="Conversion Rate" value={formatPercent(kpis.conversionRate)} icon={Target} delta={`${formatCurrency(kpis.wonDealsValue)} won`} deltaPositive />
          <KPICard label="Tasks Due" value={kpis.tasksDue} icon={CheckCircle2} delta="today" deltaPositive={false} />
        </div>

        <div className="crm-dashboard-grid">
          <div className="ui-card crm-card">
            <div className="crm-card-header">
              <span className="crm-card-title">Recent Leads</span>
              <button type="button" className="ui-button crm-card-link" onClick={() => setActiveCRMPage('leads')}>View all →</button>
            </div>
            <div className="crm-card-body">
              {recentLeads.length === 0 ? (
                <div className="crm-muted-block">No leads yet.</div>
              ) : (
                recentLeads.map((lead) => {
                  const company = companies.find((c) => c.id === lead.companyId);
                  return (
                    <div
                      key={lead.id}
                      className="ui-list-row crm-compact-row"
                      onClick={() => { setActiveLeadId(lead.id); setActiveCRMPage('leads'); }}
                    >
                      <div className="crm-compact-row-main">
                        <span className="crm-compact-row-title">{lead.title}</span>
                        <span className="crm-compact-row-sub">{company?.name ?? '—'} · {lead.source ?? '—'}</span>
                      </div>
                      <div className="crm-compact-row-side">
                        <ScoreBadge score={lead.score} compact />
                        <StatusBadge stage={lead.status} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="ui-card crm-card">
            <div className="crm-card-header">
              <span className="crm-card-title">Follow-ups Due</span>
              <button type="button" className="ui-button crm-card-link" onClick={handleCreateFollowUp}>Open oldest →</button>
            </div>
            <div className="crm-card-body">
              {followUpsDue.length === 0 ? (
                <div className="crm-muted-block">All caught up — no stale leads.</div>
              ) : (
                followUpsDue.map((lead) => (
                  <div
                    key={lead.id}
                    className="ui-list-row crm-compact-row"
                    onClick={() => { setActiveLeadId(lead.id); setActiveCRMPage('leads'); }}
                  >
                    <div className="crm-compact-row-main">
                      <span className="crm-compact-row-title">{lead.title}</span>
                      <span className="crm-compact-row-sub">Last activity {formatRelative(lead.lastActivityAt)}</span>
                    </div>
                    <div className="crm-compact-row-side">
                      <StatusBadge stage={lead.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="ui-card crm-card">
            <div className="crm-card-header">
              <span className="crm-card-title">Pipeline Snapshot</span>
              <button type="button" className="ui-button crm-card-link" onClick={() => setActiveCRMPage('pipeline')}>Open pipeline →</button>
            </div>
            <div className="crm-card-body">
              {pipelineSnapshot.totalValue > 0 ? (
                <>
                  <div className="crm-pipeline-bar">
                    {pipelineSnapshot.segments.map((seg) => {
                      const pct = pipelineSnapshot.totalValue > 0 ? (seg.value / pipelineSnapshot.totalValue) * 100 : 0;
                      if (pct === 0) return null;
                      return (
                        <div
                          key={seg.stage.id}
                          className="crm-pipeline-bar-seg"
                          style={{ width: `${pct}%`, background: stageColors[seg.stage.key] ?? '#999' }}
                          title={`${seg.stage.label}: ${formatCurrency(seg.value)} (${seg.count})`}
                        />
                      );
                    })}
                  </div>
                  <div className="crm-pipeline-bar-legend">
                    {pipelineSnapshot.segments.map((seg) => (
                      <span key={seg.stage.id} className="crm-pipeline-bar-legend-item">
                        <span className="crm-pipeline-bar-legend-dot" style={{ background: stageColors[seg.stage.key] ?? '#999' }} />
                        {seg.stage.label} · {seg.count} · {formatCurrency(seg.value)}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="crm-muted-block">No open deals.</div>
              )}
            </div>
          </div>

          <div className="ui-card crm-card">
            <div className="crm-card-header">
              <span className="crm-card-title">Recent Form Submissions</span>
              <button type="button" className="ui-button crm-card-link" onClick={() => { setActiveCRMPage('forms'); setActiveFormsPage('submissions'); }}>Open Forms →</button>
            </div>
            <div className="crm-card-body">
              {recentSubmissions.length === 0 ? (
                <div className="crm-muted-block">No submissions yet.</div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Form</th>
                      <th>Status</th>
                      <th>Domain</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSubmissions.map((sub) => {
                      const form = forms.find((f) => f.id === sub.formId);
                      return (
                        <tr key={sub.id}>
                          <td className="trunc">{form?.name ?? sub.formId}</td>
                          <td><StatusBadge stage={sub.status === 'spam' ? 'spam' : sub.status === 'converted' ? 'won' : 'new'} label={sub.status} /></td>
                          <td className="trunc">{sub.sourceDomain ?? '—'}</td>
                          <td>{formatRelative(sub.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="ui-card crm-card">
          <div className="crm-card-title">Quick actions</div>
          <div className="crm-dashboard-quick-actions">
            <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={handleAddLead}>
              <UserPlus /> Add lead
            </button>
            <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={handleAddCompany}>
              <Building2 /> Add company
            </button>
            <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={handleCreateFollowUp}>
              <CalendarClock /> Create follow-up task
            </button>
            <button type="button" className="ui-button crm-btn crm-btn--sm ui-button--primary crm-btn--primary" onClick={() => { setActiveCRMPage('forms'); setActiveFormsPage('list'); }}>
              <SquarePen /> Open Forms module
            </button>
            <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={() => setActiveCRMPage('pipeline')}>
              <KanbanSquare /> Open pipeline
            </button>
            <button type="button" className="ui-button crm-btn crm-btn--sm" onClick={() => setActiveCRMPage('contacts')}>
              <Users /> Open contacts
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
