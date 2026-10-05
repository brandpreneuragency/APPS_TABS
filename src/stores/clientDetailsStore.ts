import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  ClientDraft,
  ClientNote,
  ClientRecordErrorCode,
  ContactDraftValue,
  NoteDraftValue,
  ProfileDraftValue,
} from '../types/clients';
import { clientDraftId } from '../services/clients/records';

export type ClientDraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ClientCategory = 'overview' | 'profile' | 'notes';

export interface ClientDraftSaveState {
  editSessionId: string;
  generation: number;
  status: ClientDraftSaveStatus;
  code?: ClientRecordErrorCode;
  field?: string;
}

export interface ClientProfileRevisionMutation {
  id: string;
  clientId: string;
  mutationId: string;
  editSessionId: string | null;
  generation: number | null;
  baseRevision: number | null;
}

type StartClientEditInput = (
  | { kind: 'profile'; clientId: string; recordId?: string; baseRevision: number | null; value: ProfileDraftValue }
  | { kind: 'contact'; clientId: string; recordId?: string; baseRevision: number | null; value: ContactDraftValue }
  | { kind: 'note'; clientId: string; recordId?: string; baseRevision: number | null; value: NoteDraftValue }
);

interface ClientDetailsState {
  category: ClientCategory;
  drafts: Record<string, ClientDraft>;
  saveStates: Record<string, ClientDraftSaveState>;
  profileRevisionMutations: Record<string, ClientProfileRevisionMutation>;
  setCategory: (category: ClientCategory) => void;
  startEdit: (input: StartClientEditInput) => ClientDraft;
  updateDraft: (input: {
    id: string;
    editSessionId: string;
    value: ProfileDraftValue | ContactDraftValue | NoteDraftValue;
  }) => ClientDraft | null;
  recoverDraft: (draft: ClientDraft) => boolean;
  beginProfileRevisionMutation: (clientId: string, baseRevision: number | null) => ClientProfileRevisionMutation | null;
  completeProfileRevisionMutation: (
    mutation: ClientProfileRevisionMutation,
    result: { revision: number | null } | { error: ClientRecordErrorCode },
  ) => Extract<ClientDraft, { kind: 'profile' }> | null;
  finishProfileRevisionMutation: (mutation: ClientProfileRevisionMutation) => void;
  failProfileRevisionMutation: (mutation: ClientProfileRevisionMutation, code: ClientRecordErrorCode) => void;
  resolveProfileConflict: (input: {
    id: string;
    editSessionId: string;
    generation: number;
    expectedBaseRevision: number | null;
    baseRevision: number | null;
  }) => boolean;
  markSaving: (id: string, editSessionId: string, generation: number) => void;
  markDraftSaved: (id: string, editSessionId: string, generation: number) => void;
  rebaseDraft: (id: string, editSessionId: string, generation: number, revision: number) => void;
  markSaved: (id: string, editSessionId: string, generation: number, revision: number) => void;
  markError: (input: {
    id: string;
    editSessionId: string;
    generation: number;
    code: ClientRecordErrorCode;
    field?: string;
  }) => void;
  clearDraft: (id: string, editSessionId: string, generation: number) => void;
  markNotePublished: (id: string, editSessionId: string, generation: number, note: ClientNote) => void;
}

function cloneDraft(draft: ClientDraft): ClientDraft {
  if (draft.kind === 'profile') return { ...draft, value: { ...draft.value } };
  if (draft.kind === 'contact') return { ...draft, value: { ...draft.value } };
  return { ...draft, value: { ...draft.value } };
}

function isProfileValue(value: ProfileDraftValue | ContactDraftValue | NoteDraftValue): value is ProfileDraftValue {
  return typeof value === 'object' && value !== null
    && 'website' in value && typeof value.website === 'string'
    && 'description' in value && typeof value.description === 'string';
}

function isContactValue(value: ProfileDraftValue | ContactDraftValue | NoteDraftValue): value is ContactDraftValue {
  return typeof value === 'object' && value !== null
    && 'name' in value && typeof value.name === 'string'
    && 'role' in value && typeof value.role === 'string'
    && 'email' in value && typeof value.email === 'string'
    && 'phone' in value && typeof value.phone === 'string';
}

function isNoteValue(value: ProfileDraftValue | ContactDraftValue | NoteDraftValue): value is NoteDraftValue {
  return typeof value === 'object' && value !== null
    && 'title' in value && typeof value.title === 'string'
    && 'bodyText' in value && typeof value.bodyText === 'string'
    && 'kind' in value && (value.kind === 'call' || value.kind === 'meeting'
      || value.kind === 'decision' || value.kind === 'note')
    && 'occurredAt' in value && typeof value.occurredAt === 'number'
    && 'contactId' in value && (typeof value.contactId === 'string' || value.contactId === null);
}

function canRecoverDraft(draft: ClientDraft): boolean {
  if (typeof draft !== 'object' || draft === null
    || typeof draft.id !== 'string' || typeof draft.clientId !== 'string' || !draft.clientId
    || typeof draft.recordId !== 'string' || !draft.recordId
    || (draft.kind !== 'profile' && draft.kind !== 'contact' && draft.kind !== 'note')
    || typeof draft.editSessionId !== 'string' || !draft.editSessionId
    || !Number.isSafeInteger(draft.generation) || draft.generation < 0
    || (draft.baseRevision !== null
      && (!Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 1))) return false;
  if (draft.kind === 'profile' && draft.recordId !== draft.clientId) return false;
  return draft.id === clientDraftId(draft.clientId, draft.kind, draft.recordId);
}

export const useClientDetailsStore = create<ClientDetailsState>((set, get) => ({
  category: 'overview',
  drafts: {},
  saveStates: {},
  profileRevisionMutations: {},
  setCategory: (category) => set({ category }),

  startEdit: (input) => {
    const recordId = input.kind === 'profile' ? input.clientId : input.recordId ?? nanoid();
    const id = clientDraftId(input.clientId, input.kind, recordId);
    const existing = get().drafts[id];
    if (existing) return cloneDraft(existing);

    const draft: ClientDraft = input.kind === 'profile'
      ? { id, clientId: input.clientId, kind: 'profile', recordId, editSessionId: nanoid(),
        generation: 0, baseRevision: input.baseRevision, updatedAt: Date.now(), value: { ...input.value } }
      : input.kind === 'contact'
        ? { id, clientId: input.clientId, kind: 'contact', recordId, editSessionId: nanoid(),
          generation: 0, baseRevision: input.baseRevision, updatedAt: Date.now(), value: { ...input.value } }
        : { id, clientId: input.clientId, kind: 'note', recordId, editSessionId: nanoid(),
          generation: 0, baseRevision: input.baseRevision, updatedAt: Date.now(), value: { ...input.value } };
    set((state) => ({
      drafts: { ...state.drafts, [id]: draft },
      saveStates: { ...state.saveStates, [id]: {
        editSessionId: draft.editSessionId, generation: draft.generation, status: 'idle',
      } },
    }));
    return cloneDraft(draft);
  },

  updateDraft: ({ id, editSessionId, value }) => {
    const current = get().drafts[id];
    if (!current || current.editSessionId !== editSessionId
      || !Number.isSafeInteger(current.generation) || current.generation >= Number.MAX_SAFE_INTEGER) return null;
    if (current.kind === 'profile' && isProfileValue(value)) {
      const next: Extract<ClientDraft, { kind: 'profile' }> = {
        ...current, generation: current.generation + 1, updatedAt: Date.now(), value: { ...value },
      };
      const revisionMutation = get().profileRevisionMutations[id];
      set((state) => ({
        drafts: { ...state.drafts, [id]: next },
        saveStates: { ...state.saveStates, [id]: {
          editSessionId, generation: next.generation, status: revisionMutation?.editSessionId === editSessionId
            ? 'saved' : 'idle',
        } },
      }));
      return cloneDraft(next);
    }
    if (current.kind === 'contact' && isContactValue(value)) {
      const next: Extract<ClientDraft, { kind: 'contact' }> = {
        ...current, generation: current.generation + 1, updatedAt: Date.now(), value: { ...value },
      };
      set((state) => ({
        drafts: { ...state.drafts, [id]: next },
        saveStates: { ...state.saveStates, [id]: { editSessionId, generation: next.generation, status: 'idle' } },
      }));
      return cloneDraft(next);
    }
    if (current.kind === 'note' && isNoteValue(value)) {
      const next: Extract<ClientDraft, { kind: 'note' }> = {
        ...current, generation: current.generation + 1, updatedAt: Date.now(), value: { ...value },
      };
      set((state) => ({
        drafts: { ...state.drafts, [id]: next },
        saveStates: { ...state.saveStates, [id]: { editSessionId, generation: next.generation, status: 'idle' } },
      }));
      return cloneDraft(next);
    }
    return null;
  },

  recoverDraft: (draft) => {
    if (!canRecoverDraft(draft)) return false;
    const current = get().drafts[draft.id];
    const currentSave = get().saveStates[draft.id];
    if (current && currentSave?.editSessionId === current.editSessionId
      && currentSave.status === 'saving') return false;
    const recovered = cloneDraft(draft);
    set((state) => ({
      drafts: { ...state.drafts, [draft.id]: recovered },
      saveStates: { ...state.saveStates, [draft.id]: {
        editSessionId: draft.editSessionId, generation: draft.generation,
        // Durable profile/contact drafts still need canonical commit; notes need explicit publication.
        status: draft.kind === 'note' ? 'saved' : 'idle',
      } },
    }));
    return true;
  },

  beginProfileRevisionMutation: (clientId, baseRevision) => {
    if (typeof clientId !== 'string' || !clientId
      || (baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 1))) return null;
    const id = clientDraftId(clientId, 'profile', clientId);
    const state = get();
    if (state.profileRevisionMutations[id]) return null;
    const current = state.drafts[id];
    let editSessionId: string | null = null;
    let generation: number | null = null;
    if (current) {
      if (current.kind !== 'profile' || current.clientId !== clientId || current.baseRevision !== baseRevision) return null;
      const save = state.saveStates[id];
      const isUntouched = current.generation === 0
        && save?.editSessionId === current.editSessionId && save.generation === 0 && save.status === 'idle';
      const isSaved = save?.editSessionId === current.editSessionId
        && save.generation === current.generation && save.status === 'saved';
      if (!isUntouched && !isSaved) return null;
      editSessionId = current.editSessionId;
      generation = current.generation;
    }
    const mutation: ClientProfileRevisionMutation = {
      id, clientId, mutationId: nanoid(), editSessionId, generation, baseRevision,
    };
    set((currentState) => ({
      profileRevisionMutations: { ...currentState.profileRevisionMutations, [id]: mutation },
    }));
    return mutation;
  },

  completeProfileRevisionMutation: (mutation, result) => {
    const active = get().profileRevisionMutations[mutation.id];
    if (!active || active.mutationId !== mutation.mutationId) return null;
    const current = get().drafts[mutation.id];
    if ('error' in result) {
      get().failProfileRevisionMutation(mutation, result.error);
      return null;
    }
    if (result.revision !== null && (!Number.isSafeInteger(result.revision) || result.revision < 1)) {
      get().failProfileRevisionMutation(mutation, 'STORAGE');
      return null;
    }
    if (mutation.baseRevision !== null && result.revision === null) {
      get().failProfileRevisionMutation(mutation, 'CONFLICT');
      return null;
    }
    if (!current || current.kind !== 'profile' || current.editSessionId !== mutation.editSessionId
      || current.baseRevision !== mutation.baseRevision || current.generation < (mutation.generation ?? 0)) {
      get().finishProfileRevisionMutation(mutation);
      return null;
    }
    const rebased: Extract<ClientDraft, { kind: 'profile' }> = { ...current, baseRevision: result.revision };
    if (mutation.generation !== null && current.generation > mutation.generation) {
      set((state) => ({
        drafts: { ...state.drafts, [mutation.id]: rebased },
        saveStates: { ...state.saveStates, [mutation.id]: {
          editSessionId: current.editSessionId, generation: current.generation, status: 'saved',
        } },
      }));
      return cloneDraft(rebased) as Extract<ClientDraft, { kind: 'profile' }>;
    }
    set((state) => {
      const profileRevisionMutations = { ...state.profileRevisionMutations };
      delete profileRevisionMutations[mutation.id];
      return {
        drafts: { ...state.drafts, [mutation.id]: rebased },
        profileRevisionMutations,
        saveStates: { ...state.saveStates, [mutation.id]: {
          editSessionId: current.editSessionId, generation: current.generation,
          status: current.generation === 0 ? 'idle' : 'saved',
        } },
      };
    });
    return null;
  },

  finishProfileRevisionMutation: (mutation) => set((state) => {
    const active = state.profileRevisionMutations[mutation.id];
    if (!active || active.mutationId !== mutation.mutationId) return state;
    const profileRevisionMutations = { ...state.profileRevisionMutations };
    delete profileRevisionMutations[mutation.id];
    return { profileRevisionMutations };
  }),

  failProfileRevisionMutation: (mutation, code) => set((state) => {
    const active = state.profileRevisionMutations[mutation.id];
    if (!active || active.mutationId !== mutation.mutationId) return state;
    const profileRevisionMutations = { ...state.profileRevisionMutations };
    delete profileRevisionMutations[mutation.id];
    const current = state.drafts[mutation.id];
    if (!current || current.kind !== 'profile' || current.editSessionId !== mutation.editSessionId) {
      return { profileRevisionMutations };
    }
    return {
      profileRevisionMutations,
      saveStates: { ...state.saveStates, [mutation.id]: {
        editSessionId: current.editSessionId, generation: current.generation, status: 'error', code,
      } },
    };
  }),

  resolveProfileConflict: ({ id, editSessionId, generation, expectedBaseRevision, baseRevision }) => {
    const current = get().drafts[id];
    if (!current || current.kind !== 'profile' || current.editSessionId !== editSessionId
      || current.generation < generation || current.baseRevision !== expectedBaseRevision
      || get().profileRevisionMutations[id]
      || (baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 1))) return false;
    const updated: Extract<ClientDraft, { kind: 'profile' }> = { ...current, baseRevision };
    set((state) => ({
      drafts: { ...state.drafts, [id]: updated },
      saveStates: { ...state.saveStates, [id]: {
        editSessionId: current.editSessionId, generation: current.generation, status: 'idle',
      } },
    }));
    return true;
  },

  markSaving: (id, editSessionId, generation) => set((state) => {
    const draft = state.drafts[id];
    if (!draft || draft.editSessionId !== editSessionId || draft.generation !== generation) return state;
    return { saveStates: { ...state.saveStates, [id]: { editSessionId, generation, status: 'saving' } } };
  }),

  markDraftSaved: (id, editSessionId, generation) => set((state) => {
    const draft = state.drafts[id];
    if (!draft || draft.editSessionId !== editSessionId || draft.generation !== generation) return state;
    return { saveStates: { ...state.saveStates, [id]: { editSessionId, generation, status: 'saved' } } };
  }),

  rebaseDraft: (id, editSessionId, generation, revision) => set((state) => {
    const draft = state.drafts[id];
    if (!draft || draft.editSessionId !== editSessionId || draft.generation < generation
      || !Number.isSafeInteger(revision) || revision < 1) return state;
    return { drafts: { ...state.drafts, [id]: { ...draft, baseRevision: revision } } };
  }),

  markSaved: (id, editSessionId, generation, revision) => set((state) => {
    const draft = state.drafts[id];
    if (!draft || draft.editSessionId !== editSessionId || draft.generation < generation
      || !Number.isSafeInteger(revision) || revision < 1) return state;
    const rebased = { ...draft, baseRevision: revision };
    if (draft.generation !== generation) return { drafts: { ...state.drafts, [id]: rebased } };
    return {
      drafts: { ...state.drafts, [id]: rebased },
      saveStates: { ...state.saveStates, [id]: { editSessionId, generation, status: 'saved' } },
    };
  }),

  markError: ({ id, editSessionId, generation, code, field }) => set((state) => {
    const draft = state.drafts[id];
    if (!draft || draft.editSessionId !== editSessionId || draft.generation !== generation) return state;
    return { saveStates: { ...state.saveStates, [id]: {
      editSessionId, generation, status: 'error', code, ...(field ? { field } : {}),
    } } };
  }),

  clearDraft: (id, editSessionId, generation) => set((state) => {
    const draft = state.drafts[id];
    if (!draft || draft.editSessionId !== editSessionId || draft.generation !== generation) return state;
    const drafts = { ...state.drafts };
    const saveStates = { ...state.saveStates };
    delete drafts[id];
    delete saveStates[id];
    return { drafts, saveStates };
  }),

  markNotePublished: (id, editSessionId, generation, note) => {
    get().markSaved(id, editSessionId, generation, note.revision);
  },
}));
