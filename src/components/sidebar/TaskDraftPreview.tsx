import { useEffect, useMemo, useState } from 'react';
import { Check, AlertTriangle, Undo2 } from 'lucide-react';
import type { TaskAIChangeBatch, TaskAIDraft, TaskAIOperation } from '../../types';
import { db } from '../../services/db';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskAIStore } from '../../stores/taskAIStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';

interface TaskDraftPreviewProps {
  messageId: string;
  draft: TaskAIDraft;
  status: 'draft' | 'applied' | 'rejected' | 'invalid';
}

function isHighRiskDraft(draft: TaskAIDraft): boolean {
  const hasSoftDelete = draft.operations.some((operation) => operation.type === 'soft_delete_task');
  const riskyBulkUpdates = draft.operations.filter((operation) => {
    if (operation.type !== 'update_task') return false;
    return (
      operation.updates.status === 'completed' ||
      operation.updates.projectId !== undefined ||
      operation.updates.date !== undefined
    );
  });
  return hasSoftDelete || riskyBulkUpdates.length > 1;
}

function describeOperation(
  operation: TaskAIOperation,
  taskTitleById: Record<string, string>,
  taskById: Record<string, { [key: string]: unknown }>
) {
  if (operation.type === 'create_task') {
    return `Create task: ${operation.title}`;
  }
  if (operation.type === 'update_task') {
    const before = taskById[operation.taskId] ?? {};
    const changes = Object.entries(operation.updates).map(([field, next]) => {
      const previous = (before as Record<string, unknown>)[field];
      return `${field}: ${String(previous ?? '—')} -> ${String(next ?? '—')}`;
    });
    return `Update ${taskTitleById[operation.taskId] ?? operation.taskId}: ${changes.join(' | ') || 'no fields'}`;
  }
  if (operation.type === 'soft_delete_task') {
    return `Move to trash: ${taskTitleById[operation.taskId] ?? operation.taskId}`;
  }
  if (operation.type === 'restore_task') {
    return `Restore from trash: ${taskTitleById[operation.taskId] ?? operation.taskId}`;
  }
  if (operation.type === 'add_comment') {
    return `Add comment on ${taskTitleById[operation.taskId] ?? operation.taskId}: ${operation.text}`;
  }
  return `Delete comment from ${taskTitleById[operation.taskId] ?? operation.taskId}`;
}

export function TaskDraftPreview({ messageId, draft, status }: TaskDraftPreviewProps) {
  const tasks = useTaskStore((state) => state.tasks);
  const { applyDraft, undoBatch } = useTaskAIStore();
  const updateMessage = useChatStore((state) => state.updateMessage);
  const { showToast, showToastWithAction } = useUIStore();
  const [isApplying, setIsApplying] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [savedBatch, setSavedBatch] = useState<TaskAIChangeBatch | null>(null);
  const [undoExpired, setUndoExpired] = useState(false);

  useEffect(() => {
    if (status !== 'applied') return;
    let current = true;
    void db.taskAIChangeBatches.get(draft.id).then((batch) => {
      if (current) {
        setSavedBatch(batch ?? null);
        setUndoExpired(!batch || batch.expiresAt <= Date.now());
      }
    });
    return () => { current = false; };
  }, [draft.id, status]);

  useEffect(() => {
    if (!savedBatch || savedBatch.undoneAt) return;
    const delay = Math.max(0, Math.min(2_147_483_647, savedBatch.expiresAt - Date.now()));
    const timer = window.setTimeout(() => setUndoExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [savedBatch]);

  const taskTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const task of tasks) {
      map[task.id] = task.title;
    }
    return map;
  }, [tasks]);
  const taskById = useMemo(() => {
    const map: Record<string, { [key: string]: unknown }> = {};
    for (const task of tasks) {
      map[task.id] = task as unknown as { [key: string]: unknown };
    }
    return map;
  }, [tasks]);

  const highRisk = isHighRiskDraft(draft);
  const canApply = draft.operations.length > 0 && draft.validation.errors.length === 0 && status === 'draft';
  const canUndo = status === 'applied' && savedBatch && !savedBatch.undoneAt
    && !undoExpired && savedBatch.taskEffects && savedBatch.commentEffects;

  const handleUndo = async (batchId: string) => {
    if (isUndoing) return;
    setIsUndoing(true);
    try {
      await undoBatch(batchId);
      setSavedBatch((await db.taskAIChangeBatches.get(batchId)) ?? null);
    } catch (error) {
      setSavedBatch((await db.taskAIChangeBatches.get(batchId)) ?? null);
      showToast(error instanceof Error ? error.message : 'Undo failed.', 'error');
    } finally {
      setIsUndoing(false);
    }
  };

  const handleApply = async () => {
    if (!canApply || isApplying) return;
    if (highRisk && !confirmRisk) {
      setConfirmRisk(true);
      return;
    }
    setIsApplying(true);
    try {
      const result = await applyDraft(messageId, draft);
      if (!result.batch) {
        showToast(result.error ?? 'Failed to apply draft.', 'error');
        return;
      }
      setSavedBatch(result.batch);
      setUndoExpired(false);
      let followUp = result.error;
      try {
        await updateMessage(messageId, { taskDraftStatus: 'applied' });
      } catch {
        followUp = [followUp, 'Chat status could not be updated.'].filter(Boolean).join(' ');
      }
      const batchId = result.batch.id;
      showToastWithAction(
        followUp ? `Task changes were saved, but need attention: ${followUp}` : 'Task AI changes applied.',
        'Undo',
        () => { void handleUndo(batchId); },
        followUp ? 'error' : 'info'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to apply draft.', 'error');
    } finally {
      setIsApplying(false);
    }
  };

  const handleReject = async () => {
    await updateMessage(messageId, { taskDraftStatus: 'rejected' });
  };

  return (
    <div
      style={{
        marginTop: 10,
        border: '1px solid var(--c-border-1)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--c-background-4)',
        padding: 10,
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="semibold" style={{ fontSize: 'var(--fs-xs)' }}>
          Draft Changes
        </div>
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>
          {draft.operations.length} operation{draft.operations.length === 1 ? '' : 's'}
        </div>
      </div>

      {draft.validation.warnings.length > 0 && (
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)', marginBottom: 8, color: '#b45309' }}>
          {draft.validation.warnings.join(' ')}
        </div>
      )}
      {draft.validation.errors.length > 0 && (
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)', marginBottom: 8, color: '#dc2626' }}>
          {draft.validation.errors.join(' ')}
        </div>
      )}
      {draft.needsScopeConfirmation && (
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)', marginBottom: 8, color: '#b45309' }}>
          {draft.needsScopeConfirmation}
        </div>
      )}

      <div className="col" style={{ gap: 6, marginBottom: 10 }}>
        {draft.operations.length === 0 ? (
          <div className="subtle" style={{ fontSize: 'var(--fs-xs)' }}>
            No data mutations proposed.
          </div>
        ) : (
          draft.operations.map((operation) => (
            <div
              key={operation.id}
              style={{
                fontSize: 'var(--fs-xs)',
                border: '1px solid var(--c-border-1)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                background: 'var(--c-background-3)',
              }}
            >
              {describeOperation(operation, taskTitleById, taskById)}
            </div>
          ))
        )}
      </div>

      {status === 'applied' && (
        <div className="row-xs" style={{ fontSize: 'var(--fs-sm)', color: '#15803d' }}>
          <Check size={12} />
          {savedBatch?.undoneAt ? 'Undone' : 'Applied'}
        </div>
      )}

      {status === 'rejected' && (
        <div className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>
          Rejected
        </div>
      )}

      {canApply && (
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          {highRisk && (
            <span className="row-xs subtle" style={{ fontSize: 'var(--fs-sm)', color: '#b45309' }}>
              <AlertTriangle size={12} />
              Destructive/bulk confirm required
            </span>
          )}
          <button type="button" onClick={handleReject} className="btn" style={{ fontSize: 'var(--fs-xs)' }}>
            Reject
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="btn-brand"
            style={{ fontSize: 'var(--fs-xs)', opacity: isApplying ? 0.6 : 1 }}
            disabled={isApplying}
          >
            {highRisk && !confirmRisk ? (
              <>
                <AlertTriangle size={12} />
                Confirm Apply
              </>
            ) : (
              <>
                <Check size={12} />
                Apply
              </>
            )}
          </button>
        </div>
      )}

      {status === 'applied' && savedBatch && savedBatch.projectionState !== 'complete' && !savedBatch.undoneAt && (
        <div role="status" style={{ marginTop: 8, fontSize: 'var(--fs-sm)', color: '#b45309' }}>
          Task data was saved, but its file mirror needs attention.
        </div>
      )}
      {status === 'applied' && savedBatch?.undoneAt && savedBatch.undoProjectionState !== 'complete' && (
        <div role="status" style={{ marginTop: 8, fontSize: 'var(--fs-sm)', color: '#b45309' }}>
          Task data was undone, but its file mirror needs attention.
        </div>
      )}
      {canUndo && (
        <button type="button" className="btn" disabled={isUndoing} onClick={() => { void handleUndo(savedBatch.id); }}
          style={{ marginTop: 8, fontSize: 'var(--fs-xs)' }}>
          <Undo2 size={12} /> Undo
        </button>
      )}
    </div>
  );
}
