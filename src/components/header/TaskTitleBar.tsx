import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TASK_TITLE_MAX_LENGTH } from '../../types';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { TaskMetadataControls } from '../taskManager/TaskMetadataControls';

export function TaskTitleBar() {
  const { t } = useTranslation();
  const { taskMode, activeTaskPage } = useUIStore();
  const subtaskSectionCollapsed = useUIStore((state) => state.subtaskSectionCollapsed);
  const toggleSubtaskSection = useUIStore((state) => state.toggleSubtaskSection);
  const task = useTaskStore((state) => state.tasks.find((item) => item.id === state.activeTaskId) ?? null);
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
        <div className="task-toggle-bar-row">
          {task && !task.parentTaskId && (
            <button
              type="button"
              className="subtask-section-toggle"
              aria-label={t(subtaskSectionCollapsed ? 'tasks.expandSubtasks' : 'tasks.collapseSubtasks')}
              aria-expanded={!subtaskSectionCollapsed}
              aria-controls="task-subtasks"
              onClick={toggleSubtaskSection}
            >
              {subtaskSectionCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
          {isEditingTitle ? (
            <input
              ref={inputRef}
              type="text"
              className="task-title-input"
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
              className="task-title-input"
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
          <TaskMetadataControls />
        </div>
      </div>
    </div>
  );
}
