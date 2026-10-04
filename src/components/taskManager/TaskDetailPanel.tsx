import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import './taskDetail.css';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { TaskCommentThread } from './TaskCommentThread';
import { TaskCommentInput } from './TaskCommentInput';
import { TASK_TITLE_MAX_LENGTH } from '../../types';
import type { Task, TaskComment } from '../../types';
import { SubtaskCard } from './SubtaskCard';
import { useUIStore } from '../../stores/uiStore';

function SubtaskSection({ parent, subtasks }: { parent: Task; subtasks: Task[] }) {
  const { t } = useTranslation();
  const isCollapsed = useUIStore((state) => state.subtaskSectionCollapsed);
  const createTask = useTaskStore((state) => state.createTask);
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
    <section id="task-subtasks" className="tdp-subtasks" aria-label={t('tasks.subtasks')} hidden={isCollapsed}>
      <ul>
        {subtasks.map((subtask) => (
          <li key={subtask.id}>
            <SubtaskCard task={subtask} />
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
    openTaskInActiveTab,
  } = useTaskStore();
  const tasks = useTaskStore((state) => state.tasks);
  const { loadComments, getComments } = useTaskCommentStore();

  const task = getActiveTask();
  const threadRef = useRef<HTMLDivElement>(null);
  const [replyToComment, setReplyToComment] = useState<TaskComment | null>(null);

  useEffect(() => {
    if (task) {
      loadComments(task.id);
    }
  }, [task?.id, loadComments]);

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

  return (
    <div id="task-detail-panel" className="panel flex-col flex-1 min-h-0" style={{ background: 'rgba(233, 233, 233, 0)' }}>
      {parent && <button type="button" className="tdp-parent-link"
        onClick={() => openTaskInActiveTab(parent.id)}>
        {t('tasks.parentTask', { title: parent.title })}
      </button>}
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
