import { useEffect, useRef, useState } from 'react';
import { TASK_TITLE_MAX_LENGTH } from '../../types';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { TaskClientProjectControls, TaskDueDateControl } from '../taskManager/TaskMetadataControls';

export function TaskTitleBar() {
  const taskMode = useUIStore((state) => state.taskMode);
  const activeTaskPage = useUIStore((state) => state.activeTaskPage);
  const uiActiveTaskId = useUIStore((state) => state.activeTaskId);
  const storeActiveTaskId = useTaskStore((state) => state.activeTaskId);
  const tasks = useTaskStore((state) => state.tasks);
  const effectiveTaskId = uiActiveTaskId ?? storeActiveTaskId;
  const task = tasks.find((item) => item.id === effectiveTaskId) ?? null;
  const updateTask = useTaskStore((state) => state.updateTask);
  const [localTitle, setLocalTitle] = useState(task?.title ?? '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalTitle(task?.title ?? ''); // eslint-disable-line react-hooks/set-state-in-effect -- sync draft title when active task changes
  }, [task?.id, task?.title]);

  useEffect(() => {
    if (isEditingTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingTitle]);

  const commitTitle = () => {
    if (task) {
      const next = localTitle.trim();
      if (next && next !== task.title) updateTask(task.id, { title: next });
      else setLocalTitle(task.title ?? '');
    }
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setLocalTitle(task?.title ?? '');
    setIsEditingTitle(false);
  };

  if (!taskMode) return null;
  // The "Projects" tab shows a full-width kanban board in the center panel;
  // the task title bar does not apply there.
  if (activeTaskPage === 'projects') return null;
  return (
    <div
      className="task-toggle-bar"
    >
      <div className="task-toggle-bar-inner">
        <div className="task-toggle-bar-row task-title-bar-spread">
          <div className="task-title-bar-left">
            <TaskClientProjectControls />
            <TaskDueDateControl />
          </div>
          <span className="task-title-separator" aria-hidden="true">
            |
          </span>
          {isEditingTitle ? (
            <input
              ref={inputRef}
              type="text"
              className="task-title-input task-title-input--center"
              value={localTitle}
              onChange={(event) => setLocalTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTitle();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelTitleEdit();
                }
              }}
              aria-label="Task title"
              spellCheck={false}
              maxLength={TASK_TITLE_MAX_LENGTH}
            />
          ) : (
            <button
              type="button"
              className="task-title-input task-title-input--center"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLocalTitle(task?.title ?? '');
                setIsEditingTitle(true);
              }}
              title="Click to rename"
            >
              {task?.title || 'Untitled task'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
