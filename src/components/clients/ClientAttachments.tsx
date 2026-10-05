import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { nanoid } from 'nanoid';
import { useTranslation } from 'react-i18next';
import type { ClientAttachment, ClientDraft } from '../../types/clients';
import type { TabsDB } from '../../services/db';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { exportClientAttachment } from '../../services/clients/attachments';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_OWNER } from '../../services/clients/schema';
import './clients.css';

interface ClientAttachmentsProps {
  clientId: string;
  ownerType: 'note' | 'draft';
  ownerId: string;
  records: ClientRecordsAdapter;
  database: TabsDB;
  draft?: Extract<ClientDraft, { kind: 'note' }>;
  readOnly?: boolean;
}

type AttachmentState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error' }
  | { key: string; status: 'ready'; attachments: ClientAttachment[] };

interface PendingFile {
  key: string;
  id: string;
  file: File;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function ClientAttachments({ clientId, ownerType, ownerId, records, database, draft, readOnly = false }: ClientAttachmentsProps) {
  const { t } = useTranslation();
  const key = JSON.stringify([clientId, ownerType, ownerId]);
  const [state, setState] = useState<AttachmentState>({ key, status: 'loading' });
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const attachments = state.key === key && state.status === 'ready' ? state.attachments : [];
  const visiblePending = pending?.key === key ? pending : null;
  const visibleError = error?.key === key ? error.message : null;

  useEffect(() => {
    let active = true;
    const subscription = liveQuery(() => database.clientAttachments.where('[ownerType+ownerId]')
      .equals([ownerType, ownerId]).toArray()).subscribe({
      next: (rows) => {
        if (!active) return;
        if (rows.some((row) => row.clientId !== clientId || row.ownerType !== ownerType || row.ownerId !== ownerId)) {
          setState({ key, status: 'error' });
          return;
        }
        setState({ key, status: 'ready', attachments: rows });
      },
      error: () => {
        if (active) setState({ key, status: 'error' });
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [key, clientId, ownerId, ownerType, database, retryToken]);

  const addFile = async (candidate: PendingFile): Promise<boolean> => {
    if (candidate.key !== key) return false;
    setBusy(true);
    setError(null);
    const result = await records.addAttachment({
      id: candidate.id,
      clientId,
      ownerType,
      ownerId,
      file: candidate.file,
      ...(ownerType === 'draft' && draft ? { draft } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setPending(candidate);
      setError({ key, message: result.code === 'LIMIT' ? t('clients.attachmentLimitReached') : t('clients.attachmentFailed') });
      return false;
    }
    setPending(null);
    return true;
  };

  const selectFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    let ownerCount = attachments.length;
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError({ key, message: t('clients.attachmentTooLarge') });
        return;
      }
      if (ownerCount >= MAX_ATTACHMENTS_PER_OWNER) {
        setError({ key, message: t('clients.attachmentLimitReached') });
        return;
      }
      const candidate = { key, id: nanoid(), file };
      setPending(candidate);
      if (!await addFile(candidate)) return;
      ownerCount += 1;
    }
  };

  const remove = async (attachment: ClientAttachment) => {
    setBusy(true);
    setError(null);
    const result = await records.removeAttachment({
      id: attachment.id, clientId, ownerType, ownerId,
    });
    setBusy(false);
    if (!result.ok) setError({ key, message: t('clients.attachmentFailed') });
  };

  const exportFile = async (attachment: ClientAttachment) => {
    const result = await exportClientAttachment(attachment);
    setError(result.ok ? null : { key, message: t('clients.attachmentFailed') });
  };

  return <section className="clients-attachments" aria-label={t('clients.attachments')}>
    <div className="clients-profile-section-heading">
      <h3>{t('clients.attachments')}</h3>
      {!readOnly && <label className="clients-button clients-file-picker">
        {t('clients.addAttachment')}
        <input type="file" multiple disabled={busy || visiblePending !== null || attachments.length >= MAX_ATTACHMENTS_PER_OWNER}
          aria-label={t('clients.addAttachment')} onChange={(event) => void selectFiles(event)} />
      </label>}
    </div>
    {!readOnly && <p className="clients-muted">{t('clients.attachmentLimits')}</p>}
    {state.key !== key || state.status === 'loading'
      ? <p role="status" className="clients-muted">{t('clients.loading')}</p>
      : state.status === 'error'
        ? <div><p role="alert" className="clients-error">{t('clients.loadFailed')}</p>
          <button type="button" className="clients-link-button" onClick={() => setRetryToken((value) => value + 1)}>{t('clients.retry')}</button></div>
        : attachments.length === 0
          ? <p className="clients-muted">{t('clients.noAttachments')}</p>
          : <ul className="clients-attachment-list">
            {attachments.map((attachment) => <li key={attachment.id}>
              <span className="clients-attachment-name">{attachment.displayName}</span>
              <span className="clients-attachment-size">{formatBytes(attachment.bytes)}</span>
              {!readOnly && <button type="button" className="clients-link-button"
                aria-label={t('clients.removeAttachment', { name: attachment.displayName })}
                disabled={busy} onClick={() => void remove(attachment)}>{t('clients.remove')}</button>}
              <button type="button" className="clients-link-button"
                aria-label={t('clients.exportAttachment', { name: attachment.displayName })}
                onClick={() => void exportFile(attachment)}>{t('clients.export')}</button>
            </li>)}
          </ul>}
    {visiblePending && <div className="clients-attachment-pending">
      <span>{visiblePending.file.name} · {formatBytes(visiblePending.file.size)}</span>
      <button type="button" className="clients-link-button" disabled={busy} onClick={() => void addFile(visiblePending)}>
        {t('clients.retry')}
      </button>
    </div>}
    {visibleError && <p role="alert" className="clients-error">{visibleError}</p>}
  </section>;
}
