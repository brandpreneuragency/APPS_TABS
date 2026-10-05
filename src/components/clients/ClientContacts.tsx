import { useState } from 'react';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ClientContact, ClientDraft, ClientProfile, ClientRecordErrorCode, ContactDraftValue } from '../../types/clients';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { useClientAutosave } from '../../hooks/useClientAutosave';
import { clientDraftId } from '../../services/clients/records';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import type { ClientProfileRevisionMutation } from '../../stores/clientDetailsStore';
import './clients.css';

interface ClientContactsProps {
  clientId: string;
  profile: ClientProfile | null;
  contacts: ClientContact[];
  contactDrafts: ClientDraft[];
  records: ClientRecordsAdapter;
  onProfileRevisionMutationStart: (baseRevision: number | null) => ClientProfileRevisionMutation | null;
  onProfileRevisionMutationSuccess: (mutation: ClientProfileRevisionMutation, revision: number | null) => Promise<void>;
  onProfileRevisionMutationFailure: (mutation: ClientProfileRevisionMutation, code: ClientRecordErrorCode) => void;
}

function saveStatusLabel(status: 'idle' | 'saving' | 'saved' | 'error', t: (key: string) => string): string {
  if (status === 'saving') return t('clients.saveSaving');
  if (status === 'saved') return t('clients.saveSaved');
  if (status === 'error') return t('clients.saveError');
  return t('clients.saveIdle');
}

function ContactAutosave({ draft, records }: { draft: Extract<ClientDraft, { kind: 'contact' }>; records: ClientRecordsAdapter }) {
  const { t } = useTranslation();
  const autosave = useClientAutosave({ draft, value: draft.value, records });
  return <div className="clients-save-state" aria-live="polite">
    <span role={autosave.status === 'error' ? 'alert' : 'status'}>{saveStatusLabel(autosave.status, t)}</span>
    {autosave.status === 'error' && <button type="button" className="clients-link-button" onClick={() => void autosave.retry()}>
      {t('clients.retry')}
    </button>}
  </div>;
}

function ContactEditor({
  draft,
  records,
  onClose,
}: {
  draft: Extract<ClientDraft, { kind: 'contact' }>;
  records: ClientRecordsAdapter;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const current = useClientDetailsStore((state) => state.drafts[draft.id]);
  const latest = current?.kind === 'contact' && current.editSessionId === draft.editSessionId ? current : draft;
  const change = (value: ContactDraftValue) => {
    useClientDetailsStore.getState().updateDraft({ id: latest.id, editSessionId: latest.editSessionId, value });
  };
  const fields: Array<{ key: keyof ContactDraftValue; label: string; type: string }> = [
    { key: 'name', label: t('clients.contactName'), type: 'text' },
    { key: 'role', label: t('clients.contactRole'), type: 'text' },
    { key: 'email', label: t('clients.contactEmail'), type: 'email' },
    { key: 'phone', label: t('clients.contactPhone'), type: 'tel' },
  ];

  return <form className="clients-editor-form" aria-label={t('clients.editContact')} onSubmit={(event) => event.preventDefault()}>
    {fields.map(({ key, label, type }) => <label key={key} className="clients-field">
      <span>{label}</span>
      <input type={type} value={latest.value[key]} onChange={(event) => change({ ...latest.value, [key]: event.currentTarget.value })} />
    </label>)}
    {latest.generation > 0 && <ContactAutosave draft={latest} records={records} />}
    <div className="clients-editor-actions">
      <button type="button" className="clients-button" onClick={onClose}>{t('clients.cancelKeepDraft')}</button>
    </div>
  </form>;
}

export function ClientContacts({ clientId, profile, contacts, contactDrafts, records,
  onProfileRevisionMutationStart, onProfileRevisionMutationSuccess, onProfileRevisionMutationFailure,
}: ClientContactsProps) {
  const { t } = useTranslation();
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClientContact | null>(null);
  const profileDraftId = clientDraftId(clientId, 'profile', clientId);
  const profileMutationPending = useClientDetailsStore((state) => Boolean(state.profileRevisionMutations[profileDraftId]));
  const selectedDraft = useClientDetailsStore((state) => editingDraftId ? state.drafts[editingDraftId] : undefined);

  const startNew = () => {
    const draft = useClientDetailsStore.getState().startEdit({
      kind: 'contact', clientId, baseRevision: null,
      value: { name: '', role: '', email: '', phone: '' },
    });
    setEditingDraftId(draft.id);
    setError(false);
  };

  const editContact = async (contact: ClientContact) => {
    const id = clientDraftId(clientId, 'contact', contact.id);
    const existing = await records.getDraft(id);
    if (!existing.ok) {
      setError(true);
      return;
    }
    const saved = existing.value?.kind === 'contact' ? existing.value : null;
    const draft = saved && useClientDetailsStore.getState().recoverDraft(saved)
      ? saved
      : useClientDetailsStore.getState().startEdit({
        kind: 'contact', clientId, recordId: contact.id, baseRevision: contact.revision,
        value: { name: contact.name, role: contact.role, email: contact.email, phone: contact.phone },
      });
    setEditingDraftId(draft.id);
    setError(false);
  };

  const setPrimary = async (contactId: string | null) => {
    const mutation = onProfileRevisionMutationStart(profile?.revision ?? null);
    if (!mutation) {
      setError(true);
      return;
    }
    const result = await records.setPrimaryContact({
      clientId, contactId, expectedProfileRevision: profile?.revision ?? null,
    });
    if (!result.ok) {
      onProfileRevisionMutationFailure(mutation, result.code);
      setError(true);
      return;
    }
    await onProfileRevisionMutationSuccess(mutation, result.value.revision);
    setError(false);
  };

  const deleteContact = async () => {
    if (!deleteTarget) return;
    const deletesPrimary = profile?.primaryContactId === deleteTarget.id;
    const mutation = deletesPrimary
      ? onProfileRevisionMutationStart(profile?.revision ?? null)
      : null;
    if (deletesPrimary && !mutation) {
      setError(true);
      return;
    }
    const result = await records.deleteContact({
      id: deleteTarget.id, clientId, expectedRevision: deleteTarget.revision,
    });
    if (!result.ok) {
      if (mutation) onProfileRevisionMutationFailure(mutation, result.code);
      setError(true);
      return;
    }
    if (mutation) {
      const profileResult = await records.getProfile(clientId);
      const expectedRevision = (mutation.baseRevision ?? 0) + 1;
      if (!profileResult.ok) {
        onProfileRevisionMutationFailure(mutation, profileResult.code);
        setError(true);
        return;
      }
      if (profileResult.value?.revision !== expectedRevision || profileResult.value.primaryContactId !== null) {
        onProfileRevisionMutationFailure(mutation, 'CONFLICT');
        setError(true);
        return;
      }
      await onProfileRevisionMutationSuccess(mutation, profileResult.value.revision);
    }
    setError(false);
    setDeleteTarget(null);
  };

  return <section className="clients-profile-section" aria-labelledby="clients-contacts-title">
    <div className="clients-profile-section-heading">
      <h2 id="clients-contacts-title">{t('clients.contacts')}</h2>
      <button type="button" className="clients-button" onClick={startNew}>{t('clients.addContact')}</button>
    </div>
    {error && <p className="clients-error" role="alert">{t('clients.saveFailed')}</p>}
    {contacts.length === 0 && <p className="clients-muted">{t('clients.noContacts')}</p>}
    <ul className="clients-contact-list">
      {contacts.map((contact) => <li key={contact.id} className="clients-contact-card">
        <div className="clients-contact-summary">
          <div>
            <strong>{contact.name}</strong>
            {contact.role && <span>{contact.role}</span>}
            {contact.email && <span>{contact.email}</span>}
            {contact.phone && <span>{contact.phone}</span>}
            {profile?.primaryContactId === contact.id && <span className="clients-primary-label">
              <Star size={13} aria-hidden="true" /> {t('clients.primaryContact')}
            </span>}
          </div>
          <div className="clients-contact-actions">
            {profile?.primaryContactId !== contact.id
              ? <button type="button" className="clients-icon-button" aria-label={`${t('clients.makePrimary')}: ${contact.name}`}
                disabled={profileMutationPending} onClick={() => void setPrimary(contact.id)}><Star size={15} aria-hidden="true" /></button>
              : <button type="button" className="clients-link-button" disabled={profileMutationPending} onClick={() => void setPrimary(null)}>
                {t('clients.clearPrimary')}
              </button>}
            <button type="button" className="clients-icon-button" aria-label={`${t('clients.editContact')}: ${contact.name}`}
              onClick={() => void editContact(contact)}><Pencil size={15} aria-hidden="true" /></button>
            <button type="button" className="clients-icon-button" aria-label={`${t('clients.deleteContact')}: ${contact.name}`}
              disabled={profileMutationPending} onClick={() => setDeleteTarget(contact)}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </li>)}
    </ul>
    {contactDrafts.filter((draft) => draft.kind === 'contact' && draft.id !== editingDraftId).map((draft) => draft.kind === 'contact'
      ? <button key={draft.id} type="button" className="clients-link-button clients-resume-draft"
        onClick={() => {
          useClientDetailsStore.getState().recoverDraft(draft);
          setEditingDraftId(draft.id);
        }}>
        {t('clients.resumeContactDraft', { name: draft.value.name || t('clients.addContact') })}
      </button> : null)}
    {selectedDraft?.kind === 'contact' && selectedDraft.clientId === clientId &&
      <ContactEditor key={selectedDraft.editSessionId} draft={selectedDraft} records={records}
        onClose={() => setEditingDraftId(null)} />}
    {deleteTarget && <div className="clients-confirm-overlay">
      <div className="clients-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clients-delete-contact-title">
        <p id="clients-delete-contact-title">{t('clients.deleteContactConfirm', { name: deleteTarget.name })}</p>
        <div className="clients-editor-actions">
          <button type="button" className="clients-button" onClick={() => setDeleteTarget(null)}>{t('clients.cancel')}</button>
          <button type="button" className="clients-button clients-button--danger" disabled={profileMutationPending}
            onClick={() => void deleteContact()}>{t('clients.delete')}</button>
        </div>
      </div>
    </div>}
  </section>;
}
