import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/** Notes-local accessible overlay, using the app's existing confirmation surfaces. */
export function NotesDialog({ title, children, onClose, alert = false }: {
  title: string; children: ReactNode; onClose: () => void; alert?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="confirm-overlay notes-dialog-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={ref} className="ui-panel-body confirm-box notes-dialog" role={alert ? 'alertdialog' : 'dialog'}
      aria-modal="true" aria-label={title} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key !== 'Tab') return;
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <h2>{title}</h2>
      {children}
    </div>
  </div>, document.body);
}

export function NotesConfirmation({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return <NotesDialog title={title} onClose={() => { if (!busy.current) onClose(); }} alert>
    <p>{message}</p>
    {failed && <p role="alert" className="notes-danger">{t('notes.error_storage')}</p>}
    <div className="notes-dialog-actions">
      <button type="button" className="ui-button notes-button" data-autofocus disabled={saving} onClick={() => { if (!busy.current) onClose(); }}>{t('notes.cancel')}</button>
      <button type="button" className="ui-button ui-button--danger notes-button notes-button--danger" disabled={saving} onClick={() => {
        if (busy.current) return;
        busy.current = true;
        setSaving(true); setFailed(false);
        void onConfirm().then(onClose).catch(() => setFailed(true)).finally(() => { busy.current = false; setSaving(false); });
      }}>{saving ? t('notes.saving') : confirmLabel}</button>
    </div>
  </NotesDialog>;
}
