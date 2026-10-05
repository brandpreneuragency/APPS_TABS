import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { db } from '../services/db';
import { createClientRecords, clientDraftId } from '../services/clients/records';
import type { ClientDraft, ClientNote, ClientRecordResult } from '../types/clients';
import { useClientDetailsStore } from '../stores/clientDetailsStore';

export type ClientRecordsAdapter = ReturnType<typeof createClientRecords>;
const defaultRecords = createClientRecords(db);

function draftJobKey(draft: ClientDraft): string {
  return JSON.stringify([draft.id, draft.editSessionId, draft.generation]);
}

const serialQueues = new Map<string, Promise<void>>();
const autosaveJobs = new Map<string, Promise<void>>();
const cancelledDraftSessions = new Map<string, { attempts: Set<symbol>; succeeded: boolean }>();

function draftSessionKey(id: string, editSessionId: string): string {
  return JSON.stringify([id, editSessionId]);
}

function isDraftSessionCancelled(id: string, editSessionId: string): boolean {
  return cancelledDraftSessions.has(draftSessionKey(id, editSessionId));
}

function enqueueSerialized<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = serialQueues.get(id) ?? Promise.resolve();
  const pending = previous.then(operation, operation);
  const settled = pending.then(() => undefined, () => undefined);
  serialQueues.set(id, settled);
  void settled.then(() => {
    if (serialQueues.get(id) === settled) serialQueues.delete(id);
  });
  return pending;
}

function markFailure(draft: ClientDraft, result: Extract<ClientRecordResult<unknown>, { ok: false }>): void {
  useClientDetailsStore.getState().markError({
    id: draft.id,
    editSessionId: draft.editSessionId,
    generation: draft.generation,
    code: result.code,
    field: result.field,
  });
}

async function persistAutosave(draft: ClientDraft, records: ClientRecordsAdapter): Promise<void> {
  if (isDraftSessionCancelled(draft.id, draft.editSessionId)) return;
  const store = useClientDetailsStore.getState();
  const current = store.drafts[draft.id];
  if (!current || current.editSessionId !== draft.editSessionId || current.generation !== draft.generation) return;
  const saveState = store.saveStates[draft.id];
  if (saveState?.editSessionId === draft.editSessionId && saveState.generation === draft.generation
    && saveState.status === 'saved') return;

  store.markSaving(draft.id, draft.editSessionId, draft.generation);
  try {
    const durable = await records.saveDraft(current);
    if (!durable.ok) {
      markFailure(current, durable);
      return;
    }
    const savedDraft = durable.value;
    if (isDraftSessionCancelled(savedDraft.id, savedDraft.editSessionId)) return;
    if (savedDraft.baseRevision !== null) {
      useClientDetailsStore.getState().rebaseDraft(savedDraft.id, savedDraft.editSessionId,
        savedDraft.generation, savedDraft.baseRevision);
    }
    if (savedDraft.kind === 'note') {
      useClientDetailsStore.getState().markDraftSaved(savedDraft.id, savedDraft.editSessionId, savedDraft.generation);
      return;
    }

    const acknowledgement = {
      id: savedDraft.id,
      generation: savedDraft.generation,
      editSessionId: savedDraft.editSessionId,
    };
    if (isDraftSessionCancelled(savedDraft.id, savedDraft.editSessionId)) return;
    const result = savedDraft.kind === 'profile'
      ? await records.saveProfile({
        clientId: savedDraft.clientId,
        expectedRevision: savedDraft.baseRevision,
        value: savedDraft.value,
        draftAck: acknowledgement,
      })
      : await records.saveContact({
        id: savedDraft.recordId,
        clientId: savedDraft.clientId,
        expectedRevision: savedDraft.baseRevision,
        value: savedDraft.value,
        draftAck: acknowledgement,
      });
    if (isDraftSessionCancelled(savedDraft.id, savedDraft.editSessionId)) return;
    if (!result.ok) {
      markFailure(savedDraft, result);
      return;
    }
    useClientDetailsStore.getState().markSaved(savedDraft.id, savedDraft.editSessionId,
      savedDraft.generation, result.value.revision);
  } catch {
    if (isDraftSessionCancelled(current.id, current.editSessionId)) return;
    useClientDetailsStore.getState().markError({
      id: current.id,
      editSessionId: current.editSessionId,
      generation: current.generation,
      code: 'STORAGE',
    });
  }
}

function enqueueAutosave(draft: ClientDraft, records: ClientRecordsAdapter): Promise<void> {
  const jobKey = draftJobKey(draft);
  const existing = autosaveJobs.get(jobKey);
  if (existing) return existing;

  const pending = enqueueSerialized(draft.id, () => persistAutosave(draft, records));
  const settled = pending.then(() => undefined, () => undefined);
  autosaveJobs.set(jobKey, settled);
  void settled.then(() => {
    if (autosaveJobs.get(jobKey) === settled) autosaveJobs.delete(jobKey);
  });
  return settled;
}

function failedResult<T>(code: 'VALIDATION' | 'CONFLICT' | 'STORAGE', field?: string): ClientRecordResult<T> {
  return { ok: false, code, ...(field ? { field } : {}) };
}

function sameValue(left: ClientDraft['value'], right: ClientDraft['value']): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type UseClientAutosaveOptions = {
  [K in ClientDraft['kind']]: {
    draft: Extract<ClientDraft, { kind: K }>;
    value: Extract<ClientDraft, { kind: K }>['value'];
    records?: ClientRecordsAdapter;
  }
}[ClientDraft['kind']];

export function useClientAutosave({
  draft,
  value,
  records = defaultRecords,
}: UseClientAutosaveOptions) {
  const identity = useMemo(() => ({
    id: draft.id,
    clientId: draft.clientId,
    kind: draft.kind,
    recordId: draft.recordId,
    editSessionId: draft.editSessionId,
  }), [draft.id, draft.clientId, draft.kind, draft.recordId, draft.editSessionId]);
  const identityToken = JSON.stringify([identity.id, identity.editSessionId]);
  const valueToken = JSON.stringify(value);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeDraft = useClientDetailsStore((state) => state.drafts[identity.id]);
  const saveState = useClientDetailsStore((state) => state.saveStates[identity.id]);
  const currentDraft = activeDraft?.editSessionId === identity.editSessionId ? activeDraft : undefined;
  const status = saveState?.editSessionId === identity.editSessionId
    && saveState.generation === currentDraft?.generation
    ? saveState.status
    : 'idle';
  const errorCode = status === 'error' ? saveState?.code : undefined;
  const field = status === 'error' ? saveState?.field : undefined;

  useLayoutEffect(() => {
    const current = useClientDetailsStore.getState().drafts[identity.id];
    if (!current || current.editSessionId !== identity.editSessionId || sameValue(current.value, value)) return;
    useClientDetailsStore.getState().updateDraft({
      id: identity.id,
      editSessionId: identity.editSessionId,
      value,
    });
  }, [identityToken, identity.id, identity.editSessionId, valueToken, value]);

  useLayoutEffect(() => {
    const timerMap = timers.current;
    return () => {
      const timer = timerMap.get(identityToken);
      if (timer !== undefined) {
        clearTimeout(timer);
        timerMap.delete(identityToken);
      }
      const latest = useClientDetailsStore.getState().drafts[identity.id];
      if (latest && latest.editSessionId === identity.editSessionId) {
        void enqueueAutosave(latest, records);
      }
    };
  }, [identityToken, identity.id, identity.editSessionId, records]);

  useEffect(() => {
    if (!currentDraft || status !== 'idle') return;
    const timerMap = timers.current;
    const timer = setTimeout(() => {
      timerMap.delete(identityToken);
      void enqueueAutosave(currentDraft, records);
    }, 400);
    timerMap.set(identityToken, timer);
    return () => {
      clearTimeout(timer);
      if (timerMap.get(identityToken) === timer) timerMap.delete(identityToken);
    };
  }, [identityToken, currentDraft, status, records]);

  const retry = useCallback((): Promise<void> => {
    const latest = useClientDetailsStore.getState().drafts[identity.id];
    if (!latest || latest.editSessionId !== identity.editSessionId) return Promise.resolve();
    return enqueueAutosave(latest, records);
  }, [identity.id, identity.editSessionId, records]);

  const saveNote = useCallback(async (): Promise<ClientRecordResult<ClientNote>> => {
    if (identity.kind !== 'note') return failedResult('VALIDATION', 'kind');
    return enqueueSerialized(identity.id, async () => {
      if (isDraftSessionCancelled(identity.id, identity.editSessionId)) return failedResult('CONFLICT');
      const current = useClientDetailsStore.getState().drafts[identity.id];
      if (!current || current.editSessionId !== identity.editSessionId || current.kind !== 'note') {
        return failedResult('CONFLICT');
      }
      useClientDetailsStore.getState().markSaving(current.id, current.editSessionId, current.generation);
      try {
        const durable = await records.saveDraft(current);
        if (!durable.ok) {
          markFailure(current, durable);
          return durable;
        }
        const savedDraft = durable.value;
        if (savedDraft.kind !== 'note') return failedResult('CONFLICT');
        if (isDraftSessionCancelled(savedDraft.id, savedDraft.editSessionId)) return failedResult('CONFLICT');
        const result = await records.saveNote({
          id: savedDraft.recordId,
          clientId: savedDraft.clientId,
          expectedRevision: savedDraft.baseRevision,
          value: savedDraft.value,
          draftId: savedDraft.id,
          generation: savedDraft.generation,
          editSessionId: savedDraft.editSessionId,
        });
        if (isDraftSessionCancelled(savedDraft.id, savedDraft.editSessionId)) {
          return failedResult('CONFLICT');
        }
        if (!result.ok) {
          markFailure(savedDraft, result);
          return result;
        }
        useClientDetailsStore.getState().markSaved(savedDraft.id, savedDraft.editSessionId,
          savedDraft.generation, result.value.revision);
        return result;
      } catch {
        useClientDetailsStore.getState().markError({
          id: current.id,
          editSessionId: current.editSessionId,
          generation: current.generation,
          code: 'STORAGE',
        });
        return failedResult('STORAGE');
      }
    });
  }, [identity.id, identity.editSessionId, identity.kind, records]);

  const discardDraft = useCallback(async (): Promise<ClientRecordResult<void>> => {
    const current = useClientDetailsStore.getState().drafts[identity.id];
    if (!current || current.editSessionId !== identity.editSessionId) return failedResult('CONFLICT');
    const cancellationKey = draftSessionKey(current.id, current.editSessionId);
    const cancellation = cancelledDraftSessions.get(cancellationKey)
      ?? { attempts: new Set<symbol>(), succeeded: false };
    const attempt = Symbol();
    cancellation.attempts.add(attempt);
    cancelledDraftSessions.set(cancellationKey, cancellation);
    const timer = timers.current.get(identityToken);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(identityToken);
    }
    try {
      const result = await records.discardDraft({
        id: current.id,
        editSessionId: current.editSessionId,
        generation: current.generation,
      });
      if (result.ok) {
        cancellation.succeeded = true;
        useClientDetailsStore.getState().clearDraft(current.id, current.editSessionId, current.generation);
      } else {
        markFailure(current, result);
      }
      return result;
    } finally {
      cancellation.attempts.delete(attempt);
      if (!cancellation.succeeded && cancellation.attempts.size === 0
        && cancelledDraftSessions.get(cancellationKey) === cancellation) {
        cancelledDraftSessions.delete(cancellationKey);
      }
    }
  }, [identity.id, identity.editSessionId, identityToken, records]);

  return {
    draft: currentDraft,
    status,
    errorCode,
    field,
    retry,
    saveNote,
    discardDraft,
    draftId: identity.id,
    recordId: identity.recordId,
    editSessionId: identity.editSessionId,
    clientId: identity.clientId,
    key: clientDraftId(identity.clientId, identity.kind, identity.recordId),
  };
}
