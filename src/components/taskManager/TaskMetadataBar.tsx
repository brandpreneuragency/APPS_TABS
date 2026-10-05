import { useProjectStore } from '../../stores/projectStore';
import { HeaderDropdown } from '../ui/HeaderDropdown';
import type { Task } from '../../types';
import { TaskDueDatePicker } from './TaskCalendarDatePicker';
import { formatShortDate } from './taskMetadataUtils';

interface TaskMetadataBarProps {
  task: Task;
  onUpdate: (updates: Partial<Task>) => void;
}

export function TaskMetadataBar({ task, onUpdate }: TaskMetadataBarProps) {
  const { projects } = useProjectStore();
  const projectValue = task.projectId ?? '';

  return (
    <div id="task-metadata-bar" className="flex items-center gap-2 px-3 py-2.5" style={{borderBottom:'1px solid var(--c-border-1)'}}>
      <TaskDueDatePicker
        value={task.date}
        onChange={(next) => onUpdate({ date: next })}
        buttonClassName="header-dropdown-button w-full row"
        ariaLabel={task.date ? `Due: ${task.date}` : 'Set due date'}
        title={task.date ? `Due: ${task.date}` : 'Set due date'}
      >
        <span className="trunc med">{task.date ? formatShortDate(task.date) : 'No date'}</span>
      </TaskDueDatePicker>
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
