import { useProjectStore } from '../../stores/projectStore';
import { HeaderDropdown } from '../ui/HeaderDropdown';

type DueDateOption = '' | 'today' | 'tomorrow' | 'upcoming' | 'overdue' | 'no_date';

interface TaskFiltersProps {
  selectedProjectId: string | null;
  selectedDueDate: DueDateOption;
  onProjectChange: (id: string | null) => void;
  onDueDateChange: (option: DueDateOption) => void;
}

const dueDateOptions = [
  { value: '', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'no_date', label: 'No date' },
];

export function TaskFilters({ selectedProjectId, selectedDueDate, onProjectChange, onDueDateChange }: TaskFiltersProps) {
  const { projects } = useProjectStore();
  const projectValue = selectedProjectId ?? '';

  return (
    <div
      id="task-filters"
      className="ui-toolbar"
      style={{
        display: 'flex',
        height: 'var(--control-height-sm)',
        borderBottom: '1px solid var(--c-border-1)',
        background: 'var(--c-background-3)',
        alignItems: 'center',
      }}
    >
      <HeaderDropdown
        value={selectedDueDate}
        onChange={(next) => onDueDateChange((next as DueDateOption) || '')}
        wrapperClassName="flex-1 min-w-0"
        options={dueDateOptions}
      />
      <HeaderDropdown
        value={projectValue}
        onChange={(next) => onProjectChange(next || null)}
        wrapperClassName="flex-1 min-w-0"
        options={[
          { value: '', label: 'All projects' },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}

export type { DueDateOption };
