import { useState, useEffect, useRef } from 'react';
import './taskDetail.css';
import { CheckCircle2, Circle, GripVertical } from 'lucide-react';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { useUIStore } from '../../stores/uiStore';
import { TaskCommentThread } from './TaskCommentThread';
import { TaskCommentInput } from './TaskCommentInput';
import { SubtaskDueDatePicker } from './SubtaskDueDatePicker';
import type { TaskComment, TaskStatus } from '../../types';
import { TASK_TITLE_MAX_LENGTH } from '../../types';

export function TaskDetailPanel() {
  const {
    getActiveTask,
    updateTask,
    deleteTask,
    getSubtasks,
  } = useTaskStore();
  const { loadComments, getComments } = useTaskCommentStore();
  const { subtasksOpen } = useUIStore();

  const task = getActiveTask();
  const [title, setTitle] = useState(task?.title ?? '');
  const titleRef = useRef(title);
  const taskRef = useRef(task);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const editingSubtaskInputRef = useRef<HTMLInputElement>(null);
  const [replyToComment, setReplyToComment] = useState<TaskComment | null>(null);
  const [openDueDateSubtaskId, setOpenDueDateSubtaskId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<'above' | 'below'>('above');
  const subtasks = task ? [...getSubtasks(task.id)].sort((a, b) => a.order - b.order) : [];

  useEffect(() => {
    if (task) {
      loadComments(task.id);
      setTitle(task.title); // eslint-disable-line react-hooks/set-state-in-effect
      titleRef.current = task.title;
      taskRef.current = task;
    }
  }, [task?.id, loadComments]);

  useEffect(() => {
    titleRef.current = title;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const trimmed = titleRef.current.trim();
      const currentTask = taskRef.current;
      if (trimmed && trimmed !== currentTask?.title) {
        updateTask(currentTask!.id, { title: trimmed });
      }
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, updateTask]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [getComments(task?.id ?? '').length]);

  const cycleSubtaskStatus = (id: string, current: TaskStatus) => {
    const next: TaskStatus = current === 'in_progress' ? 'completed' : 'in_progress';
    updateTask(id, { status: next });
  };

  const handleSubtaskDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleSubtaskDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragOverId) setDragOverId(id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    setDragOverPos(pos);
  };

  const handleSubtaskDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragId(null);
    setDragOverId(null);
    setDragOverPos('above');
  };

  const handleSubtaskDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
    setDragOverPos('above');
  };

  if (!task) {
    return (
      <div id="task-detail-panel" className="flex-col h-full items-center justify-center subtle" style={{ background: 'rgba(233, 233, 233, 0)' }}>
        <p className="txt-xs">Select a task from the sidebar</p>
      </div>
    );
  }

  const comments = getComments(task.id);

  return (
    <div id="task-detail-panel" className="panel flex-col flex-1 min-h-0" style={{ background: 'rgba(233, 233, 233, 0)' }}>
      {/* Comments + subtasks overlay region (relative so the dropdown overlays only this area) */}
      <div className="tdp-overlay-region">
        {/* Subtasks dropdown overlay - covers the comments section only, toggled by SubtasksToggleBar */}
        {subtasksOpen && (
          <div className="tdp-subtasks-dropdown">
            <div className="tdp-subtasks-header">SUBTASKS</div>
            <div className="tdp-subtasks-bar">
            <div className="col" style={{ gap: '6px', padding: '0px 0px', borderRadius: 8, height: 'fit-content', border: 'none' }}>
            {subtasks.map((sub) => (
              <div
                key={sub.id}
                className={`row-xs items-center subtask-row${sub.status === 'completed' ? ' subtask-row--completed' : ''}${dragId === sub.id ? ' subtask-row--dragging' : ''}${dragOverId === sub.id && dragId !== sub.id ? ` subtask-row--drag-over subtask-row--drag-over-${dragOverPos}` : ''}`}
                style={{ gap: 8, height: 16, verticalAlign: 'middle', marginLeft: 0, marginRight: 0, padding: '14px 12px', borderRadius: '8px' }}
                draggable
                onDragStart={(e) => handleSubtaskDragStart(e, sub.id)}
                onDragOver={(e) => handleSubtaskDragOver(e, sub.id)}
                onDrop={handleSubtaskDrop}
                onDragEnd={handleSubtaskDragEnd}
              >
                <span
                  role="button"
                  tabIndex={0}
                  className="subtask-drag-handle"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleSubtaskDragStart(e, sub.id);
                  }}
                >
                  <GripVertical size={12} />
                </span>
                <button
                  onClick={() => cycleSubtaskStatus(sub.id, sub.status)}
                  className={`subtask-status-btn${sub.status === 'completed' ? ' subtask-status-btn--completed' : sub.status === 'in_progress' ? ' subtask-status-btn--active' : ''}`}
                  aria-label={sub.status === 'completed' ? 'Mark as incomplete' : 'Mark as completed'}
                >
                  {sub.status === 'completed' ? <CheckCircle2 size={10} /> : <Circle size={10} />}
                </button>
                {editingSubtaskId === sub.id ? (
                  <input
                    ref={editingSubtaskInputRef}
                    value={editingSubtaskTitle}
                    onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const trimmed = editingSubtaskTitle.trim();
                        if (trimmed && trimmed !== sub.title) {
                          updateTask(sub.id, { title: trimmed });
                        }
                        setEditingSubtaskId(null);
                      }
                      if (e.key === 'Escape') {
                        setEditingSubtaskId(null);
                      }
                      if (e.key === 'Backspace' && editingSubtaskTitle === '') {
                        e.preventDefault();
                        deleteTask(sub.id);
                        setEditingSubtaskId(null);
                      }
                    }}
                    onBlur={() => {
                      const trimmed = editingSubtaskTitle.trim();
                      if (trimmed && trimmed !== sub.title) {
                        updateTask(sub.id, { title: trimmed });
                      }
                      setEditingSubtaskId(null);
                    }}
                    aria-label="Edit subtask title"
                    className="flex-1 txt-xs bg-transparent outline-none"
                    style={{ border: 'none', padding: 0, height: '16px', verticalAlign: 'middle', color: 'var(--c-text-1)' }}
                    autoFocus
                    maxLength={TASK_TITLE_MAX_LENGTH}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSubtaskId(sub.id);
                      setEditingSubtaskTitle(sub.title);
                      requestAnimationFrame(() => editingSubtaskInputRef.current?.focus());
                    }}
                    className="txt-xs flex-1 subtask-title"
                    style={{
                      color: sub.status === 'completed' ? 'var(--c-text-3)' : undefined,
                    }}
                    title="Click to edit"
                  >
                    {sub.title}
                  </button>
                )}
                <SubtaskDueDatePicker
                  date={sub.date}
                  onChange={(date) => updateTask(sub.id, { date })}
                  isOpen={openDueDateSubtaskId === sub.id}
                  onToggle={() =>
                    setOpenDueDateSubtaskId(openDueDateSubtaskId === sub.id ? null : sub.id)
                  }
                  onClose={() => setOpenDueDateSubtaskId(null)}
                  isCompleted={sub.status === 'completed'}
                />
              </div>
            ))}
          </div>
        </div>
        </div>
      )}
        {/* Comments panel - always rendered (base layer) */}
        <div id="tdc-thread" ref={threadRef} className="panel-body ai-scroll flex-1 overflow-y-a" style={{ padding: 0 }}>
          <TaskCommentThread comments={comments} onReplyComment={setReplyToComment} />
        </div>
      </div>

      {/* Bottom Comment Input - fixed at bottom of panel, outside the overlay */}
      <div className="tdp-comment-footer panel-footer">
        <TaskCommentInput replyToComment={replyToComment} onClearReply={() => setReplyToComment(null)} />
      </div>
    </div>
  );
}
