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

export interface ClientDraftSaveState {
  editSessionId: string;
  generation: number;
  status: ClientDraftSaveStatus;
  code?: ClientRecordErrorCode;
  field?: string;
}

type StartClientEditInput = (
  | { kind: 'profile'; clientId: string; recordId?: string; baseRevision: number | null; value: ProfileDraftValue }
  | { kind: 'contact'; clientId: string; recordId?: string; baseRevision: number | null; value: ContactDraftValue }
  | { kind: 'note'; clientId: string; recordId?: string; baseRevision: number | null; value: NoteDraftValue }
);

interface ClientDetailsState {
  drafts: Record<string, ClientDraft>;
  saveStates: Record<string, ClientDraftSaveState>;
  startEdit: (input: StartClientEditInput) => ClientDraft;
  updateDraft: (input: {
    id: string;
    editSessionId: string;
    value: ProfileDraftValue | ContactDraftValue | NoteDraftValue;
  }) => ClientDraft | null;
  recoverDraft: (draft: ClientDraft) => boolean;
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
  drafts: {},
  saveStates: {},

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
      set((state) => ({
        drafts: { ...state.drafts, [id]: next },
        saveStates: { ...state.saveStates, [id]: { editSessionId, generation: next.generation, status: 'idle' } },
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
        editSessionId: draft.editSessionId, generation: draft.generation, status: 'saved',
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
