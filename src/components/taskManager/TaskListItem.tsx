import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { Task } from '../../types';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useLongPress } from '../../hooks/useLongPress';
import { TaskContextMenu } from './TaskContextMenu';
import { SubtaskCard } from './SubtaskCard';

interface TaskListItemProps {
  task: Task;
  isActive: boolean;
  onClick: () => void;
  subtasks?: Task[];
}

export function TaskListItem({ task, isActive, onClick, subtasks = [] }: TaskListItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const activeTaskId = useTaskStore((state) => state.activeTaskId);
  const previousActiveTaskId = useRef(activeTaskId);
  const subtaskListId = useId();
  useEffect(() => {
    const activeTaskIsSubtask = subtasks.some((subtask) => subtask.id === activeTaskId);
    const previousTaskWasInGroup = previousActiveTaskId.current === task.id
      || subtasks.some((subtask) => subtask.id === previousActiveTaskId.current);
    if (previousTaskWasInGroup && !isActive && !activeTaskIsSubtask) setExpanded(false);
    previousActiveTaskId.current = activeTaskId;
  }, [activeTaskId, isActive, subtasks, task.id]);
  const completedCount = subtasks.filter((subtask) => subtask.status === 'completed').length;
  const metaStyle = {
    color: isActive ? 'var(--c-accent-3)' : 'var(--c-text-3)',
    fontSize: 'var(--fs-sm)',
  } as const;
  const { getProjectById } = useProjectStore();
  const { getClientById } = useClientStore();
  const project = getProjectById(task.projectId);
  const client = getClientById(project?.clientId ?? null);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const isToday = task.date === new Date().toISOString().slice(0, 10);
  const dateLabel = isToday
    ? 'Today'
    : new Date(task.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const openMenu = useCallback((x: number, y: number) => {
    setMenu({ x, y });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const longPress = useLongPress({
    onLongPress: (pos) => openMenu(pos.x, pos.y),
    delay: 500,
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  };

  return (
    <div className={`task-card-group${isActive ? ' task-card-group--active' : ''}`}>
      <div className="task-card">
        <button
          onClick={onClick}
          onContextMenu={handleContextMenu}
          {...longPress}
          className={`task-item${isActive ? ' task-item--on' : ''}`}
        >
          <div className="row-xs">
            <div className="flex items-center gap-1 min-w-0">
              {client && (
                <div className="meta trunc" style={{ ...metaStyle, color: 'var(--c-accent-3)' }}>
                  {client.name} <span aria-hidden="true">/</span>
                </div>
              )}
              <span className="meta trunc" style={{ ...metaStyle, color: 'var(--c-text-2)' }}>
                {project?.name ?? 'Uncategorized'}
              </span>
            </div>
          </div>
          <div className="task-title">{task.title}</div>
        </button>
        <div className="task-item-footer">
          {subtasks.length > 0 && (
            <button type="button" className="subtask-disclosure" aria-expanded={expanded}
              aria-label={`${t('tasks.subtasks')} ${completedCount}/${subtasks.length}`}
              aria-controls={subtaskListId} onClick={() => setExpanded((value) => !value)}>
              <ChevronRight size={14} aria-hidden="true" />
              <span>{t('tasks.subtasks')}</span>
              <span className="subtask-disclosure-count">{completedCount}/{subtasks.length}</span>
            </button>
          )}
          <div className="task-item-due-date">
            <span className="meta" style={metaStyle}>{dateLabel}</span>
          </div>
        </div>
      </div>

      {subtasks.length > 0 && (
        <ul id={subtaskListId} className="task-subtask-list" hidden={!expanded}
          aria-label={t('tasks.subtasks')}>
          {[...subtasks].sort((left, right) => left.order - right.order).map((subtask) => (
            <li key={subtask.id}><SubtaskCard task={subtask} /></li>
          ))}
        </ul>
      )}
      {menu && (
        <TaskContextMenu
          taskId={task.id}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
