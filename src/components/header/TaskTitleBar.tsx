import { CheckCircle2, Circle } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskMetadataControls } from '../taskManager/TaskMetadataControls';

export function TaskTitleBar() {
  const { taskMode, activeTaskPage, activeTaskId } = useUIStore();
  const storeActiveId = useTaskStore((s) => s.activeTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);

  const effectiveId = activeTaskId ?? storeActiveId;
  const activeTask = tasks.find((t) => t.id === effectiveId) ?? null;
  const isCompleted = activeTask?.status === 'completed';

  if (!taskMode) return null;
  // The "Projects" tab shows a full-width kanban board in the center panel;
  // the task title bar does not apply there.
  if (activeTaskPage === 'projects') return null;
  // No selected task: keep the context-panel toggle reachable above the empty state.
  if (!activeTask) {
    return null;
  }

  const toggleComplete = () => {
    if (!activeTask) return;
    updateTask(activeTask.id, { status: isCompleted ? 'in_progress' : 'completed' });
  };

  return (
    <div
      className="subtasks-toggle-bar"
    >
      <div className="subtasks-toggle-bar-inner">
        <div className="subtasks-toggle-bar-row">
          <button
            type="button"
            className={`subtasks-complete-btn${isCompleted ? ' subtasks-complete-btn--completed' : ''}`}
            onClick={toggleComplete}
            disabled={!activeTask}
            title={isCompleted ? 'Mark as Incomplete' : 'Mark as Completed'}
            aria-label={isCompleted ? 'Mark as Incomplete' : 'Mark as Completed'}
          >
            {isCompleted ? <CheckCircle2 size={16} /> : <Circle size={16} />}
          </button>

          <TaskMetadataControls />
        </div>
      </div>
    </div>
  );
}
