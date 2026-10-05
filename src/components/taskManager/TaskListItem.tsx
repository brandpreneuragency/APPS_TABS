import { useState, useCallback } from 'react';
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
  const metaStyle = {
    color: isActive ? 'var(--c-text-2)' : 'var(--c-text-3)',
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
      <div className="task-card" onClick={onClick}>
        <button
          type="button"
          onContextMenu={handleContextMenu}
          {...longPress}
          className={`task-item${isActive ? ' task-item--on' : ''}`}
        >
          <div className="row-xs">
            <div className="flex items-center gap-1 min-w-0">
              {client && (
                <div className="meta trunc" style={{ ...metaStyle, color: 'var(--c-text-2)' }}>
                  {client.name} <span aria-hidden="true">/</span>
                </div>
              )}
              <span className="meta trunc" style={{ ...metaStyle, color: 'var(--c-text-3)' }}>
                {project?.name ?? 'Uncategorized'}
              </span>
            </div>
            <div className="task-item-due-date">
              <span className="meta" style={metaStyle}>{dateLabel}</span>
            </div>
          </div>
          <div className="task-title">{task.title}</div>
        </button>
      </div>

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
