import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../types';
import type { ClientContact, ClientDraft, ClientProfile, ClientRecordErrorCode, ProfileDraftValue } from '../../types/clients';
import type { TabsDB } from '../../services/db';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { useClientAutosave } from '../../hooks/useClientAutosave';
import { clientDraftId } from '../../services/clients/records';
import { isNoClient } from '../../stores/clientOverview';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import type { ClientProfileRevisionMutation } from '../../stores/clientDetailsStore';
import { useClientStore } from '../../stores/clientStore';
import { ClientContacts } from './ClientContacts';
import './clients.css';

interface ClientProfileProps {
  client: Client | null;
  records: ClientRecordsAdapter;
  database: TabsDB;
}

type ProfileDataState =
  | { clientId: string; status: 'loading' }
  | { clientId: string; status: 'error' }
  | { clientId: string; status: 'ready'; profile: ClientProfile | null; contacts: ClientContact[]; drafts: ClientDraft[] };

type SaveStatus = 'saving' | 'saved' | 'error';

function statusLabel(status: 'idle' | 'saving' | 'saved' | 'error', t: (key: string) => string): string {
  if (status === 'saving') return t('clients.saveSaving');
  if (status === 'saved') return t('clients.saveSaved');
  if (status === 'error') return t('clients.saveError');
  return t('clients.saveIdle');
}

async function discardProfileDraftForResolution(
  draft: Extract<ClientDraft, { kind: 'profile' }>,
  records: ClientRecordsAdapter,
): Promise<ClientRecordErrorCode | null> {
  const stored = await records.getDraft(draft.id);
  if (!stored.ok) return stored.code;
  if (!stored.value) return null;
  if (stored.value.kind !== 'profile' || stored.value.clientId !== draft.clientId
    || stored.value.recordId !== draft.recordId || stored.value.editSessionId !== draft.editSessionId
    || stored.value.generation > draft.generation) return 'CONFLICT';
  const discarded = await records.discardDraft({
    id: stored.value.id,
    editSessionId: stored.value.editSessionId,
    generation: stored.value.generation,
  });
  return discarded.ok ? null : discarded.code;
}

function ProfileAutosave({ draft, records, mutationPending, resolvingConflict, onKeepEdits, onUseLatest }: {
  draft: Extract<ClientDraft, { kind: 'profile' }>;
  records: ClientRecordsAdapter;
  mutationPending: boolean;
  resolvingConflict: boolean;
  onKeepEdits: (retry: () => Promise<void>) => Promise<void>;
  onUseLatest: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const autosave = useClientAutosave({ draft, value: draft.value, records });
  const status = mutationPending ? 'saving' : autosave.status;
  return <div className="clients-save-state" aria-live="polite">
    <span role={status === 'error' ? 'alert' : 'status'}>{statusLabel(status, t)}</span>
    {status === 'error' && autosave.errorCode === 'CONFLICT' ? <>
      <span className="clients-error">{t('clients.profileConflict')}</span>
      <button type="button" className="clients-link-button" disabled={resolvingConflict}
        onClick={() => void onKeepEdits(autosave.retry)}>{t('clients.keepProfileEdits')}</button>
      <button type="button" className="clients-link-button" disabled={resolvingConflict}
        onClick={() => void onUseLatest()}>{t('clients.useLatestProfile')}</button>
    </> : status === 'error' && <>
      <span className="clients-error">{t('clients.saveFailed')}</span>
      <button type="button" className="clients-link-button" onClick={() => void autosave.retry()}>{t('clients.retry')}</button>
    </>}
  </div>;
}

async function persistProfileAfterRevisionMutation(
  mutation: ClientProfileRevisionMutation,
  initialDraft: Extract<ClientDraft, { kind: 'profile' }>,
  records: ClientRecordsAdapter,
): Promise<void> {
  const store = useClientDetailsStore.getState();
  let draft = initialDraft;
  while (true) {
    const current = useClientDetailsStore.getState().drafts[mutation.id];
    if (!current || current.kind !== 'profile' || current.editSessionId !== mutation.editSessionId) {
      store.finishProfileRevisionMutation(mutation);
      return;
    }
    draft = current;
    const durable = await records.saveDraft(draft);
    if (!durable.ok || durable.value.kind !== 'profile') {
      useClientDetailsStore.getState().failProfileRevisionMutation(mutation,
        durable.ok ? 'CONFLICT' : durable.code);
      return;
    }
    const savedDraft = durable.value;
    const result = await records.saveProfile({
      clientId: savedDraft.clientId,
      expectedRevision: savedDraft.baseRevision,
      value: savedDraft.value,
      draftAck: {
        id: savedDraft.id,
        generation: savedDraft.generation,
        editSessionId: savedDraft.editSessionId,
      },
    });
    if (!result.ok) {
      const latest = useClientDetailsStore.getState().drafts[mutation.id];
      if (result.code === 'VALIDATION' && latest?.kind === 'profile'
        && latest.editSessionId === mutation.editSessionId && latest.generation > savedDraft.generation) continue;
      useClientDetailsStore.getState().failProfileRevisionMutation(mutation, result.code);
      return;
    }
    useClientDetailsStore.getState().markSaved(savedDraft.id, savedDraft.editSessionId,
      savedDraft.generation, result.value.revision);
    const latest = useClientDetailsStore.getState().drafts[mutation.id];
    if (latest?.kind === 'profile' && latest.editSessionId === mutation.editSessionId
      && latest.generation > savedDraft.generation) continue;
    useClientDetailsStore.getState().finishProfileRevisionMutation(mutation);
    return;
  }
}

function ProfileLocalEditor({
  draft,
  records,
  onClose,
  mutationPending,
  onKeepEdits,
  onUseLatest,
}: {
  draft: Extract<ClientDraft, { kind: 'profile' }>;
  records: ClientRecordsAdapter;
  onClose: () => void;
  mutationPending: boolean;
  onKeepEdits: (retry: () => Promise<void>) => Promise<void>;
  onUseLatest: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const current = useClientDetailsStore((state) => state.drafts[draft.id]);
  const latest = current?.kind === 'profile' && current.editSessionId === draft.editSessionId ? current : draft;
  const change = (value: ProfileDraftValue) => {
    useClientDetailsStore.getState().updateDraft({ id: latest.id, editSessionId: latest.editSessionId, value });
  };
  const saveState = useClientDetailsStore((state) => state.saveStates[draft.id]);
  const status = mutationPending ? 'saving'
    : saveState?.editSessionId === latest.editSessionId && saveState.generation === latest.generation
      ? saveState.status : 'idle';
  const resolveKeepEdits = async (retry: () => Promise<void>) => {
    setResolvingConflict(true);
    try {
      await onKeepEdits(retry);
    } finally {
      setResolvingConflict(false);
    }
  };
  const resolveUseLatest = async () => {
    setResolvingConflict(true);
    try {
      await onUseLatest();
    } finally {
      setResolvingConflict(false);
    }
  };

  return <form className="clients-editor-form" aria-label={t('clients.localProfile')} onSubmit={(event) => event.preventDefault()}>
    <label className="clients-field">
      <span>{t('clients.website')}</span>
      <input type="url" value={latest.value.website} placeholder="https://example.com"
        disabled={resolvingConflict}
        onChange={(event) => change({ ...latest.value, website: event.currentTarget.value })} />
    </label>
    <label className="clients-field">
      <span>{t('clients.description')}</span>
      <textarea rows={4} value={latest.value.description}
        disabled={resolvingConflict}
        onChange={(event) => change({ ...latest.value, description: event.currentTarget.value })} />
    </label>
    {latest.generation > 0 && <ProfileAutosave draft={latest} records={records} mutationPending={mutationPending}
      resolvingConflict={resolvingConflict} onKeepEdits={resolveKeepEdits} onUseLatest={resolveUseLatest} />}
    <div className="clients-editor-actions">
      {status === 'idle' && latest.generation > 0 && <span role="status">{t('clients.saveIdle')}</span>}
      <button type="button" className="clients-button" disabled={resolvingConflict}
        onClick={onClose}>{t('clients.cancelKeepDraft')}</button>
    </div>
  </form>;
}

export function ClientProfile({ client, records, database }: ClientProfileProps) {
  const { t } = useTranslation();
  const clientId = client?.id ?? '';
  const profileId = clientId ? clientDraftId(clientId, 'profile', clientId) : '';
  const profileDraft = useClientDetailsStore((state) => {
    const draft = profileId ? state.drafts[profileId] : undefined;
    return draft?.kind === 'profile' ? draft : undefined;
  });
  const profileRevisionMutationPending = useClientDetailsStore((state) => Boolean(state.profileRevisionMutations[profileId]));
  const updateClient = useClientStore((state) => state.updateClient);
  const [data, setData] = useState<ProfileDataState>({ clientId, status: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  const [editingLocalFor, setEditingLocalFor] = useState<string | null>(null);
  const [canonicalForm, setCanonicalForm] = useState({ clientId, name: client?.name ?? '', color: client?.color ?? '#000000' });
  const [canonicalSave, setCanonicalSave] = useState<{ clientId: string; status: SaveStatus } | null>(null);

  useEffect(() => {
    if (!client || isNoClient(client)) return;
    let active = true;
    const subscription = liveQuery(async () => {
      const [profileResult, contactsResult, drafts] = await Promise.all([
        records.getProfile(client.id),
        records.listContacts(client.id),
        database.clientDrafts.where('clientId').equals(client.id).toArray(),
      ]);
      if (!profileResult.ok || !contactsResult.ok) return { error: true as const };
      return { error: false as const, profile: profileResult.value, contacts: contactsResult.value, drafts };
    }).subscribe({
      next: (result) => {
        if (!active) return;
        if (result.error) {
          setData({ clientId: client.id, status: 'error' });
          return;
        }
        const drafts = result.drafts as ClientDraft[];
        for (const draft of drafts) {
          if (draft.kind === 'profile' || draft.kind === 'contact') {
            const store = useClientDetailsStore.getState();
            const current = store.drafts[draft.id];
            if (!current || current.editSessionId !== draft.editSessionId || current.generation < draft.generation) {
              store.recoverDraft(draft);
            }
          }
        }
        const recoveredProfile = drafts.find((draft) => draft.kind === 'profile' && draft.recordId === client.id);
        if (recoveredProfile?.kind === 'profile') setEditingLocalFor(client.id);
        setData({ clientId: client.id, status: 'ready', profile: result.profile, contacts: result.contacts, drafts });
      },
      error: () => {
        if (active) setData({ clientId: client.id, status: 'error' });
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client, clientId, database, records, retryToken]);

  const visibleData = data.clientId === clientId ? data : { clientId, status: 'loading' as const };
  const currentForm = canonicalForm.clientId === clientId && client
    ? canonicalForm
    : { clientId, name: client?.name ?? '', color: client?.color ?? '#000000' };
  const visibleSave = canonicalSave?.clientId === clientId ? canonicalSave.status : null;

  const beginProfileRevisionMutation = (baseRevision: number | null) =>
    useClientDetailsStore.getState().beginProfileRevisionMutation(clientId, baseRevision);

  const completeProfileRevisionMutation = async (mutation: ClientProfileRevisionMutation, revision: number | null) => {
    const newerDraft = useClientDetailsStore.getState().completeProfileRevisionMutation(mutation, { revision });
    if (newerDraft) await persistProfileAfterRevisionMutation(mutation, newerDraft, records);
  };

  const failProfileRevisionMutation = (mutation: ClientProfileRevisionMutation, code: ClientRecordErrorCode) =>
    useClientDetailsStore.getState().failProfileRevisionMutation(mutation, code);

  const markProfileResolutionError = (draft: Extract<ClientDraft, { kind: 'profile' }>, code: ClientRecordErrorCode) =>
    useClientDetailsStore.getState().markError({
      id: draft.id, editSessionId: draft.editSessionId, generation: draft.generation, code,
    });

  const keepProfileEditsAfterConflict = async (retry: () => Promise<void>) => {
    const initial = useClientDetailsStore.getState().drafts[profileId];
    if (!initial || initial.kind !== 'profile' || initial.clientId !== clientId) return;
    const latestResult = await records.getProfile(clientId);
    if (!latestResult.ok) {
      markProfileResolutionError(initial, latestResult.code);
      return;
    }
    setData((current) => current.clientId === clientId && current.status === 'ready'
      ? { ...current, profile: latestResult.value } : current);
    const current = useClientDetailsStore.getState().drafts[profileId];
    if (!current || current.kind !== 'profile' || current.editSessionId !== initial.editSessionId) return;
    const durable = await records.getDraft(profileId);
    if (!durable.ok) {
      markProfileResolutionError(current, durable.code);
      return;
    }
    if (durable.value && (durable.value.kind !== 'profile' || durable.value.clientId !== clientId
      || durable.value.editSessionId !== current.editSessionId || durable.value.generation > current.generation)) {
      markProfileResolutionError(current, 'CONFLICT');
      return;
    }

    const currentRevision = latestResult.value?.revision ?? null;
    if (durable.value && durable.value.baseRevision !== currentRevision) {
      let revision = currentRevision;
      let profile = latestResult.value;
      let committing = current;
      while (!profile || profile.website !== committing.value.website
        || profile.description !== committing.value.description) {
        const saved = await records.saveProfile({
          clientId,
          expectedRevision: revision,
          value: committing.value,
        });
        if (!saved.ok) {
          markProfileResolutionError(committing, saved.code === 'VALIDATION' ? 'VALIDATION' : 'CONFLICT');
          return;
        }
        profile = saved.value;
        revision = saved.value.revision;
        const newest = useClientDetailsStore.getState().drafts[profileId];
        if (!newest || newest.kind !== 'profile' || newest.editSessionId !== current.editSessionId) return;
        if (newest.generation === committing.generation) break;
        committing = newest;
      }
      if (!profile) {
        markProfileResolutionError(current, 'CONFLICT');
        return;
      }
      setData((loaded) => loaded.clientId === clientId && loaded.status === 'ready'
        ? { ...loaded, profile } : loaded);
      useClientDetailsStore.getState().markSaved(committing.id, committing.editSessionId,
        committing.generation, profile.revision);
      const discardError = await discardProfileDraftForResolution(committing, records);
      if (discardError) markProfileResolutionError(committing, 'CONFLICT');
      return;
    }

    if (!durable.value && current.baseRevision !== currentRevision) {
      const resolved = useClientDetailsStore.getState().resolveProfileConflict({
        id: current.id,
        editSessionId: current.editSessionId,
        generation: current.generation,
        expectedBaseRevision: current.baseRevision,
        baseRevision: currentRevision,
      });
      if (!resolved) {
        markProfileResolutionError(current, 'CONFLICT');
        return;
      }
      await retry();
      return;
    }

    const resolved = useClientDetailsStore.getState().resolveProfileConflict({
      id: current.id,
      editSessionId: current.editSessionId,
      generation: current.generation,
      expectedBaseRevision: current.baseRevision,
      baseRevision: currentRevision,
    });
    if (!resolved) {
      markProfileResolutionError(current, 'CONFLICT');
      return;
    }
    await retry();
  };

  const useLatestProfileAfterConflict = async () => {
    const initial = useClientDetailsStore.getState().drafts[profileId];
    if (!initial || initial.kind !== 'profile' || initial.clientId !== clientId) return;
    const latestResult = await records.getProfile(clientId);
    if (!latestResult.ok) {
      markProfileResolutionError(initial, latestResult.code);
      return;
    }
    setData((current) => current.clientId === clientId && current.status === 'ready'
      ? { ...current, profile: latestResult.value } : current);
    const current = useClientDetailsStore.getState().drafts[profileId];
    if (!current || current.kind !== 'profile' || current.editSessionId !== initial.editSessionId) return;
    const discardError = await discardProfileDraftForResolution(current, records);
    if (discardError) {
      markProfileResolutionError(current, discardError);
      return;
    }
    const latestDraft = useClientDetailsStore.getState().drafts[profileId];
    if (!latestDraft || latestDraft.kind !== 'profile' || latestDraft.editSessionId !== current.editSessionId) return;
    useClientDetailsStore.getState().clearDraft(latestDraft.id, latestDraft.editSessionId, latestDraft.generation);
    setEditingLocalFor(null);
  };

  const saveCanonical = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !currentForm.name.trim()) return;
    const submitted = { name: currentForm.name.trim(), color: currentForm.color };
    const mutation = useClientDetailsStore.getState()
      .beginProfileRevisionMutation(client.id, visibleData.status === 'ready' ? visibleData.profile?.revision ?? null : null);
    if (!mutation) {
      setCanonicalSave({ clientId: client.id, status: 'error' });
      return;
    }
    const localProfile = visibleData.status === 'ready' ? visibleData.profile : null;
    const localValue = profileDraft?.clientId === client.id
      ? { ...profileDraft.value }
      : { website: localProfile?.website ?? '', description: localProfile?.description ?? '' };
    setCanonicalSave({ clientId: client.id, status: 'saving' });
    try {
      await updateClient(client.id, submitted);
      const savedClient = useClientStore.getState().clients.find((entry) => entry.id === client.id);
      const canonicalCommitted = savedClient?.name === submitted.name && savedClient.color === submitted.color;
      if (!canonicalCommitted) {
        const newerDraft = useClientDetailsStore.getState().completeProfileRevisionMutation(mutation,
          { revision: mutation.baseRevision });
        if (newerDraft) await persistProfileAfterRevisionMutation(mutation, newerDraft, records);
        setCanonicalSave({ clientId: client.id, status: 'error' });
        return;
      }
      if (localProfile) {
        const refreshed = await records.saveProfile({
          clientId: client.id,
          expectedRevision: localProfile.revision,
          value: localValue,
        });
        if (!refreshed.ok) {
          failProfileRevisionMutation(mutation, refreshed.code);
          setCanonicalSave({ clientId: client.id, status: 'error' });
          return;
        }
        await completeProfileRevisionMutation(mutation, refreshed.value.revision);
      } else {
        await completeProfileRevisionMutation(mutation, null);
      }
      setCanonicalSave({ clientId: client.id, status: 'saved' });
    } catch {
      failProfileRevisionMutation(mutation, 'STORAGE');
      setCanonicalSave({ clientId: client.id, status: 'error' });
    }
  };

  const beginLocalEdit = () => {
    if (!client) return;
    if (useClientDetailsStore.getState().profileRevisionMutations[profileId]) return;
    const profile = visibleData.status === 'ready' ? visibleData.profile : null;
    const draft = useClientDetailsStore.getState().startEdit({
      kind: 'profile', clientId: client.id, baseRevision: profile?.revision ?? null,
      value: { website: profile?.website ?? '', description: profile?.description ?? '' },
    });
    setEditingLocalFor(client.id);
    if (draft.id !== profileId) setEditingLocalFor(null);
  };

  if (!client || isNoClient(client)) return <section className="clients-data-state">
    <p role="status">{t('clients.profileNeedsBrand')}</p>
  </section>;
  if (visibleData.status === 'loading') return <section className="clients-data-state" aria-busy="true">
    <p role="status">{t('clients.loading')}</p>
  </section>;
  if (visibleData.status === 'error') return <section className="clients-data-state">
    <p role="alert">{t('clients.loadFailed')}</p>
    <button type="button" className="clients-button" onClick={() => setRetryToken((value) => value + 1)}>{t('clients.retry')}</button>
  </section>;

  const localProfile = visibleData.profile;
  const editing = editingLocalFor === client.id && profileDraft?.clientId === client.id ? profileDraft : undefined;
  const contactDrafts = visibleData.drafts.filter((draft) => draft.kind === 'contact');

  return <div className="clients-profile">
    <section className="clients-profile-section" aria-labelledby="clients-canonical-profile-title">
      <h2 id="clients-canonical-profile-title">{t('clients.canonicalProfile')}</h2>
      <form className="clients-editor-form" onSubmit={(event) => void saveCanonical(event)}>
        <label className="clients-field">
          <span>{t('clients.name')}</span>
          <input type="text" value={currentForm.name}
            onChange={(event) => setCanonicalForm({ ...currentForm, name: event.currentTarget.value })} />
        </label>
        <label className="clients-field">
          <span>{t('clients.color')}</span>
          <input type="color" value={currentForm.color}
            onChange={(event) => setCanonicalForm({ ...currentForm, color: event.currentTarget.value })} />
        </label>
        <div className="clients-editor-actions">
          <button type="submit" className="clients-button clients-button--primary">{t('clients.saveProfile')}</button>
          {visibleSave && <span role={visibleSave === 'error' ? 'alert' : 'status'} aria-live="polite">{
            visibleSave === 'saving' ? t('clients.canonicalSaving')
              : visibleSave === 'saved' ? t('clients.canonicalSaved') : t('clients.canonicalFailed')
          }</span>}
        </div>
      </form>
    </section>

    <section className="clients-profile-section" aria-labelledby="clients-local-profile-title">
      <div className="clients-profile-section-heading">
        <h2 id="clients-local-profile-title">{t('clients.localProfile')}</h2>
        {!editing && <button type="button" className="clients-button" disabled={profileRevisionMutationPending}
          onClick={beginLocalEdit}>{t('clients.editProfile')}</button>}
      </div>
      {!editing && <div className="clients-local-profile-summary">
        {!localProfile || (!localProfile.website && !localProfile.description)
          ? <p className="clients-muted">{t('clients.noProfileDetails')}</p>
          : <>
            {localProfile.website && <p><strong>{t('clients.website')}:</strong> {localProfile.website}</p>}
            {localProfile.description && <p className="clients-plain-text">{localProfile.description}</p>}
          </>}
      </div>}
      {editing && <ProfileLocalEditor key={editing.editSessionId} draft={editing} records={records}
        onClose={() => setEditingLocalFor(null)} mutationPending={profileRevisionMutationPending}
        onKeepEdits={keepProfileEditsAfterConflict} onUseLatest={useLatestProfileAfterConflict} />}
    </section>

    <ClientContacts key={client.id} clientId={client.id} profile={localProfile}
      contacts={visibleData.contacts} contactDrafts={contactDrafts} records={records}
      onProfileRevisionMutationStart={beginProfileRevisionMutation}
      onProfileRevisionMutationSuccess={completeProfileRevisionMutation}
      onProfileRevisionMutationFailure={failProfileRevisionMutation} />
  </div>;
}
