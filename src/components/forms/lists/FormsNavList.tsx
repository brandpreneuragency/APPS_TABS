import { useMemo, useState } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import type { FormStatus } from '../../../types/forms';
import { StatusBadge } from '../components/StatusBadge';
import { Inbox, Clock } from 'lucide-react';
import '../forms.css';

type DashFilter = 'all' | FormStatus;

const DASH_FILTERS: { key: DashFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'published', label: 'Published' },
  { key: 'archived', label: 'Archived' },
];

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function FormsNavList() {
  const forms = useFormsStore((s) => s.forms);
  const submissions = useFormsStore((s) => s.submissions);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);
  const [filter, setFilter] = useState<DashFilter>('all');

  const recent = useMemo(() => {
    const sorted = [...forms].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const filtered = filter === 'all' ? sorted : sorted.filter((f) => f.status === filter);
    return filtered.slice(0, 12);
  }, [forms, filter]);

  const openForm = (formId: string) => {
    setActiveFormId(formId);
    setActiveFormsPage('list');
  };

  return (
    <>
      <div className="forms-list-filters">
        {DASH_FILTERS.map((f) => (
          <button data-active={filter === f.key}
            key={f.key}
            type="button"
            className={"ui-button " + (`forms-filter-chip${filter === f.key ? ' forms-filter-chip--active' : ''}`)}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {recent.length === 0 ? (
        <div className="forms-list-empty-inline">
          {forms.length === 0 ? 'No forms yet.' : 'No forms match this filter.'}
        </div>
      ) : (
        recent.map((form) => {
          const subCount = submissions.filter((s) => s.formId === form.id).length;
          return (
            <button
              key={form.id}
              type="button"
              onClick={() => openForm(form.id)}
              className="ui-list-row forms-list-item"
            >
              <span className="forms-list-item-title">
                <span className="trunc forms-grow">{form.name}</span>
                <StatusBadge status={form.status} />
              </span>
              <span className="forms-list-item-meta">
                <Inbox />
                <span>{subCount}</span>
                <span>·</span>
                <Clock />
                <span>{timeLabel(form.createdAt)}</span>
              </span>
            </button>
          );
        })
      )}
    </>
  );
}
