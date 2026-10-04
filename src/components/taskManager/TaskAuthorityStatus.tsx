import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, CloudOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauriRuntime } from '../../services/runtime';
import { taskAuthority } from '../../services/taskAuthority/service';
import type { TaskAuthorityEngine } from '../../services/taskAuthority/engine';
import type { TaskRecord } from '../../services/taskAuthority/model';
import './taskAuthority.css';

function description(value: TaskRecord | null, deleted: string) {
  if (!value) return deleted;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/DataUrl$/.test(key)));
}

function RecordVersion({ value }: { value: TaskRecord | null }) {
  const { t } = useTranslation();
  if (!value) return <p>{t('taskAuthority.deleted')}</p>;
  const plainText = (content: unknown): string => {
    if (typeof content === 'string') {
      try { return plainText(JSON.parse(content)); } catch { return content; }
    }
    if (!content || typeof content !== 'object') return '';
    const node = content as { text?: string; content?: unknown[] };
    return node.text ?? node.content?.map(plainText).join(' ') ?? '';
  };
  return <div className="task-authority-record">
    <p><strong>{String(value.title ?? value.name ?? value.sender ?? '')}</strong></p>
    {Boolean(value.status) && <p>{t(`taskAuthority.status_${String(value.status)}`)}</p>}
    {Boolean(value.date) && <p>{String(value.date)}</p>}
    {Boolean(value.content) && <p>{plainText(value.content)}</p>}
    {Boolean(value.text) && <p>{String(value.text)}</p>}
    {Boolean(value.deletedAt) && <p>{t('taskAuthority.deleted')}</p>}
    {typeof value.attachmentDataUrl === 'string' && <a href={value.attachmentDataUrl} download={String(value.attachmentName ?? 'attachment')}>
      {String(value.attachmentName ?? t('taskAuthority.attachment'))}</a>}
    <details><summary>{t('taskAuthority.details')}</summary><pre>{JSON.stringify(description(value, ''), null, 2)}</pre></details>
  </div>;
}

export function TaskAuthorityPanel({ engine, onClose }: { engine: TaskAuthorityEngine; onClose: () => void }) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return createPortal(<dialog ref={ref} className="task-authority-dialog" aria-labelledby="task-authority-heading" onClose={onClose}>
    <div className="task-authority-heading"><h2 id="task-authority-heading">{t('taskAuthority.title')}</h2>
      <button type="button" className="ai-toggle-btn" aria-label={t('taskAuthority.close')} onClick={onClose}><X size={18} /></button></div>
    <p role="status">{t(`taskAuthority.${status.state}`)}</p>
    <p>{status.metadata ? t('taskAuthority.connectedHelp') : t('taskAuthority.connectHelp')}</p>
    {status.metadata && <p>{t('taskAuthority.pending', { count: status.pending })} · {t('taskAuthority.lastSync')}: {status.metadata.lastSync
      ? new Date(status.metadata.lastSync).toLocaleString() : '—'}</p>}
    {Boolean(status.metadata?.projectionJobs?.length) && <p role="status">{t('taskAuthority.projectionsPending')}</p>}
    {(error || status.error && status.state !== 'editing') && <p role="alert">{t('taskAuthority.connectionError')} <code>{error || status.error}</code></p>}
    <button type="button" className="task-authority-action" disabled={busy || status.state === 'syncing'}
      onClick={() => void action(() => status.metadata ? engine.sync() : engine.connect())}>
      {t(status.metadata ? 'taskAuthority.refresh' : 'taskAuthority.connect')}</button>
    {status.conflicts.length > 0 && <section aria-label={t('taskAuthority.conflict')}>
      <h3>{t('taskAuthority.conflict')}</h3><p>{t('taskAuthority.conflictHelp')}</p>
      {status.metadata?.dependencyConflict && <div><p>{t('taskAuthority.groupHelp')}</p>
        <button disabled={busy} type="button" onClick={() => void action(() => engine.resolveGroup(status.conflicts, 'local'))}>{t('taskAuthority.chooseLocal')}</button>{' '}
        <button disabled={busy} type="button" onClick={() => void action(() => engine.resolveGroup(status.conflicts, 'remote'))}>{t('taskAuthority.chooseRemote')}</button>
      </div>}
      {status.conflicts.map(conflict => <article key={conflict.key} className="task-authority-conflict">
        <strong>{String(conflict.local?.title ?? conflict.local?.name ?? conflict.remote.value?.title ?? conflict.id)}</strong>
        <div className="task-authority-versions">
          <div><h4>{t('taskAuthority.localVersion')}</h4><RecordVersion value={conflict.local} />
            {!status.metadata?.dependencyConflict && <button disabled={busy} type="button" onClick={() => void action(() => engine.resolve(conflict, 'local'))}>{t('taskAuthority.chooseLocal')}</button>}</div>
          <div><h4>{t('taskAuthority.remoteVersion')}</h4><RecordVersion value={conflict.remote.value} />
            {!status.metadata?.dependencyConflict && <button disabled={busy} type="button" onClick={() => void action(() => engine.resolve(conflict, 'remote'))}>{t('taskAuthority.chooseRemote')}</button>}</div>
        </div>
      </article>)}
    </section>}
    {Boolean(status.metadata?.activity?.length) && <section><h3>{t('taskAuthority.history')}</h3><ul>
      {status.metadata?.activity?.map(item => <li key={item.operationId}>
        {new Date(item.at).toLocaleString()} · {item.actor.startsWith('tabs:') ? 'TABS' : item.actor} · {t(`taskAuthority.result_${item.outcome}`)} · {item.count}
      </li>)}
    </ul></section>}
  </dialog>, document.body);
}

export function TaskAuthorityStatus() {
  const { t } = useTranslation();
  const status = useSyncExternalStore(taskAuthority.subscribe, taskAuthority.getSnapshot);
  const [open, setOpen] = useState(false);
  if (!isTauriRuntime()) return null;
  return <>
    <button type="button" id="task-authority-status" className="ai-toggle-btn task-authority-status" data-state={status.state}
      aria-label={t('taskAuthority.title')} title={t(`taskAuthority.${status.state}`)} onClick={() => setOpen(true)}>
      {status.state === 'offline' ? <CloudOff size={16} /> : <Cloud size={16} />}
      <span>{status.conflicts.length || status.pending || 'VPS'}</span>
    </button>
    {open && <TaskAuthorityPanel engine={taskAuthority} onClose={() => setOpen(false)} />}
  </>;
}
