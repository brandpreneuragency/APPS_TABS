import { useState, useMemo } from 'react';
import { Plus, Pencil, Folder, Calendar } from 'lucide-react';
import type { Task } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { filterTasksForSelection, projectsForClient } from '../../stores/taskSelection';
import { TaskDueDatePicker } from './TaskCalendarDatePicker';

interface TaskProjectViewProps {
  tasks: Task[];
  onPrefillText: (text: string) => void;
  assignedProject?: string | null;
  onSetProject?: (project: string | null) => void;
}

export function TaskProjectView({ tasks, onSetProject }: TaskProjectViewProps) {
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const selectedClientId = useTaskStore((s) => s.selectedClientId);
  const selectedProjectId = useTaskStore((s) => s.selectedProjectId);
  const { projects } = useProjectStore();
  const [maxDate, setMaxDate] = useState<string>('');

  const selectedTasks = useMemo(
    () => filterTasksForSelection(tasks, projects, selectedClientId, selectedProjectId),
    [tasks, projects, selectedClientId, selectedProjectId],
  );

  const visibleProjects = useMemo(() => {
    if (selectedProjectId) return projects.filter((p) => p.id === selectedProjectId);
    if (selectedClientId) return projectsForClient(projects, selectedClientId);
    return projects;
  }, [projects, selectedClientId, selectedProjectId]);

  const filtered = useMemo(() => {
    return selectedTasks.filter((t) => {
      if (maxDate && t.date > maxDate) return false;
      return true;
    });
  }, [selectedTasks, maxDate]);

  const grouped = useMemo(() => {
    const map: Record<string, { project: typeof projects[0] | null; tasks: Task[] }> = {};
    for (const t of filtered) {
      const key = t.projectId ?? '__none__';
      if (!map[key]) {
        map[key] = {
          project: t.projectId ? projects.find((p) => p.id === t.projectId) ?? null : null,
          tasks: [],
        };
      }
      map[key].tasks.push(t);
    }
    for (const p of visibleProjects) {
      if (!map[p.id]) {
        map[p.id] = { project: p, tasks: [] };
      }
    }
    return Object.entries(map).sort(([, a], [, b]) => {
      const aName = a.project?.name ?? 'Uncategorized';
      const bName = b.project?.name ?? 'Uncategorized';
      return aName.localeCompare(bName);
    });
  }, [filtered, projects, visibleProjects]);

  const importanceDot = (imp: string) => {
    const cls = imp === 'high' ? 'task-dot-high' : imp === 'medium' ? 'task-dot-medium' : 'task-dot-low';
    return <span className={cls} />;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="task-project-view">
      <div className="project-filter-bar">
        <TaskDueDatePicker
          value={maxDate}
          onChange={(iso) => setMaxDate(iso)}
          buttonClassName="ctrl-xs c-ptr"
          ariaLabel={maxDate ? `Due before ${maxDate}` : 'Due before'}
          title={maxDate ? `Due before ${maxDate}` : 'Due before'}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <Calendar size={12} />
            <span>{maxDate || 'Due before'}</span>
          </span>
        </TaskDueDatePicker>
      </div>

      {grouped.map(([, { project, tasks: groupTasks }]) => {
        const projectName = project?.name ?? 'Uncategorized';
        return (
          <div key={project?.id ?? '__none__'} className="project-group-card">
            <div className="project-group-header">
              <div className="project-group-title">
                <Folder size={12} className="subtle" />
                <span>{projectName}</span>
              </div>
              <div className="project-group-actions">
                <button type="button" className="project-group-btn" title="Edit project">
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="project-group-btn"
                  title="Add task"
                  onClick={() => onSetProject?.(projectName === 'Uncategorized' ? null : projectName)}
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
            {groupTasks.length === 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)', fontStyle: 'italic', padding: '4px 0' }}>
                No tasks
              </div>
            )}
            {groupTasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`calendar-task-row${t.id === activeTaskId ? ' calendar-task-row--active' : ''}`}
                onClick={() => useTaskStore.getState().openTaskInActiveTab(t.id)}
              >
                {importanceDot(t.importance)}
                <span className="trunc">{t.title}</span>
                <span className="calendar-task-project">{formatDate(t.date)}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
