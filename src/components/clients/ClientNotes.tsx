import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../types';
import type { ClientContact, ClientDraft, ClientNote, ClientProfile } from '../../types/clients';
import type { TabsDB } from '../../services/db';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { clientDraftId } from '../../services/clients/records';
import { isNoClient } from '../../stores/clientOverview';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import { useClientStore } from '../../stores/clientStore';
import { ClientAttachments } from './ClientAttachments';
import { ClientNoteEditor } from './ClientNoteEditor';
import './clients.css';

interface ClientNotesProps {
  clientId: string | null;
  records: ClientRecordsAdapter;
  database: TabsDB;
}

type NoteKindFilter = 'all' | ClientNote['kind'];
type NotesState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error' }
  | { key: string; status: 'ready'; notes: ClientNote[]; clients: Client[]; profiles: ClientProfile[]; drafts: ClientDraft[] };
type EditorInfo = { clientId: string; draftId: string; note?: ClientNote };
type EditorContactsState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error' }
  | { key: string; status: 'ready'; contacts: ClientContact[] };
type NoteOperation = 'pin' | 'unpin' | 'trash' | 'restore';
type EditRetry = { kind: 'draft'; draftId: string } | { kind: 'note'; note: ClientNote };

const PAGE_SIZE = 50;

export function ClientNotes({ clientId, records, database }: ClientNotesProps) {
  const { t } = useTranslation();
  const clients = useClientStore((state) => state.clients);
  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<NoteKindFilter>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [state, setState] = useState<NotesState>({ key: '', status: 'loading' });
  const filterKey = JSON.stringify([query, kindFilter, pinnedOnly, showTrash, showArchived, clientId]);
  const [page, setPage] = useState<{ key: string; limit: number }>({ key: filterKey, limit: PAGE_SIZE });
  const limit = page.key === filterKey ? page.limit : PAGE_SIZE;
  const [retryToken, setRetryToken] = useState(0);
  const [editor, setEditor] = useState<EditorInfo | null>(null);
  const [editorContacts, setEditorContacts] = useState<EditorContactsState>({ key: '', status: 'loading' });
  const [createClientId, setCreateClientId] = useState('');
  const [openAttachments, setOpenAttachments] = useState<Record<string, boolean>>({});
  const [actionFailure, setActionFailure] = useState<{ note: ClientNote; operation: NoteOperation } | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [editFailure, setEditFailure] = useState(false);
  const [editRetry, setEditRetry] = useState<EditRetry | null>(null);
  const [createTargetError, setCreateTargetError] = useState(false);

  const queryClientId = showArchived ? null : clientId;
  const scopeKey = JSON.stringify([queryClientId, query, showTrash, showArchived]);
  const editorScopeKey = JSON.stringify([clientId, showTrash, showArchived]);
  const editorScopeRef = useRef(editorScopeKey);
  useLayoutEffect(() => {
    editorScopeRef.current = editorScopeKey;
  }, [editorScopeKey]);

  useEffect(() => {
    let active = true;
    const subscription = liveQuery(async () => {
      const [notesResult, allClients, profiles, drafts] = await Promise.all([
        records.listNotes({ clientId: queryClientId, deleted: showTrash, archived: showArchived, query }),
        database.clients.toArray(),
        database.clientProfiles.toArray(),
        database.clientDrafts.toArray(),
      ]);
      if (!notesResult.ok) return { ok: false as const };
      return { ok: true as const, notes: notesResult.value, clients: allClients, profiles, drafts };
    }).subscribe({
      next: (result) => {
        if (!active) return;
        if (!result.ok) {
          setState({ key: scopeKey, status: 'error' });
          return;
        }
        setState({ key: scopeKey, status: 'ready', ...result });
      },
      error: () => {
        if (active) setState({ key: scopeKey, status: 'error' });
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [scopeKey, queryClientId, query, showTrash, showArchived, database, records, retryToken]);

  const editorClientId = editor?.clientId;
  const editorDraftId = editor?.draftId;

  useEffect(() => {
    if (!editorClientId || !editorDraftId) return;
    let active = true;
    const key = JSON.stringify([editorClientId, editorDraftId]);
    const subscription = liveQuery(() => records.listContacts(editorClientId)).subscribe({
      next: (result) => {
        if (!active) return;
        if (result.ok) setEditorContacts({ key, status: 'ready', contacts: result.value });
        else setEditorContacts({ key, status: 'error' });
      },
      error: () => {
        if (active) setEditorContacts({ key, status: 'error' });
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [editorClientId, editorDraftId, records, retryToken]);

  const visibleState = state.key === scopeKey ? state : { key: scopeKey, status: 'loading' as const };
  const notes = visibleState.status === 'ready'
    ? visibleState.notes.filter((note) => (kindFilter === 'all' || note.kind === kindFilter)
      && (!pinnedOnly || note.pinned))
    : [];
  const displayedNotes = notes.slice(0, limit);
  const dataClients = visibleState.status === 'ready' ? visibleState.clients : clients;
  const profiles = visibleState.status === 'ready' ? visibleState.profiles : [];
  const drafts = visibleState.status === 'ready' ? visibleState.drafts : [];
  const visibleEditor = editor && !showArchived && !showTrash
    && (clientId === null || clientId === editor.clientId) ? editor : null;
  const editorContactKey = visibleEditor ? JSON.stringify([visibleEditor.clientId, visibleEditor.draftId]) : '';
  const editorContactsReady = editorContacts.key === editorContactKey && editorContacts.status === 'ready';
  const resumableDrafts = drafts.filter((draft): draft is Extract<ClientDraft, { kind: 'note' }> => {
    if (draft.kind !== 'note' || !dataClients.some((client) => client.id === draft.clientId)) return false;
    if (clientId !== null && draft.clientId !== clientId) return false;
    const owner = dataClients.find((client) => client.id === draft.clientId);
    if (!owner || isNoClient(owner)) return false;
    return !visibleEditor || draft.id !== visibleEditor.draftId;
  });
  const canCreateForScope = !showTrash && !showArchived
    && (clientId === null || Boolean(selectedClient && !isNoClient(selectedClient)));
  const canCreate = canCreateForScope && !visibleEditor;
  const liveBrands = dataClients.filter((client) => !isNoClient(client));


  const getClientName = (note: ClientNote): string => {
    const owner = dataClients.find((client) => client.id === note.clientId);
    if (owner) return owner.name;
    const profile = profiles.find((entry) => entry.clientId === note.clientId);
    return profile?.clientSnapshot.name ?? note.clientId;
  };

  const startCreate = (occurredAt: number) => {
    setEditFailure(false);
    setCreateTargetError(false);
    if (clientId === null) {
      const selected = dataClients.find((item) => item.id === createClientId);
      if (!selected || isNoClient(selected)) {
        setCreateTargetError(true);
        return;
      }
      const draft = useClientDetailsStore.getState().startEdit({
        kind: 'note', clientId: selected.id, baseRevision: null,
        value: { title: '', bodyText: '', kind: 'note', occurredAt, contactId: null },
      });
      setEditor({ clientId: selected.id, draftId: draft.id });
      return;
    }
    if (!selectedClient || isNoClient(selectedClient)) return;
    const draft = useClientDetailsStore.getState().startEdit({
      kind: 'note', clientId: selectedClient.id, baseRevision: null,
      value: { title: '', bodyText: '', kind: 'note', occurredAt, contactId: null },
    });
    setEditor({ clientId: selectedClient.id, draftId: draft.id });
  };

  const resumeDraft = async (draftId: string) => {
    const requestedScope = editorScopeKey;
    setEditFailure(false);
    setEditRetry(null);
    const result = await records.getDraft(draftId);
    if (editorScopeRef.current !== requestedScope || showArchived || showTrash) return;
    if (!result.ok || !result.value || result.value.kind !== 'note') {
      setEditFailure(true);
      setEditRetry({ kind: 'draft', draftId });
      return;
    }
    useClientDetailsStore.getState().recoverDraft(result.value);
    setEditor({ clientId: result.value.clientId, draftId: result.value.id });
  };

  const beginEdit = async (note: ClientNote) => {
    const requestedScope = editorScopeKey;
    setEditFailure(false);
    setEditRetry(null);
    setCreateTargetError(false);
    const draftId = clientDraftId(note.clientId, 'note', note.id);
    const volatile = useClientDetailsStore.getState().drafts[draftId];
    if (volatile?.kind === 'note') {
      setEditor({ clientId: note.clientId, draftId, note });
      return;
    }
    const storedResult = await records.getDraft(draftId);
    if (editorScopeRef.current !== requestedScope || showArchived || showTrash) return;
    if (!storedResult.ok) {
      setEditFailure(true);
      setEditRetry({ kind: 'note', note });
      return;
    }
    if (storedResult.value?.kind === 'note') useClientDetailsStore.getState().recoverDraft(storedResult.value);
    else useClientDetailsStore.getState().startEdit({
      kind: 'note', clientId: note.clientId, recordId: note.id, baseRevision: note.revision,
      value: { title: note.title, bodyText: note.bodyText, kind: note.kind,
        occurredAt: note.occurredAt, contactId: note.contactId },
    });
    setEditor({ clientId: note.clientId, draftId, note });
  };

  const executeOperation = async (note: ClientNote, operation: NoteOperation) => {
    const key = `${note.id}:${operation}`;
    setActionBusy(key);
    setActionFailure(null);
    const result = operation === 'pin' || operation === 'unpin'
      ? await records.setNotePinned({ id: note.id, clientId: note.clientId,
        expectedRevision: note.revision, pinned: operation === 'pin' })
      : await records.setNoteDeleted({ id: note.id, clientId: note.clientId,
        expectedRevision: note.revision, deleted: operation === 'trash' });
    setActionBusy(null);
    if (!result.ok) setActionFailure({ note, operation });
  };

  const canMutateNote = (note: ClientNote): boolean => {
    if (showArchived) return false;
    const owner = dataClients.find((client) => client.id === note.clientId);
    return Boolean(owner && !isNoClient(owner));
  };

  return <div className="clients-notes">
    <section className="clients-notes-controls" aria-label={t('clients.notesFilter')}>
      <label className="clients-field clients-notes-search">
        <span>{t('clients.searchNotes')}</span>
        <input type="search" aria-label={t('clients.searchNotes')} value={query}
          onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
      <label className="clients-field">
        <span>{t('clients.noteKind')}</span>
        <select aria-label={t('clients.noteKind')} value={kindFilter}
          onChange={(event) => setKindFilter(event.currentTarget.value as NoteKindFilter)}>
          <option value="all">{t('clients.noteKindAll')}</option>
          <option value="call">{t('clients.kindCall')}</option>
          <option value="meeting">{t('clients.kindMeeting')}</option>
          <option value="decision">{t('clients.kindDecision')}</option>
          <option value="note">{t('clients.kindNote')}</option>
        </select>
      </label>
      <label className="clients-checkbox-field">
        <input type="checkbox" checked={pinnedOnly} onChange={(event) => setPinnedOnly(event.currentTarget.checked)} />
        <span>{t('clients.pinnedOnly')}</span>
      </label>
      <label className="clients-checkbox-field">
        <input type="checkbox" checked={showTrash} onChange={(event) => setShowTrash(event.currentTarget.checked)} />
        <span>{t('clients.showTrash')}</span>
      </label>
      <label className="clients-checkbox-field">
        <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.currentTarget.checked)} />
        <span>{t('clients.showArchived')}</span>
      </label>
    </section>

    {showArchived && <p className="clients-read-only-notice" role="status">{t('clients.notesReadOnly')}</p>}
    {clientId !== null && selectedClient && isNoClient(selectedClient) &&
      <p className="clients-read-only-notice" role="status">{t('clients.noClientNotesReadOnly')}</p>}
    {canCreate && <div className="clients-note-create">
      {clientId === null && <label className="clients-field">
        <span>{t('clients.selectClient')}</span>
        <select aria-label={t('clients.selectClient')} value={createClientId}
          onChange={(event) => { setCreateClientId(event.currentTarget.value); setCreateTargetError(false); }}>
          <option value="">{t('clients.selectClient')}</option>
          {liveBrands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>}
      <button type="button" className="clients-button clients-button--primary" onClick={() => startCreate(Date.now())}>{t('clients.addNote')}</button>
      {createTargetError && <p role="alert" className="clients-error">{t('clients.selectBrandToCreate')}</p>}
    </div>}

    {resumableDrafts.map((draft) => <div className="clients-resume-draft" key={draft.id}>
      <span>{draft.value.title || t('clients.untitledNote')}</span>
      <button type="button" className="clients-link-button"
        aria-label={t('clients.resumeNoteDraft', { title: draft.value.title || t('clients.untitledNote') })}
        onClick={() => void resumeDraft(draft.id)}>{t('clients.resumeDraft')}</button>
    </div>)}

    {editFailure && <p role="alert" className="clients-error">{t('clients.loadFailed')}
      <button type="button" className="clients-link-button" onClick={() => {
        if (editRetry?.kind === 'draft') void resumeDraft(editRetry.draftId);
        if (editRetry?.kind === 'note') void beginEdit(editRetry.note);
      }}>{t('clients.retry')}</button>
    </p>}

    {visibleEditor && <section className="clients-note-editor-shell">
      {editorContactsReady
        ? <ClientNoteEditor key={`${visibleEditor.clientId}:${visibleEditor.draftId}`}
          clientId={visibleEditor.clientId} draftId={visibleEditor.draftId} contacts={editorContacts.contacts}
          records={records} database={database} note={visibleEditor.note} onClose={() => setEditor(null)}
          onPublished={() => setEditor(null)} />
        : editorContacts.key === editorContactKey && editorContacts.status === 'error'
          ? <div><p role="alert" className="clients-error">{t('clients.loadFailed')}</p>
            <button type="button" className="clients-link-button" onClick={() => setRetryToken((value) => value + 1)}>{t('clients.retry')}</button></div>
          : <p role="status">{t('clients.loading')}</p>}
    </section>}

    {visibleState.status === 'loading' && <p className="clients-data-state" role="status" aria-busy="true">{t('clients.loading')}</p>}
    {visibleState.status === 'error' && <div className="clients-data-state">
      <p role="alert" className="clients-error">{t('clients.loadFailed')}</p>
      <button type="button" className="clients-button" onClick={() => setRetryToken((value) => value + 1)}>{t('clients.retry')}</button>
    </div>}
    {visibleState.status === 'ready' && displayedNotes.length === 0 &&
      <p className="clients-empty-state" role="status">{clientId !== null && !showArchived && !showTrash
        ? t('clients.noNotesForClient') : t('clients.noNotes')}</p>}

    {visibleState.status === 'ready' && displayedNotes.length > 0 && <div className="clients-note-list">
      {displayedNotes.map((note) => {
        const ownerName = getClientName(note);
        const archivedNote = !dataClients.some((client) => client.id === note.clientId);
        const canMutate = canMutateNote(note);
        const canEdit = canMutate && !showTrash;
        const failedAction = actionFailure?.note.id === note.id ? actionFailure : null;
        const happenedAt = new Date(note.occurredAt);
        const dateValue = Number.isNaN(happenedAt.getTime()) ? undefined : happenedAt.toISOString();
        const dateLabel = Number.isNaN(happenedAt.getTime()) ? '' : happenedAt.toLocaleString();
        const kindLabels: Record<ClientNote['kind'], string> = {
          call: t('clients.kindCall'), meeting: t('clients.kindMeeting'),
          decision: t('clients.kindDecision'), note: t('clients.kindNote'),
        };
        return <article className="clients-note-card" key={note.id} data-note-id={note.id}
          aria-label={note.title || t('clients.untitledNote')}>
          <div className="clients-note-heading">
            <div>
              <h3>{note.title || t('clients.untitledNote')}</h3>
              <div className="clients-note-meta">
                <span>{kindLabels[note.kind]}</span>
                {dateValue && <time dateTime={dateValue}>{dateLabel}</time>}
                {note.pinned && <span className="clients-note-pinned">{t('clients.pinnedLabel')}</span>}
                {clientId === null && <span>{archivedNote
                  ? t('clients.archivedClient', { name: ownerName }) : t('clients.noteByClient', { name: ownerName })}</span>}
              </div>
            </div>
            <div className="clients-note-actions">
              {canEdit && <button type="button" className="clients-link-button"
                aria-label={t('clients.editNoteNamed', { title: note.title || t('clients.untitledNote') })}
                onClick={() => void beginEdit(note)}>{t('clients.editNote')}</button>}
              {canMutate && !showTrash && <button type="button" className="clients-link-button"
                aria-label={t(note.pinned ? 'clients.unpinNote' : 'clients.pinNote')}
                disabled={actionBusy === `${note.id}:${note.pinned ? 'unpin' : 'pin'}`}
                onClick={() => void executeOperation(note, note.pinned ? 'unpin' : 'pin')}>
                {t(note.pinned ? 'clients.unpinNote' : 'clients.pinNote')}
              </button>}
              {canMutate && !showTrash && <button type="button" className="clients-link-button"
                disabled={actionBusy === `${note.id}:trash`}
                onClick={() => void executeOperation(note, 'trash')}>{t('clients.moveToTrash')}</button>}
              {canMutate && showTrash && <button type="button" className="clients-link-button"
                disabled={actionBusy === `${note.id}:restore`}
                onClick={() => void executeOperation(note, 'restore')}>{t('clients.restoreNote')}</button>}
            </div>
          </div>
          {note.bodyText && <p className="clients-note-body clients-plain-text">{note.bodyText}</p>}
          {note.contactSnapshot && <p className="clients-note-contact">
            {t('clients.historicalContact', { name: note.contactSnapshot.name })}
            {note.contactSnapshot.email && ` · ${note.contactSnapshot.email}`}
          </p>}
          <button type="button" className="clients-link-button"
            aria-expanded={Boolean(openAttachments[note.id])}
            onClick={() => setOpenAttachments((current) => ({ ...current, [note.id]: !current[note.id] }))}>
            {t(openAttachments[note.id] ? 'clients.hideAttachments' : 'clients.showAttachments')}
          </button>
          {openAttachments[note.id] && <ClientAttachments clientId={note.clientId} ownerType="note" ownerId={note.id}
            records={records} database={database} readOnly={archivedNote || !canMutate} />}
          {failedAction && <div className="clients-action-error">
            <p role="alert" className="clients-error">{t('clients.noteUpdateFailed')}</p>
            <button type="button" className="clients-link-button"
              onClick={() => void executeOperation(failedAction.note, failedAction.operation)}>{t('clients.retry')}</button>
          </div>}
        </article>;
      })}
    </div>}
    {visibleState.status === 'ready' && displayedNotes.length < notes.length &&
      <button type="button" className="clients-button" onClick={() => setPage((current) => ({
        key: filterKey, limit: (current.key === filterKey ? current.limit : PAGE_SIZE) + PAGE_SIZE,
      }))}>{t('clients.loadMore')}</button>}
  </div>;
}
