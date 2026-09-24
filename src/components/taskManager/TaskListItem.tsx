import { useState, useCallback } from 'react';
import type { Task } from '../../types';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLongPress } from '../../hooks/useLongPress';
import { TaskContextMenu } from './TaskContextMenu';

interface TaskListItemProps {
  task: Task;
  isActive: boolean;
  onClick: () => void;
}

const metaStyle = { color: 'var(--c-text-3)', fontSize: 'var(--fs-sm)' } as const;

export function TaskListItem({ task, isActive, onClick }: TaskListItemProps) {
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
    <>
      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        {...longPress}
        className={`task-item${isActive ? ' task-item--on' : ''}`}
      >
        {/* Row 1: Client + project (left) + Due date (right) */}
        <div className="row-xs justify-between">
          <div className="flex items-center gap-1 min-w-0">
            {client && (
              <span className="meta trunc" style={metaStyle}>{client.name}</span>
            )}
            {project ? (
              <span className="meta trunc" style={metaStyle}>{project.name}</span>
            ) : (
              <span className="meta" style={metaStyle}>Uncategorized</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="meta" style={metaStyle}>{dateLabel}</span>
          </div>
        </div>

        {/* Row 2: Task title */}
        <div className="task-title">{task.title}</div>
      </button>
      {menu && (
        <TaskContextMenu
          taskId={task.id}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
