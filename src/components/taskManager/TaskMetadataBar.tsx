import { useProjectStore } from '../../stores/projectStore';
import { HeaderDropdown } from '../ui/HeaderDropdown';
import type { Task } from '../../types';

function dateOptions() {
  const days: { label: string; value: string }[] = [{ label: 'No date', value: '' }];
  const today = new Date();
  const labels = ['Today', 'Tomorrow'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const val = d.toISOString().slice(0, 10);
    const label = i < 2 ? labels[i] : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    days.push({ label: `${label}`, value: val });
  }
  return days;
}

interface TaskMetadataBarProps {
  task: Task;
  onUpdate: (updates: Partial<Task>) => void;
}

export function TaskMetadataBar({ task, onUpdate }: TaskMetadataBarProps) {
  const { projects } = useProjectStore();
  const projectValue = task.projectId ?? '';

  return (
    <div id="task-metadata-bar" className="flex items-center gap-2 px-3 py-2.5" style={{borderBottom:'1px solid var(--c-border-1)'}}>
      <HeaderDropdown
        value={task.date}
        onChange={(next) => onUpdate({ date: next })}
        wrapperClassName="flex-1 min-w-0"
        options={dateOptions()}
      />
      <HeaderDropdown
        value={projectValue}
        onChange={(next) => { if (next) onUpdate({ projectId: next }); }}
        wrapperClassName="flex-1 min-w-0"
        options={[
          { value: '', label: 'No project' },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}
