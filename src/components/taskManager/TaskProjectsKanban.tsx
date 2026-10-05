import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  FolderPlus,
  GripVertical,
  User,
  Users,
} from 'lucide-react';
import '../crm/crm.css';
import './taskProjectsKanban.css';
import './taskDetail.css';
import { useTranslation } from 'react-i18next';
import { formatShortDate } from './taskMetadataUtils';
import { TaskDueDatePicker } from './TaskCalendarDatePicker';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { kanbanColumnsForClient, projectsForClient, resolveQuickCreateProjectId } from '../../stores/taskSelection';
import { useClientStore } from '../../stores/clientStore';
import type { Task } from '../../types';
import { AddNewClientButton } from './AddNewClientButton';
import { TaskKanbanAddTask } from './TaskKanbanAddTask';
import './taskList.css';

const PROJECT_DOT_COLORS: Record<string, string> = {
  'text-blue-500': '#3b82f6',
  'text-emerald-500': '#10b981',
  'text-amber-500': '#f59e0b',
  'text-rose-500': '#f43f5e',
  'text-violet-500': '#8b5cf6',
  'text-cyan-500': '#06b6d4',
  'text-orange-500': '#f97316',
  'text-pink-500': '#ec4899',
};

function projectDotColor(color?: string): string {
  return (color && PROJECT_DOT_COLORS[color]) || 'var(--c-text-3)';
}

interface Column {
  id: string; // project id
  name: string;
  color?: string;
  tasks: Task[];
}

interface TaskKanbanCardProps {
  task: Task;
  isActive: boolean;
  onClick: (taskId: string) => void;
  dragLabel?: string;
}

export function TaskKanbanCard({ task, isActive, onClick, dragLabel = 'Drag to move project' }: TaskKanbanCardProps) {
  const { t } = useTranslation();
  const updateTask = useTaskStore((s) => s.updateTask);
  const projects = useProjectStore((s) => s.projects);
  const clients = useClientStore((s) => s.clients);
  const project = projects.find((item) => item.id === task.projectId);
  const client = clients.find((item) => item.id === project?.clientId);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.setData('application/x-task-card', task.id);
    setIsDragging(true);
  };

  return (
    <div
      className={`crm-kanban-card task-kanban-card${isActive ? ' crm-kanban-card--active' : ''}${isDragging ? ' crm-kanban-card--dragging' : ''}`}
      draggable
      role="button"
      tabIndex={0}
      onClick={() => onClick(task.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(task.id);
        }
      }}
      onDragStart={handleDragStart}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="task-kanban-card-header">
        <div
          className="crm-kanban-card-date"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <TaskDueDatePicker
            value={task.date}
            onChange={(iso) => { updateTask(task.id, { date: iso }); }}
            buttonClassName="tdp-meta-field-btn"
            ariaLabel={t('tasks.dueDateCalendar')}
            title={task.date || t('tasks.dueDateCalendar')}
          >
            <Calendar size={12} />
            <span className="tdp-meta-field-label">
              {task.date ? formatShortDate(task.date) : t('tasks.noDate')}
            </span>
          </TaskDueDatePicker>
        </div>
        <div
          className="task-kanban-card-assignment"
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="task-kanban-card-picker" title={client?.name ?? t('tasks.selectClient')}>
            <User size={12} aria-hidden="true" />
            <span>{client?.name ?? t('tasks.selectClient')}</span>
            <select
              aria-label={t('tasks.selectClient')}
              value={client?.id ?? ''}
              onChange={(e) => {
                const clientId = e.target.value;
                if (clientId === client?.id) return;
                const projectId = resolveQuickCreateProjectId(clientId, null, projects)
                  ?? projectsForClient(projects, clientId)[0]?.id;
                if (projectId) void updateTask(task.id, { projectId });
              }}
            >
              {!client && <option value="" disabled>{t('tasks.selectClient')}</option>}
              {clients.map((item) => (
                <option key={item.id} value={item.id} disabled={!projects.some((entry) => entry.clientId === item.id)}>{item.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div
          className="crm-kanban-card-drag"
          title={dragLabel}
          draggable
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.stopPropagation();
            handleDragStart(e);
          }}
        >
          <GripVertical size={12} />
        </div>
      </div>
      <div className="crm-kanban-card-title-zone">
        <span className="crm-kanban-card-title">{task.title}</span>
      </div>
      {task.assignees.length > 0 && (
        <div className="crm-kanban-card-footer">
          <span className="crm-kanban-card-meta-item">
            <Users size={11} />
            <span className="trunc">{task.assignees.length}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function TaskProjectsKanban() {
  const { t } = useTranslation();
  const tasks = useTaskStore((s) => s.tasks);
  const clients = useClientStore((s) => s.clients);
  const [clientFilterId, setClientFilterId] = useState<string | null>(null);
  const activeClientFilterId = clients.some((client) => client.id === clientFilterId) ? clientFilterId : null;
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);
  const openTaskInActiveTab = useTaskStore((s) => s.openTaskInActiveTab);
  const { projects, createProject } = useProjectStore();
  const [newProjectClientId, setNewProjectClientId] = useState('');

  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingProject) newProjectInputRef.current?.focus();
  }, [addingProject]);

  const livingTasks = useMemo(() => tasks.filter((t) => !t.deletedAt), [tasks]);

  const columns: Column[] = useMemo(() => {
    const byId = new Map(livingTasks.map((task) => [task.id, task]));
    return kanbanColumnsForClient(projects, livingTasks, null).map((col) => ({
      id: col.id,
      name: col.name,
      color: col.color,
      tasks: col.taskIds
        .map((id) => byId.get(id))
        .filter((task): task is Task => task !== undefined),
    }));
  }, [projects, livingTasks]);

  const startAddProject = (clientId: string) => {
    setNewProjectClientId(clientId);
    setAddingProject(true);
    setNewProjectName('');
  };

  const cancelAddProject = () => {
    setAddingProject(false);
    setNewProjectName('');
  };

  const submitNewProject = async () => {
    const name = newProjectName.trim();
    if (!name || !newProjectClientId) return;
    if (await createProject(name, newProjectClientId)) cancelAddProject();
  };

  const handleMove = async (taskId: string, columnId: string) => {
    if (!columns.some((col) => col.id === columnId)) return;
    const task = livingTasks.find((t) => t.id === taskId);
    if (!task || task.projectId === columnId) return;
    await updateTask(taskId, { projectId: columnId });
  };

  const newProjectForm = (clientId: string) => addingProject && newProjectClientId === clientId ? (
    <div className="task-kanban-add-column task-kanban-add-column--form">
      <input
        ref={newProjectInputRef}
        type="text"
        className="task-kanban-add-column-input ctrl"
        value={newProjectName}
        onChange={(e) => setNewProjectName(e.target.value)}
        placeholder="Project name"
        maxLength={80}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submitNewProject();
          if (e.key === 'Escape') cancelAddProject();
        }}
      />
      <div className="task-kanban-add-column-actions">
        <button
          type="button"
          className="crm-btn crm-btn--primary crm-btn--sm"
          disabled={!newProjectName.trim() || !newProjectClientId}
          onClick={() => void submitNewProject()}
        >
          Add
        </button>
        <button type="button" className="crm-btn crm-btn--sm" onClick={cancelAddProject}>
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      className="task-kanban-add-column"
      onClick={() => startAddProject(clientId)}
      title="Add project"
    >
      <FolderPlus size={14} />
      <span>New project</span>
    </button>
  );

  return (
    <div className="crm-page">
      <div className="crm-page-body" style={{ paddingTop: 14 }}>
        <div className="task-kanban-client-actions" role="group" aria-label={t('tasks.clients')}>
          <AddNewClientButton showLabel />
          <div className="task-kanban-client-filters">
            <button type="button" aria-pressed={activeClientFilterId === null} onClick={() => setClientFilterId(null)}>
              {t('tasks.allClients')}
            </button>
            {clients.map((client) => (
              <button key={client.id} type="button" aria-pressed={activeClientFilterId === client.id} onClick={() => setClientFilterId(client.id)}>
                {client.name}
              </button>
            ))}
          </div>
        </div>

        {clients.filter((client) => activeClientFilterId === null || client.id === activeClientFilterId).map((client) => (
          <section key={client.id} className="task-kanban-client-section" aria-label={client.name}>
            <h2 className="task-kanban-client-heading">{client.name}</h2>
            <div className="crm-kanban task-kanban-client-row" onDragEnd={() => setDropTarget(null)}>
          {columns.filter((col) => projects.some((project) => project.id === col.id && project.clientId === client.id)).map((col) => {
            const isDrop = dropTarget === col.id;
            return (
              <div
                key={col.id}
                className={`crm-kanban-column${isDrop ? ' crm-kanban-column--drop-target' : ''}`}
                data-project={col.id}
              >
                <div className="crm-kanban-column-header">
                  <span className="crm-kanban-column-title">
                    <span
                      className="crm-kanban-column-dot"
                      style={{ background: projectDotColor(col.color) }}
                    />
                    {col.name}
                  </span>
                </div>
                <div
                  className="crm-kanban-column-body"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTarget(col.id);
                  }}
                  onDragLeave={(e) => {
                    const nextTarget = e.relatedTarget;
                    if (!(nextTarget instanceof Node) || !e.currentTarget.contains(nextTarget)) {
                      setDropTarget((cur) => (cur === col.id ? null : cur));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const taskId =
                      e.dataTransfer.getData('application/x-task-card') ||
                      e.dataTransfer.getData('text/plain');
                    setDropTarget(null);
                    if (taskId) {
                      void handleMove(taskId, col.id).catch((err) => {
                        console.error('[TaskProjectsKanban] Failed to move task:', err);
                      });
                    }
                  }}
                >
                  {col.tasks.length === 0 && (
                    <div className="crm-kanban-column-empty subtle">No tasks</div>
                  )}
                  {col.tasks.map((t) => (
                    <TaskKanbanCard
                      key={t.id}
                      task={t}
                      isActive={t.id === activeTaskId}
                      onClick={openTaskInActiveTab}
                    />
                  ))}
                </div>
                <TaskKanbanAddTask projectId={col.id} />
              </div>
            );
          })}
          {newProjectForm(client.id)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
