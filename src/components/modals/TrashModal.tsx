import { useState, useEffect } from 'react';
import { X, RotateCcw, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import type { Task } from '../../types';

interface TrashModalProps {
  onClose: () => void;
}

export function TrashModal({ onClose }: TrashModalProps) {
  const { t } = useTranslation();
  const { restoreTask, permanentlyDeleteTask } = useTaskStore();
  const { projects } = useProjectStore();
  const [deletedTasks, setDeletedTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadDeleted = async () => {
    setLoading(true);
    const tasks = await useTaskStore.getState().fetchDeletedTasks();
    // Sort by deletion date (most recent first)
    tasks.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    setDeletedTasks(tasks);
    setLoading(false);
  };

  useEffect(() => {
    void loadDeleted(); // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch of soft-deleted tasks
  }, []);

  const handleRestore = async (id: string) => {
    await restoreTask(id);
    setDeletedTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handlePermanentDelete = async (id: string) => {
    await permanentlyDeleteTask(id);
    setDeletedTasks((prev) => prev.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
  };

  const getProjectName = (projectId: string | null): string => {
    const project = projects.find((p) => p.id === projectId);
    return project?.name ?? 'General';
  };

  return (
    <div className="overlay" id="trash-overlay">
      <div className="modal modal--md" id="trash-modal">
        <div className="modal-head">
          <h2>{t('trash.title')}</h2>
          <button
            onClick={onClose}
            aria-label="Close trash"
            className="modal-close"
            id="trash-close-btn"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" id="trash-body">
          {loading ? (
            <p className="txt-sm subtle">{t('common.loading')}</p>
          ) : deletedTasks.length === 0 ? (
            <div className="col items-center" style={{ padding: '40px 0', gap: 8 }}>
              <AlertTriangle size={24} className="subtle" />
              <p className="txt-sm subtle">{t('trash.empty')}</p>
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {deletedTasks.map((task) => (
                <div
                  key={task.id}
                  className="row items-center"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--c-background-3)',
                    gap: 12,
                  }}
                >
                  <div className="flex-1 col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="txt-sm med trunc">{task.title}</span>
                    <span className="txt-xs subtle">
                      {getProjectName(task.projectId)} &middot; {t('trash.deletedOn')}{' '}
                      {task.deletedAt ? new Date(task.deletedAt).toLocaleDateString() : '—'}
                    </span>
                  </div>

                  <div className="row-xs">
                    <button
                      type="button"
                      onClick={() => handleRestore(task.id)}
                      className="btn-xs row-xs"
                      title={t('trash.restore')}
                      style={{ border: '1px solid var(--c-border-1)' }}
                    >
                      <RotateCcw size={12} />
                      <span>{t('trash.restore')}</span>
                    </button>

                    {confirmDeleteId === task.id ? (
                      <button
                        type="button"
                        onClick={() => handlePermanentDelete(task.id)}
                        className="btn-xs row-xs"
                        style={{ background: 'var(--c-danger)', color: '#fff', border: 'none' }}
                      >
                        <AlertTriangle size={12} />
                        <span>{t('trash.confirmPermanentDelete')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(task.id)}
                        className="btn-xs"
                        title={t('trash.deleteForever')}
                        style={{ border: '1px solid var(--c-border-1)', color: '#EF4444' }}
                      >
                        {t('trash.deleteForever')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
