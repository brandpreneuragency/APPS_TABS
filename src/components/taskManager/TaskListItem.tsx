import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../stores/taskStore';
import type { Task } from '../../types';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLongPress } from '../../hooks/useLongPress';
import { TaskContextMenu } from './TaskContextMenu';
import './subtaskCard.css';

interface TaskListItemProps {
  task: Task;
  isActive: boolean;
  onClick: () => void;
}

export function TaskListItem({ task, isActive, onClick }: TaskListItemProps) {
  const { t } = useTranslation();
  const updateTask = useTaskStore((state) => state.updateTask);
  const metaStyle = {
    color: 'var(--c-text-3)',
    fontSize: 'var(--fs-sm)',
  } as const;
  const { getProjectById } = useProjectStore();
  const { getClientById } = useClientStore();
  const project = getProjectById(task.projectId);
  const client = getClientById(project?.clientId ?? null);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const updateInFlight = useRef(false);
  const previousStatus = useRef<Task['status']>(task.status === 'completed' ? 'pending' : task.status);
  const isCompleted = task.status === 'completed';

  useEffect(() => {
    if (!isCelebrating) return;
    const timer = window.setTimeout(() => setIsCelebrating(false), 900);
    return () => window.clearTimeout(timer);
  }, [isCelebrating]);

  const changeStatus = async () => {
    if (updateInFlight.current) return;
    const nextStatus = isCompleted ? previousStatus.current : 'completed';
    if (!isCompleted) previousStatus.current = task.status;
    updateInFlight.current = true;
    setIsUpdating(true);
    setIsCelebrating(false);
    setStatusError(false);
    setAnnouncement('');
    try {
      await updateTask(task.id, { status: nextStatus });
      const savedTask = useTaskStore.getState().tasks.find((item) => item.id === task.id);
      if (savedTask?.status !== nextStatus) {
        setStatusError(true);
        return;
      }
      setIsCelebrating(nextStatus === 'completed');
      setAnnouncement(t(nextStatus === 'completed' ? 'tasks.taskCompleted' : 'tasks.taskReopened', { title: task.title }));
    } catch {
      setStatusError(true);
    } finally {
      updateInFlight.current = false;
      setIsUpdating(false);
    }
  };

  const [year, month, day] = task.date.split('-').map(Number);
  const dueDate = new Date(year, month - 1, day, 12);
  const monthLabel = dueDate.toLocaleDateString('tr-TR', { month: 'short' });
  const dateLabel = `${day}.${monthLabel}`;

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
      <div
        className={`task-card${isCompleted ? ' task-card--completed' : ''}${isCelebrating ? ' task-card--celebrating' : ''}`}
        onClick={onClick}
        aria-busy={isUpdating}
      >
        <button
          type="button"
          onContextMenu={handleContextMenu}
          {...longPress}
          className={`task-item${isActive ? ' task-item--on' : ''}`}
        >
          <div className="row-xs">
            <div className="flex items-center gap-1 min-w-0">
              {client && (
                <div className="meta trunc" style={{ ...metaStyle, color: 'var(--c-text-3)', fontSize: 'var(--fs-xs)' }}>
                  {client.name} <span aria-hidden="true">/</span>
                </div>
              )}
              <span className="meta trunc" style={{ ...metaStyle, color: 'var(--c-text-3)', fontSize: 'var(--fs-xs)' }}>
                {project?.name ?? 'Uncategorized'}
              </span>
            </div>
            <div className="task-item-due-date">
              {!isCompleted && <span className="meta" style={{ ...metaStyle, fontSize: 'var(--fs-xs)' }}>{dateLabel}</span>}
            </div>
          </div>
          <div className="task-title">{task.title}</div>
        </button>
        <button
          type="button"
          className={`task-item-complete-overlay${isCompleted ? ' task-item-done-badge' : ''}`}
          aria-pressed={isCompleted}
          aria-label={t(isCompleted ? 'tasks.reopenTask' : 'tasks.completeTask')}
          title={t(isCompleted ? 'tasks.reopenTask' : 'tasks.completeTask')}
          disabled={isUpdating}
          onClick={(event) => {
            event.stopPropagation();
            void changeStatus();
          }}
        >
          {isUpdating ? t('tasks.savingStatus') : t('tasks.done')}
        </button>
      </div>
      <span className="task-item-announcement" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {statusError && <p className="task-item-status-error" role="alert">{t('tasks.statusUpdateFailed')}</p>}

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
