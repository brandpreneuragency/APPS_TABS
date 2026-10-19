import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import '../crm/crm.css';
import './taskProjectsKanban.css';
import './taskDetail.css';
import './taskCalendar.css';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useClientStore } from '../../stores/clientStore';
import { useUIStore } from '../../stores/uiStore';
import type { Task } from '../../types';
import { useKanbanDropIndicator } from '../../hooks/useKanbanDropIndicator';
import { sortKanbanCards } from '../../services/kanbanOrder';
import { NAME_MAX } from '../../stores/taskTreeNames';
import { resolveCreateProjectName } from './createProjectName';
import { TaskQuickCreate } from './TaskQuickCreate';
import './taskList.css';

interface TaskKanbanCardProps {
  task: Task;
  isActive: boolean;
  onClick: (taskId: string) => void;
  dragLabel?: string;
  showActions?: boolean;
}

export function TaskKanbanCard({ task, isActive, onClick, dragLabel = 'Drag to move project', showActions = false }: TaskKanbanCardProps) {
  const { t } = useTranslation();
  const projects = useProjectStore((s) => s.projects);
  const clients = useClientStore((s) => s.clients);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const project = projects.find((item) => item.id === task.projectId);
  const client = clients.find((item) => item.id === project?.clientId);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menuButtonRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menuOpen]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('button')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.setData('application/x-task-card', task.id);
    setIsDragging(true);
  };

  return (
    <div
      className={`ui-card crm-kanban-card task-kanban-card${isActive ? ' crm-kanban-card--active' : ''}${isDragging ? ' crm-kanban-card--dragging' : ''}`}
      data-kanban-card-id={task.id}
      title={dragLabel}
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
      <div className="row-xs task-kanban-card-top">
        <div className="flex items-center gap-1 min-w-0">
          {client && (
            <div className="meta trunc">
              {client.name} <span aria-hidden="true">/</span>
            </div>
          )}
          <span className="meta trunc">
            {project?.name ?? 'Uncategorized'}
          </span>
        </div>
        {showActions && <div className="task-kanban-card-actions">
          <button ref={menuButtonRef} type="button" className="ui-icon-button task-kanban-card-menu-button"
            aria-label={t('tasks.actions', { title: task.title })} aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              if (menuOpen) {
                setMenuOpen(false);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const width = 160;
              const height = 132;
              setMenuPosition({
                left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
                top: rect.bottom + height <= window.innerHeight - 8 ? rect.bottom : Math.max(8, rect.top - height),
              });
              setMenuOpen(true);
            }}>
            <MoreHorizontal />
          </button>
          {menuOpen && createPortal(<div ref={menuRef} className="drop task-kanban-card-menu" role="menu" aria-label={t('tasks.actions', { title: task.title })}
            style={menuPosition}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                setMenuOpen(false);
                if (event.key === 'Escape') menuButtonRef.current?.focus();
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[index]?.focus();
            }}>
            <button type="button" className="ui-list-row drop-item" role="menuitem" onClick={() => {
              setMenuOpen(false);
              onClick(task.id);
            }}><Pencil />{t('tasks.edit')}</button>
            <button type="button" className="ui-list-row drop-item task-kanban-card-menu-done" role="menuitem"
              disabled={task.status === 'completed'} onClick={() => {
                setMenuOpen(false);
                void updateTask(task.id, { status: 'completed' });
              }}><Check />{t('tasks.done')}</button>
            <button type="button" className="ui-list-row drop-item task-kanban-card-menu-delete" role="menuitem" onClick={() => {
              setMenuOpen(false);
              void deleteTask(task.id);
            }}><Trash2 />{t('tasks.delete')}</button>
          </div>, document.body)}
        </div>}
      </div>
      <div className="crm-kanban-card-title-zone">
        <span className="crm-kanban-card-title">{task.title}</span>
      </div>
      {task.assignees.length > 0 && (
        <div className="crm-kanban-card-footer">
          <span className="crm-kanban-card-meta-item">
            <Users />
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
  const createClient = useClientStore((s) => s.createClient);
  const showToast = useUIStore((s) => s.showToast);
  const activeClientFilterId = useTaskStore((s) => s.selectedClientId);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);
  const openTaskInActiveTab = useTaskStore((s) => s.openTaskInActiveTab);
  const setActiveTaskPage = useUIStore((s) => s.setActiveTaskPage);
  const setTaskMode = useUIStore((s) => s.setTaskMode);
  const setContextPanelOpen = useUIStore((s) => s.setContextPanelOpen);
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const [newProjectClientId, setNewProjectClientId] = useState('');
  const drop = useKanbanDropIndicator('application/x-task-card');
  const [error, setError] = useState(false);
  const [quickCreateProjectId, setQuickCreateProjectId] = useState<string | null>(null);
  const [adding, setAdding] = useState<'client' | 'project' | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) newNameInputRef.current?.focus();
  }, [adding]);

  const visibleProjects = projects.filter((project) => !activeClientFilterId || project.clientId === activeClientFilterId);
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const visibleTasks = tasks.filter((task) => !task.deletedAt && visibleProjectIds.has(task.projectId));

  const submitNewEntry = async () => {
    const name = newName.trim();
    if (!name || !adding || creating || (adding === 'project' && !newProjectClientId)) return;
    const clientName = resolveCreateProjectName(name, clients.map((client) => client.name));
    if (adding === 'client' && clientName.status === 'duplicate') {
      showToast(t('tasks.clientExists', { name }), 'error');
      return;
    }
    setCreating(true);
    try {
      if (adding === 'client') {
        const created = await createClient(name);
        if (created) {
          showToast(t('tasks.clientCreated', { name: created.name }), 'info');
          setAdding(null);
        }
      } else if (await createProject(name, newProjectClientId)) setAdding(null);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="task-calendar task-projects-calendar" aria-label={t('navigation.projects')}>
      <div className="task-calendar-toolbar task-projects-toolbar">
        <div className="task-kanban-client-actions" role="group" aria-label={t('navigation.projects')}>
          <button type="button" className="ui-button task-list-add-project-btn" aria-label={t('tasks.addNewClient')} title={t('tasks.addNewClient')} disabled={creating} aria-expanded={adding === 'client'} aria-haspopup="dialog" onClick={() => {
            setNewName('');
            setAdding(adding === 'client' ? null : 'client');
          }}><Plus strokeWidth={2.25} /><span>{t('tasks.addNewClient')}</span></button>
          <button type="button" className="ui-button task-list-add-project-btn" aria-label={t('tasks.addNewProject')} title={t('tasks.addNewProject')} disabled={creating || !clients.length} aria-expanded={adding === 'project'} aria-haspopup="dialog" onClick={() => {
            setNewProjectClientId(activeClientFilterId ?? clients[0]?.id ?? '');
            setNewName('');
            setAdding(adding === 'project' ? null : 'project');
          }}><Plus />{t('tasks.addProjectToClient')}</button>
        </div>
      </div>
      {adding && <form key={adding} className="ui-panel-body task-projects-create-project" role="dialog" aria-label={t(adding === 'client' ? 'tasks.addNewClient' : 'tasks.addNewProject')}
        onSubmit={(event) => { event.preventDefault(); void submitNewEntry(); }}
        onKeyDown={(event) => { if (event.key === 'Escape' && !creating) setAdding(null); }}>
        {adding === 'project' && <select className="ui-input" aria-label={t('tasks.selectClient')} value={newProjectClientId} disabled={creating} onChange={(event) => setNewProjectClientId(event.target.value)}>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>}
        <input ref={newNameInputRef} className="ui-input" aria-label={t(adding === 'client' ? 'tasks.clientNamePlaceholder' : 'tasks.projectNamePlaceholder')} placeholder={t(adding === 'client' ? 'tasks.clientNamePlaceholder' : 'tasks.projectNamePlaceholder')} value={newName} maxLength={NAME_MAX} disabled={creating} onChange={(event) => setNewName(event.target.value)} />
        <button type="submit" className="ui-button" disabled={!newName.trim() || (adding === 'project' && !newProjectClientId) || creating}>{t(adding === 'client' ? 'tasks.addClient' : 'tasks.addProject')}</button>
        <button type="button" className="ui-button" disabled={creating} onClick={() => setAdding(null)}>{t('confirm.cancel')}</button>
      </form>}
      {error && <div role="alert">{t('tasks.moveFailed')}</div>}
      <div className="task-calendar-board task-calendar-board--week">
        {visibleProjects.map((project) => {
          const client = clients.find((item) => item.id === project.clientId);
          const projectTasks = sortKanbanCards(visibleTasks.filter((task) => task.projectId === project.id));
          return <section key={project.id} data-project={project.id} aria-label={`${client?.name ?? ''} / ${project.name}`}
            className={`crm-kanban-column task-calendar-day${drop.targetColumn === project.id ? ' crm-kanban-column--drop-target' : ''}`}
            {...drop.handlers(project.id, (id, beforeId) => {
              if (!visibleTasks.some((task) => task.id === id)) return;
              setError(false);
              void updateTask(id, { projectId: project.id }, { field: 'projectId', beforeId }).catch(() => setError(true));
            })}>
            <div className="crm-kanban-column-header">
              <span className="task-calendar-day-label task-projects-column-label">
                {client && <><span className="meta trunc">{client.name}</span><span aria-hidden="true">/</span></>}
                <strong className="crm-kanban-column-title">{project.name}</strong>
              </span>
              <button type="button" className="ui-icon-button" aria-label={`${t('tasks.addTask')} ${project.name}`} title={t('tasks.addTask')}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setQuickCreateProjectId(quickCreateProjectId === project.id ? null : project.id)}><Plus /></button>
            </div>
            {quickCreateProjectId === project.id && <div className="task-quick-create-wrapper">
              <TaskQuickCreate projectId={project.id} onClose={() => setQuickCreateProjectId(null)} onSuccess={() => setQuickCreateProjectId(null)} />
            </div>}
            <div className="crm-kanban-column-body">
              {drop.indicator(project.id)}
              {!projectTasks.length && <div className="crm-kanban-column-empty">{t('navigation.noTasks')}</div>}
              {projectTasks.map((task) => <TaskKanbanCard key={task.id} task={task} isActive={task.id === activeTaskId} dragLabel={t('tasks.moveToProject')} showActions
                onClick={(id) => { openTaskInActiveTab(id); setActiveTaskPage('list'); setTaskMode(true); setContextPanelOpen('tasks', true); }} />)}
            </div>
          </section>;
        })}
        {!visibleProjects.length && <div className="task-kanban-empty">{t('navigation.noProjects')}</div>}
      </div>
    </section>
  );
}
