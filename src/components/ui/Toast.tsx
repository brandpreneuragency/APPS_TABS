import { X } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';

export function ToastContainer() {
  const { toasts, dismissToast } = useUIStore();
  if (toasts.length === 0) return null;

  return (
    <div id="toast-container" className="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="row"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            maxWidth: 384,
            border: t.type === 'error' ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--c-border-1)',
            background: t.type === 'error' ? 'rgba(239,68,68,0.15)' : 'var(--c-background-3)',
            color: t.type === 'error' ? 'var(--c-danger)' : 'var(--c-text-1)',
            pointerEvents: 'auto',
          }}
        >
          <span className="flex-1">{t.message}</span>
          {t.actionLabel && t.onAction && (
            <button
              type="button"
              onClick={() => {
                t.onAction?.();
                dismissToast(t.id);
              }}
              className="btn"
              style={{ marginRight: 8, padding: '4px 8px', fontSize: 'var(--fs-xs)' }}
            >
              {t.actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 trans-opacity"
            style={{ opacity: 0.5, marginTop: 2 }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
