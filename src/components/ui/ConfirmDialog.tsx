import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  onSave?: () => void;
  confirmLabel?: string;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function ConfirmDialog({ message, onConfirm, onCancel, onSave, confirmLabel, anchorRef }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t('confirm.dontSave');
  const dialogRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!anchorRef) return;
    const reposition = () => {
      const anchor = anchorRef.current;
      const dialog = dialogRef.current;
      if (!anchor || !dialog) return;
      const bounds = anchor.getBoundingClientRect();
      const size = dialog.getBoundingClientRect();
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - size.width - 8));
      const below = bounds.bottom + 8;
      const top = Math.max(8, Math.min(
        below + size.height <= window.innerHeight - 8 ? below : bounds.top - size.height - 8,
        window.innerHeight - size.height - 8,
      ));
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchorRef]);
  const dialog = (
    <div id="confirm-dialog-overlay" className={`confirm-overlay${anchorRef ? ' confirm-overlay--anchored' : ''}`}
      onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <div ref={dialogRef} id="confirm-dialog" className="confirm-box col" style={{ gap: 16 }}>
        <p id="confirm-dialog-msg" className="med" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)' }}>{message}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            id="confirm-cancel-btn"
            type="button"
            onClick={onCancel}
            className="btn-xs"
            style={{ background: 'transparent', border: '1px solid var(--c-border-1)', color: 'var(--c-text-2)' }}
          >
            {t('confirm.cancel')}
          </button>
          <button
            id="confirm-delete-btn"
            type="button"
            onClick={onConfirm}
            className="btn-xs semibold"
            style={{ background: 'var(--c-background-3)', color: 'var(--c-text-1)', border: 'none' }}
          >
            {resolvedConfirmLabel}
          </button>
          {onSave && (
            <button
              id="confirm-save-btn"
              type="button"
              onClick={onSave}
              className="btn-brand semibold"
            >
              {t('confirm.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return anchorRef ? createPortal(dialog, document.body) : dialog;
}
