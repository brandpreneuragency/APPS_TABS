import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientContact, ClientNote, NoteDraftValue } from '../../types/clients';
import type { TabsDB } from '../../services/db';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { useClientAutosave } from '../../hooks/useClientAutosave';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import { ClientAttachments } from './ClientAttachments';
import './clients.css';

interface ClientNoteEditorProps {
  clientId: string;
  draftId: string;
  contacts: ClientContact[];
  records: ClientRecordsAdapter;
  database: TabsDB;
  note?: ClientNote;
  onClose: () => void;
  onPublished: (note: ClientNote) => void;
}

function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ClientNoteEditorForm({
  clientId, draft, contacts, records, database, note, onClose, onPublished,
}: ClientNoteEditorProps & { draft: Extract<import('../../types/clients').ClientDraft, { kind: 'note' }> }) {
  const { t } = useTranslation();
  const autosave = useClientAutosave({ draft, value: draft.value, records });
  const [dateEdit, setDateEdit] = useState<{ editSessionId: string; value: string } | null>(null);
  const [dateFailureSession, setDateFailureSession] = useState<string | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(false);
  const cancelDiscardRef = useRef<HTMLButtonElement>(null);
  const dateValue = dateEdit?.editSessionId === draft.editSessionId
    ? dateEdit.value : formatLocalDateTime(draft.value.occurredAt);
  const dateInvalid = dateFailureSession === draft.editSessionId;
  const hasHistoricalContact = Boolean(draft.value.contactId && note?.contactSnapshot
    && !contacts.some((contact) => contact.id === draft.value.contactId));

  useEffect(() => {
    if (!discardConfirm) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelDiscardRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [discardConfirm]);

  const change = (value: NoteDraftValue) => {
    setPublishError(false);
    useClientDetailsStore.getState().updateDraft({ id: draft.id, editSessionId: draft.editSessionId, value });
  };

  const publish = async () => {
    if (dateInvalid || publishing) return;
    setPublishing(true);
    setPublishError(false);
    const result = await autosave.saveNote();
    setPublishing(false);
    if (!result.ok) {
      setPublishError(true);
      return;
    }
    useClientDetailsStore.getState().clearDraft(draft.id, draft.editSessionId, draft.generation);
    onPublished(result.value);
  };

  const discard = async () => {
    setDiscarding(true);
    setDiscardError(false);
    const result = await autosave.discardDraft();
    setDiscarding(false);
    if (!result.ok) {
      setDiscardError(true);
      return;
    }
    setDiscardConfirm(false);
    onClose();
  };

  return <section className="clients-note-editor" aria-labelledby="clients-note-editor-title">
    <h2 id="clients-note-editor-title">{note ? t('clients.editNote') : t('clients.createNote')}</h2>
    <form className="clients-editor-form" onSubmit={(event) => { event.preventDefault(); void publish(); }}>
      <label className="clients-field">
        <span>{t('clients.noteTitle')}</span>
        <input type="text" maxLength={200} value={draft.value.title}
          onChange={(event) => change({ ...draft.value, title: event.currentTarget.value })} />
      </label>
      <label className="clients-field">
        <span>{t('clients.noteBody')}</span>
        <textarea rows={8} maxLength={100_000} value={draft.value.bodyText}
          onChange={(event) => change({ ...draft.value, bodyText: event.currentTarget.value })} />
      </label>
      <label className="clients-field">
        <span>{t('clients.noteKind')}</span>
        <select value={draft.value.kind} onChange={(event) => change({
          ...draft.value, kind: event.currentTarget.value as NoteDraftValue['kind'],
        })}>
          <option value="note">{t('clients.noteKindInternal')}</option>
          <option value="call">{t('clients.kindCall')}</option>
          <option value="meeting">{t('clients.kindMeeting')}</option>
          <option value="decision">{t('clients.kindDecision')}</option>
        </select>
      </label>
      {draft.value.kind === 'note' && <p className="clients-note-internal-label">{t('clients.internalNote')}</p>}
      <label className="clients-field">
        <span>{t('clients.occurredAt')}</span>
        <input type="datetime-local" required value={dateValue}
          aria-invalid={dateInvalid}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDateEdit({ editSessionId: draft.editSessionId, value });
            const timestamp = parseLocalDateTime(value);
            setDateFailureSession(timestamp === null ? draft.editSessionId : null);
            if (timestamp !== null) change({ ...draft.value, occurredAt: timestamp });
          }} />
      </label>
      {dateInvalid && <p role="alert" className="clients-error">{t('clients.invalidDate')}</p>}
      <label className="clients-field">
        <span>{t('clients.associatedPerson')}</span>
        <select value={draft.value.contactId ?? ''} onChange={(event) => {
          const contactId = event.currentTarget.value || null;
          change({ ...draft.value, contactId });
        }}>
          <option value="">{t('clients.noAssociatedPerson')}</option>
          {hasHistoricalContact && note?.contactId && <option value={note.contactId}>
            {t('clients.historicalContact', { name: note.contactSnapshot?.name ?? note.contactId })}
          </option>}
          {contacts.map((contact: ClientContact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
        </select>
      </label>
      {hasHistoricalContact && note?.contactSnapshot && <p className="clients-muted">
        {t('clients.historicalContact', { name: note.contactSnapshot.name })}
        {note.contactSnapshot.email && ` · ${note.contactSnapshot.email}`}
      </p>}
      <ClientAttachments clientId={clientId} ownerType="draft" ownerId={draft.id} database={database}
        draft={draft} records={records} />
      {note && <ClientAttachments clientId={clientId} ownerType="note" ownerId={note.id} database={database}
        records={records} readOnly />}
      <div className="clients-save-state" aria-live="polite">
        <span role={autosave.status === 'error' ? 'alert' : 'status'}>
          {autosave.status === 'saving' ? t('clients.saveSaving')
            : autosave.status === 'saved' ? t('clients.draftSaved')
              : autosave.status === 'error' ? t('clients.saveError') : t('clients.saveIdle')}
        </span>
        {autosave.status === 'error' && <button type="button" className="clients-link-button"
          disabled={discarding || publishing} onClick={() => void autosave.retry()}>{t('clients.retry')}</button>}
        {publishError && <>
          <span role="alert" className="clients-error">{t('clients.publishFailed')}</span>
          <button type="button" className="clients-link-button" disabled={publishing}
            onClick={() => void publish()}>{t('clients.retry')}</button>
        </>}
        {discardError && <p role="alert" className="clients-error">{t('clients.discardFailed')}</p>}
      </div>
      <div className="clients-editor-actions">
        <button type="button" className="clients-button" disabled={publishing || discarding}
          onClick={onClose}>{t('clients.cancelKeepDraft')}</button>
        <button type="button" className="clients-button" disabled={publishing || discarding}
          onClick={() => setDiscardConfirm(true)}>{t('clients.discardDraft')}</button>
        <button type="submit" className="clients-button clients-button--primary" disabled={publishing || discarding}>
          {publishing ? t('clients.saveSaving') : t('clients.saveNote')}
        </button>
      </div>
    </form>
    {discardConfirm && <div className="confirm-overlay">
      <div className="confirm-box col" role="alertdialog" aria-modal="true"
        aria-labelledby="clients-note-discard-title" aria-describedby="clients-note-discard-message"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setDiscardConfirm(false);
            return;
          }
          if (event.key === 'Tab') {
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
            const first = buttons.item(0);
            const last = buttons.item(buttons.length - 1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}>
        <p id="clients-note-discard-title" className="med">{t('clients.discardDraft')}</p>
        <p id="clients-note-discard-message" className="med">{t('clients.discardDraftConfirm')}</p>
        <div className="clients-editor-actions clients-confirm-actions">
          <button ref={cancelDiscardRef} type="button" className="btn-xs" disabled={discarding}
            onClick={() => setDiscardConfirm(false)}>{t('confirm.cancel')}</button>
          <button type="button" className="btn-xs semibold" disabled={discarding}
            onClick={() => void discard()}>{t('clients.discardDraft')}</button>
        </div>
      </div>
    </div>}
  </section>;
}

export function ClientNoteEditor(props: ClientNoteEditorProps) {
  const { t } = useTranslation();
  const storedDraft = useClientDetailsStore((state) => state.drafts[props.draftId]);
  const draft = storedDraft?.kind === 'note' ? storedDraft : null;
  if (!draft) return <section className="clients-data-state" aria-busy="true">
    <p role="status">{t('clients.loading')}</p>
  </section>;
  return <ClientNoteEditorForm {...props} draft={draft} />;
}
