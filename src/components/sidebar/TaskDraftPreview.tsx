import { useMemo, useState } from 'react';
import { Check, AlertTriangle, Undo2 } from 'lucide-react';
import type { TaskAIDraft, TaskAIOperation } from '../../types';
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
  const [confirmRisk, setConfirmRisk] = useState(false);

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

  const handleApply = async () => {
    if (!canApply || isApplying) return;
    if (highRisk && !confirmRisk) {
      setConfirmRisk(true);
      return;
    }
    setIsApplying(true);
    const result = await applyDraft(messageId, draft);
    if (!result.batch) {
      showToast(result.error ?? 'Failed to apply draft.', 'error');
      setIsApplying(false);
      return;
    }
    await updateMessage(messageId, { taskDraftStatus: 'applied' });
    showToastWithAction(
      'Task AI changes applied.',
      'Undo',
      () => {
        undoBatch(result.batch!.id).catch((error) => {
          showToast(error instanceof Error ? error.message : 'Undo failed.', 'error');
        });
      },
      'info'
    );
    setIsApplying(false);
  };

  const handleReject = async () => {
    await updateMessage(messageId, { taskDraftStatus: 'rejected' });
  };

  return (
    <div
      style={{
        marginTop: 10,
        border: '1px solid var(--c-border-1)',
        borderRadius: 10,
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
                borderRadius: 8,
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
          Applied
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

      {status === 'applied' && (
        <div className="row-xs subtle" style={{ marginTop: 8, fontSize: 'var(--fs-sm)' }}>
          <Undo2 size={12} />
          Undo is available from the toast or history panel.
        </div>
      )}
    </div>
  );
}
