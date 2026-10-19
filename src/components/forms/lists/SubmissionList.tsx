import { useMemo, useState } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import type { FormSubmissionStatus } from '../../../types/forms';
import { SpamBadge } from '../components/SpamBadge';
import { Search } from 'lucide-react';
import '../forms.css';

type StatusFilter = 'all' | FormSubmissionStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'converted', label: 'Converted' },
  { key: 'spam', label: 'Spam' },
];

function asString(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '';
}

function submissionLabel(fields: Record<string, unknown>): string {
  const name = asString(fields['name']) || asString(fields['first_name']);
  if (name) return name;
  const email = asString(fields['email']);
  if (email) return email;
  return 'Anonymous submission';
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

export function SubmissionList() {
  const submissions = useFormsStore((s) => s.submissions);
  const forms = useFormsStore((s) => s.forms);
  const activeSubmissionId = useFormsStore((s) => s.activeSubmissionId);
  const setActiveSubmissionId = useFormsStore((s) => s.setActiveSubmissionId);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [formFilter, setFormFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const formNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of forms) map.set(f.id, f.name);
    return map;
  }, [forms]);

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const s of submissions) if (s.sourceDomain) set.add(s.sourceDomain);
    return Array.from(set).sort();
  }, [submissions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (formFilter !== 'all' && s.formId !== formFilter) return false;
        if (domainFilter !== 'all' && s.sourceDomain !== domainFilter) return false;
        if (q) {
          const label = submissionLabel(s.fields).toLowerCase();
          const formName = (formNameById.get(s.formId) ?? '').toLowerCase();
          const email = asString(s.fields['email']).toLowerCase();
          if (!label.includes(q) && !formName.includes(q) && !email.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [submissions, statusFilter, formFilter, domainFilter, search, formNameById]);

  return (
    <>
      <div className="forms-list-search">
        <Search className="forms-muted" />
        <input className="ui-input"
          type="text"
          placeholder="Search submissions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="forms-list-filters">
        {STATUS_FILTERS.map((f) => (
          <button data-active={statusFilter === f.key}
            key={f.key}
            type="button"
            className={"ui-button " + (`forms-filter-chip${statusFilter === f.key ? ' forms-filter-chip--active' : ''}`)}
            onClick={() => setStatusFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="forms-list-filters">
        <select
          className="ui-input forms-select"
          style={{ fontSize: 'var(--fs-xs)', flex: '1 1 110px' }}
          value={formFilter}
          onChange={(e) => setFormFilter(e.target.value)}
        >
          <option value="all">All forms</option>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          className="ui-input forms-select"
          style={{ fontSize: 'var(--fs-xs)', flex: '1 1 110px' }}
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          <option value="all">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="forms-list-empty-inline">
          {submissions.length === 0 ? 'No submissions yet.' : 'No submissions match these filters.'}
        </div>
      ) : (
        filtered.map((s) => {
          const isActive = s.id === activeSubmissionId;
          return (
            <button data-active={isActive}
              key={s.id}
              type="button"
              onClick={() => setActiveSubmissionId(s.id)}
              className={"ui-list-row " + (`forms-list-item${isActive ? ' forms-list-item--active' : ''}`)}
            >
              <span className="forms-list-item-title">
                <span className="trunc forms-grow">{submissionLabel(s.fields)}</span>
                <SpamBadge spamScore={s.spamScore} />
              </span>
              <span className="forms-list-item-meta">
                <span className="trunc">{formNameById.get(s.formId) ?? 'Form'}</span>
                {s.sourceDomain ? (
                  <>
                    <span>·</span>
                    <span className="trunc">{s.sourceDomain}</span>
                  </>
                ) : null}
                <span>·</span>
                <span>{timeLabel(s.createdAt)}</span>
              </span>
            </button>
          );
        })
      )}
    </>
  );
}
