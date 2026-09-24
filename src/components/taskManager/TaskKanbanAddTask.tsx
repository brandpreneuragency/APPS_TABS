import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../stores/taskStore';
import { TASK_TITLE_MAX_LENGTH } from '../../types';

export function TaskKanbanAddTask({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const createTask = useTaskStore((state) => state.createTask);
  const openTaskInActiveTab = useTaskStore((state) => state.openTaskInActiveTab);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (restoreFocus.current) {
      buttonRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [open, submitting]);

  const cancel = () => {
    if (submitting) return;
    restoreFocus.current = true;
    setTitle('');
    setOpen(false);
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const created = await createTask(trimmed, { projectId });
      if (created) {
        setTitle('');
        setOpen(false);
        openTaskInActiveTab(created.id);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return (
    <button ref={buttonRef} type="button" className="task-kanban-add-btn" onClick={() => setOpen(true)}>
      <Plus size={12} /> {t('tasks.addTask')}
    </button>
  );

  return (
    <form
      className="task-kanban-add-column task-kanban-add-column--form task-kanban-add-task-form"
      aria-label={t('tasks.addTask')}
      aria-busy={submitting}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className="task-kanban-add-column-input ctrl"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t('tasks.taskTitlePlaceholder')}
        aria-label={t('tasks.taskTitlePlaceholder')}
        maxLength={TASK_TITLE_MAX_LENGTH}
        disabled={submitting}
      />
      <div className="task-kanban-add-column-actions">
        <button type="submit" className="crm-btn crm-btn--primary crm-btn--sm" disabled={submitting || !title.trim()}>
          {t('tasks.createTask')}
        </button>
        <button type="button" className="crm-btn crm-btn--sm" disabled={submitting} onClick={cancel}>
          {t('confirm.cancel')}
        </button>
      </div>
    </form>
  );
}
