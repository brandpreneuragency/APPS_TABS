import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { Task } from '../../types';
import { useTaskStore } from '../../stores/taskStore';
import './subtaskCard.css';

export function SubtaskCard({ task }: { task: Task }) {
  const { t } = useTranslation();
  const isActive = useTaskStore((state) => state.activeTaskId === task.id);
  const openTask = useTaskStore((state) => state.openTaskInActiveTab);
  const updateTask = useTaskStore((state) => state.updateTask);
  const [isUpdating, setIsUpdating] = useState(false);
  const completed = task.status === 'completed';

  const toggle = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      await updateTask(task.id, { status: completed ? 'pending' : 'completed' });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className={`subtask-card${isActive ? ' subtask-card--active' : ''}${completed ? ' subtask-card--completed' : ''}`}>
      <label className="subtask-card-check">
        <input type="checkbox" checked={completed} disabled={isUpdating}
          aria-label={t('tasks.completeSubtask', { title: task.title })}
          onChange={() => void toggle()} />
        <span aria-hidden="true">{completed && <Check size={12} />}</span>
      </label>
      <button type="button" className="subtask-card-title" aria-current={isActive ? 'true' : undefined}
        onClick={() => openTask(task.id)}>{task.title}</button>
    </div>
  );
}
