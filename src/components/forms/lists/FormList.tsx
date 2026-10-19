import { useMemo } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import type { FormStatus } from '../../../types/forms';
import { StatusBadge } from '../components/StatusBadge';
import { Search, Inbox } from 'lucide-react';
import { TemplatesList } from './TemplatesList';
import '../forms.css';

type StatusFilter = 'all' | FormStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
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

export function FormList() {
  const forms = useFormsStore((s) => s.forms);
  const submissions = useFormsStore((s) => s.submissions);
  const activeFormId = useFormsStore((s) => s.activeFormId);
  const listFilters = useFormsStore((s) => s.listFilters);
  const setListFilters = useFormsStore((s) => s.setListFilters);
  const setActiveFormId = useFormsStore((s) => s.setActiveFormId);

  const activeFilter: StatusFilter = listFilters.status ?? 'all';

  const filtered = useMemo(() => {
    const search = (listFilters.search ?? '').trim().toLowerCase();
    return forms.filter((f) => {
      if (listFilters.status && f.status !== listFilters.status) return false;
      if (search) {
        const haystack = `${f.name} ${f.description ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [forms, listFilters]);

  const handleFilter = (key: StatusFilter) => {
    if (key === 'all') {
      setListFilters({ status: undefined });
    } else {
      setListFilters({ status: key });
    }
  };

  return (
    <>
      <div className="forms-list-filters">
        {STATUS_FILTERS.map((f) => (
          <button data-active={activeFilter === f.key}
            key={f.key}
            type="button"
            className={"ui-button " + (`forms-filter-chip${activeFilter === f.key ? ' forms-filter-chip--active' : ''}`)}
            onClick={() => handleFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="forms-list-search">
        <Search className="forms-muted" />
        <input className="ui-input"
          type="text"
          placeholder="Search forms"
          value={listFilters.search ?? ''}
          onChange={(e) => setListFilters({ search: e.target.value })}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="forms-list-empty-inline">
          {forms.length === 0 ? 'No forms yet. Use “New form” to create one.' : 'No forms match these filters.'}
        </div>
      ) : (
        filtered.map((form) => {
          const subCount = submissions.filter((s) => s.formId === form.id).length;
          const isActive = form.id === activeFormId;
          return (
            <button data-active={isActive}
              key={form.id}
              type="button"
              onClick={() => setActiveFormId(form.id)}
              className={"ui-list-row " + (`forms-list-item${isActive ? ' forms-list-item--active' : ''}`)}
            >
              <span className="forms-list-item-title">
                <span className="trunc forms-grow">{form.name}</span>
                <StatusBadge status={form.status} />
              </span>
              <span className="forms-list-item-meta">
                <Inbox />
                <span>{subCount} submission{subCount === 1 ? '' : 's'}</span>
                <span>·</span>
                <span>{form.fields.length} fields</span>
                <span>·</span>
                <span>{timeLabel(form.createdAt)}</span>
              </span>
            </button>
          );
        })
      )}

      <div className="forms-list-templates-section">
        <TemplatesList />
      </div>
    </>
  );
}
