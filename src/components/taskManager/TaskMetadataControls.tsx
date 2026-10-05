import { useState, useEffect, useRef } from 'react';
import { Building2, Calendar, Folder } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useClientStore } from '../../stores/clientStore';
import { projectsForClient } from '../../stores/taskSelection';
import { formatShortDate } from './taskMetadataUtils';
import { TaskDueDatePicker } from './TaskCalendarDatePicker';
import './taskDetail.css';

export function TaskClientProjectControls() {
  const { activeTaskId } = useUIStore();
  const storeActiveId = useTaskStore((s) => s.activeTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);
  const { projects } = useProjectStore();
  const { clients } = useClientStore();

  const effectiveId = activeTaskId ?? storeActiveId;
  const activeTask = tasks.find((t) => t.id === effectiveId) ?? null;
  const activeProject = activeTask ? projects.find((p) => p.id === activeTask.projectId) ?? null : null;
  const activeClient = activeProject ? clients.find((c) => c.id === activeProject.clientId) ?? null : null;
  const clientProjects = projectsForClient(projects, activeProject?.clientId ?? null);

  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showProjectPicker) return;
    const onDocClick = (e: MouseEvent) => {
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showProjectPicker]);

  return (
    <div className="tdp-meta-controls tdp-meta-controls--plain row-xs items-center justify-start nowrap">
      <div
        className="tdp-meta-field"
        title={activeClient ? `Client: ${activeClient.name}` : 'No client'}
      >
        <span className="tdp-meta-field-btn tdp-meta-display">
          <Building2 size={12} />
          <span className="tdp-meta-field-label">
            {activeClient ? activeClient.name : 'No client'}
          </span>
        </span>
      </div>
      <div ref={projectRef} className="tdp-meta-field">
        <button
          type="button"
          className="tdp-meta-field-btn"
          onClick={() => setShowProjectPicker(!showProjectPicker)}
          title={activeTask?.projectId ? 'Change project' : 'Set project'}
          disabled={!activeTask}
          style={{ color: activeTask?.projectId ? 'var(--c-text-1)' : 'var(--c-text-2)' }}
        >
          <Folder size={12} />
          <span className="tdp-meta-field-label">
            {activeProject ? activeProject.name : 'No project'}
          </span>
        </button>
        {showProjectPicker && activeTask && (
          <div className="drop" style={{ position: 'absolute', top: '100%', left: 0, minWidth: 192, marginTop: 0, zIndex: 1000 }}>
            {clientProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="drop-item"
                onClick={() => { updateTask(activeTask.id, { projectId: p.id }); setShowProjectPicker(false); }}
                style={{ fontSize: 'var(--fs-sm)' }}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskDueDateControl() {
  const { activeTaskId } = useUIStore();
  const storeActiveId = useTaskStore((s) => s.activeTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);

  const effectiveId = activeTaskId ?? storeActiveId;
  const activeTask = tasks.find((t) => t.id === effectiveId) ?? null;

  return (
    <div className="tdp-meta-controls tdp-meta-controls--plain row-xs items-center justify-start nowrap">
      <div className="tdp-meta-field">
        <TaskDueDatePicker
          value={activeTask?.date ?? ''}
          onChange={(iso) => { if (activeTask) updateTask(activeTask.id, { date: iso }); }}
          buttonClassName="tdp-meta-field-btn"
          ariaLabel={activeTask?.date ? `Due: ${activeTask.date}` : 'Set due date'}
          title={activeTask?.date ? `Due: ${activeTask.date}` : 'Set due date'}
          disabled={!activeTask}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: activeTask?.date ? 'var(--c-text-1)' : 'var(--c-text-2)' }}>
            <Calendar size={12} />
            <span className="tdp-meta-field-label">
              {activeTask?.date ? formatShortDate(activeTask.date) : 'No due date'}
            </span>
          </span>
        </TaskDueDatePicker>
      </div>
    </div>
  );
}

export function TaskMetadataControls() {
  return (
    <div className="tdp-meta-controls row-xs items-center justify-start nowrap">
      <TaskClientProjectControls />
      <TaskDueDateControl />
    </div>
  );
}
