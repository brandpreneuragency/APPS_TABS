import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import './taskDetail.css';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { TaskCommentThread } from './TaskCommentThread';
import { TaskCommentInput } from './TaskCommentInput';
import { TASK_TITLE_MAX_LENGTH } from '../../types';
import type { Task, TaskComment } from '../../types';

function SubtaskSection({ parent, subtasks }: { parent: Task; subtasks: Task[] }) {
  const { t } = useTranslation();
  const createTask = useTaskStore((state) => state.createTask);
  const updateTask = useTaskStore((state) => state.updateTask);
  const openTask = useTaskStore((state) => state.openTaskInActiveTab);
  const [title, setTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    const created = await createTask(trimmed, { projectId: parent.projectId, parentTaskId: parent.id });
    if (created) setTitle('');
    setIsCreating(false);
  };

  return (
    <section className="tdp-subtasks" aria-label={t('tasks.subtasks')}>
      <h2>{t('tasks.subtasks')}</h2>
      <ul>
        {subtasks.map((subtask) => (
          <li key={subtask.id}>
            <input type="checkbox" checked={subtask.status === 'completed'}
              aria-label={t('tasks.completeSubtask', { title: subtask.title })}
              onChange={(event) => void updateTask(subtask.id, {
                status: event.target.checked ? 'completed' : 'pending',
              })} />
            <button type="button" onClick={() => openTask(subtask.id)}>{subtask.title}</button>
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => void submit(event)}>
        <input value={title} onChange={(event) => setTitle(event.target.value)}
          maxLength={TASK_TITLE_MAX_LENGTH} aria-label={t('tasks.subtaskTitle')}
          placeholder={t('tasks.subtaskTitle')} />
        <button type="submit" disabled={isCreating || !title.trim()}>{t('tasks.addSubtask')}</button>
      </form>
    </section>
  );
}

export function TaskDetailPanel() {
  const { t } = useTranslation();
  const {
    getActiveTask,
    updateTask,
    openTaskInActiveTab,
  } = useTaskStore();
  const tasks = useTaskStore((state) => state.tasks);
  const { loadComments, getComments } = useTaskCommentStore();

  const task = getActiveTask();
  const [localTitle, setLocalTitle] = useState(task?.title ?? '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [replyToComment, setReplyToComment] = useState<TaskComment | null>(null);

  useEffect(() => {
    if (task) {
      loadComments(task.id);
    }
  }, [task?.id, loadComments]);

  useEffect(() => {
    setLocalTitle(task?.title ?? ''); // eslint-disable-line react-hooks/set-state-in-effect -- sync draft title when active task changes
  }, [task?.id, task?.title]);

  useEffect(() => {
    if (isEditingTitle) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isEditingTitle]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [getComments(task?.id ?? '').length]);

  if (!task) {
    return (
      <div id="task-detail-panel" className="flex-col h-full items-center justify-center subtle" style={{ background: 'rgba(233, 233, 233, 0)' }}>
        <p className="txt-xs">Select a task from the sidebar</p>
      </div>
    );
  }

  const comments = getComments(task.id);
  const parent = task.parentTaskId ? tasks.find((candidate) => candidate.id === task.parentTaskId) : undefined;
  const subtasks = task.parentTaskId ? [] : tasks.filter((candidate) => candidate.parentTaskId === task.id)
    .sort((left, right) => left.order - right.order);

  const startEditingTitle = () => {
    setLocalTitle(task?.title ?? '');
    setIsEditingTitle(true);
  };

  const commitTitle = () => {
    if (!task) return;
    const next = localTitle.trim();
    if (next && next !== task.title) {
      updateTask(task.id, { title: next });
    } else {
      setLocalTitle(task.title ?? '');
    }
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setLocalTitle(task?.title ?? '');
    setIsEditingTitle(false);
  };

  return (
    <div id="task-detail-panel" className="panel flex-col flex-1 min-h-0" style={{ background: 'rgba(233, 233, 233, 0)' }}>
      {parent && <button type="button" className="tdp-parent-link"
        onClick={() => openTaskInActiveTab(parent.id)}>
        {t('tasks.parentTask', { title: parent.title })}
      </button>}
      <div className="tdp-title-wrapper">
        <div className="tdp-title-inner">
          {isEditingTitle ? (
            <input
              ref={inputRef}
              type="text"
              className="subtasks-title-input"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelTitleEdit();
                }
              }}
              placeholder="Untitled task"
              aria-label="Task title"
              spellCheck={false}
              maxLength={TASK_TITLE_MAX_LENGTH}
            />
          ) : (
            <button
              type="button"
              className="subtasks-title-input"
              onMouseDown={(e) => e.preventDefault()}
              onClick={startEditingTitle}
              title="Click to rename"
            >
              {task?.title || 'Untitled task'}
            </button>
          )}
        </div>
      </div>

      {!task.parentTaskId && <SubtaskSection key={task.id} parent={task} subtasks={subtasks} />}

      <div className="tdp-overlay-region">
        <div id="tdc-thread" ref={threadRef} className="panel-body ai-scroll flex-1 overflow-y-a" style={{ padding: 0 }}>
          <TaskCommentThread comments={comments} onReplyComment={setReplyToComment} />
        </div>
      </div>

      <div className="tdp-comment-footer panel-footer">
        <TaskCommentInput replyToComment={replyToComment} onClearReply={() => setReplyToComment(null)} />
      </div>
    </div>
  );
}
