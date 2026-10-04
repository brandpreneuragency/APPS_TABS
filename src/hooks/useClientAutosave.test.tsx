// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ClientDraft, ContactDraftValue, NoteDraftValue, ProfileDraftValue } from '../types/clients';
import { cleanupRecordsFixtures, createRecordsFixture } from '../services/clients/recordsTestFixtures';
import { useClientDetailsStore } from '../stores/clientDetailsStore';
import { useClientAutosave } from './useClientAutosave';

const profileValue = (description: string, website = 'https://example.test'): ProfileDraftValue => ({
  website, description,
});
const noteValue: NoteDraftValue = {
  title: 'Unpublished', bodyText: 'Last keystroke', kind: 'note', occurredAt: 1_000, contactId: null,
};

function startProfileDraft(clientId: string, value: ProfileDraftValue): Extract<ClientDraft, { kind: 'profile' }> {
  const draft = useClientDetailsStore.getState().startEdit({ clientId, kind: 'profile', baseRevision: null, value });
  if (draft.kind !== 'profile') throw new Error('Expected a profile draft');
  return draft;
}

function startContactDraft(
  clientId: string,
  recordId: string,
  baseRevision: number | null,
  value: ContactDraftValue,
): Extract<ClientDraft, { kind: 'contact' }> {
  const draft = useClientDetailsStore.getState().startEdit({
    clientId, kind: 'contact', recordId, baseRevision, value,
  });
  if (draft.kind !== 'contact') throw new Error('Expected a contact draft');
  return draft;
}

function startNoteDraft(recordId: string, value: NoteDraftValue = noteValue): Extract<ClientDraft, { kind: 'note' }> {
  const draft = useClientDetailsStore.getState().startEdit({ clientId: 'client-a', kind: 'note',
    recordId, baseRevision: null, value });
  if (draft.kind !== 'note') throw new Error('Expected a note draft');
  return draft;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useClientDetailsStore.setState({ drafts: {}, saveStates: {} });
  await cleanupRecordsFixtures();
});

describe('useClientAutosave', () => {
  it('waits 400 ms, persists the draft first, and marks a valid profile saved after record commit', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const draft = startProfileDraft('client-a', profileValue('Local profile'));
    const order: string[] = [];
    const saveDraft = records.saveDraft;
    const saveProfile = records.saveProfile;
    vi.spyOn(records, 'saveDraft').mockImplementation(async (input) => {
      order.push('draft');
      return saveDraft(input);
    });
    vi.spyOn(records, 'saveProfile').mockImplementation(async (input) => {
      const durable = await database.clientDrafts.get(draft.id);
      expect(durable).toMatchObject({ generation: draft.generation, value: profileValue('Local profile') });
      order.push('record');
      return saveProfile(input);
    });

    const { result } = renderHook(() => useClientAutosave({ draft, value: draft.value, records }));
    act(() => { vi.advanceTimersByTime(399); });
    expect(order).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });

    expect(order).toEqual(['draft', 'record']);
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      website: 'https://example.test', description: 'Local profile', revision: 2,
    });
    expect(result.current.status).toBe('saved');
  });

  it('keeps invalid profile text durable without changing the canonical profile values', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const draft = startProfileDraft('client-a', profileValue('Invalid website', 'javascript:alert(1)'));
    const { result } = renderHook(() => useClientAutosave({ draft, value: draft.value, records }));

    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });

    expect(await database.clientDrafts.get(draft.id)).toMatchObject({
      value: profileValue('Invalid website', 'javascript:alert(1)'),
    });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      website: '', description: '', revision: 1,
    });
    expect(result.current).toMatchObject({ status: 'error', errorCode: 'VALIDATION', field: 'website' });
  });

  it('rebases and saves a newer profile edit after an older generation finishes', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const firstValue = profileValue('Generation one');
    const newerValue = profileValue('Generation two');
    const draft = startProfileDraft('client-a', firstValue);
    const enteredFirstCommit = deferred();
    const releaseFirstCommit = deferred();
    const originalSaveProfile = records.saveProfile;
    let firstCall = true;
    vi.spyOn(records, 'saveProfile').mockImplementation(async (input) => {
      if (firstCall) {
        firstCall = false;
        enteredFirstCommit.resolve();
        await releaseFirstCommit.promise;
      }
      return originalSaveProfile(input);
    });
    const { result, rerender } = renderHook(({ value }: { value: ProfileDraftValue }) =>
      useClientAutosave({ draft, value, records }), { initialProps: { value: firstValue } });

    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    let olderSave!: Promise<void>;
    await act(async () => { olderSave = result.current.retry(); });
    await enteredFirstCommit.promise;
    rerender({ value: newerValue });
    let newerSave!: Promise<void>;
    await act(async () => { newerSave = result.current.retry(); });
    releaseFirstCommit.resolve();
    await act(async () => { await Promise.all([newerSave, olderSave]); });

    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      description: 'Generation two', revision: 3,
    });
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
    expect(useClientDetailsStore.getState().saveStates[draft.id]).toMatchObject({
      editSessionId: draft.editSessionId, generation: 1, status: 'saved',
    });
  });

  it('retries a failed draft write without dropping the edit', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const draft = startProfileDraft('client-a', profileValue('Retry after quota recovery'));
    const write = vi.spyOn(records, 'saveDraft')
      .mockImplementationOnce(async () => ({ ok: false, code: 'STORAGE' }));
    const { result } = renderHook(() => useClientAutosave({ draft, value: draft.value, records }));

    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ status: 'error', errorCode: 'STORAGE' });
    expect(useClientDetailsStore.getState().drafts[draft.id]).toMatchObject({
      editSessionId: draft.editSessionId, value: profileValue('Retry after quota recovery'),
    });

    await act(async () => { await result.current.retry(); });
    expect(write).toHaveBeenCalledTimes(2);
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      description: 'Retry after quota recovery', revision: 2,
    });
    expect(result.current.status).toBe('saved');
  });

  it('keeps invalid contact text durable without changing the canonical contact', async () => {
    const { database, records } = await createRecordsFixture();
    const canonicalValue: ContactDraftValue = {
      name: 'Ada Lovelace', role: 'Analyst', email: 'ada@example.test', phone: '',
    };
    const savedContact = await records.saveContact({
      id: 'contact-a', clientId: 'client-a', expectedRevision: null, value: canonicalValue,
    });
    if (!savedContact.ok) throw new Error(`Could not seed contact: ${savedContact.code}`);

    vi.useFakeTimers();
    const draftValue = { ...canonicalValue, name: ' ', email: 'invalid' };
    const draft = startContactDraft('client-a', 'contact-a', savedContact.value.revision, draftValue);
    const { result } = renderHook(() => useClientAutosave({ draft, value: draft.value, records }));
    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });

    expect(await database.clientDrafts.get(draft.id)).toMatchObject({ value: draftValue });
    expect(await database.clientContacts.get('contact-a')).toMatchObject({
      revision: 1, name: 'Ada Lovelace', role: 'Analyst', email: 'ada@example.test',
    });
    expect(result.current).toMatchObject({ status: 'error', errorCode: 'VALIDATION', field: 'name' });
  });

  it('keeps a newly recovered session when an older deferred profile save returns', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const draftA = startProfileDraft('client-a', profileValue('Old session value'));
    const enteredSave = deferred();
    const releaseSave = deferred();
    const saveProfile = records.saveProfile;
    vi.spyOn(records, 'saveProfile').mockImplementation(async (input) => {
      enteredSave.resolve();
      await releaseSave.promise;
      return saveProfile(input);
    });
    const { result } = renderHook(() => useClientAutosave({ draft: draftA, value: draftA.value, records }));

    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    let oldCompletion!: Promise<void>;
    await act(async () => {
      oldCompletion = result.current.retry();
      await enteredSave.promise;
    });

    const stored = await records.getDraft(draftA.id);
    if (!stored.ok || !stored.value || stored.value.kind !== 'profile') {
      throw new Error('Could not read the profile draft before discard');
    }

    let discarded!: Awaited<ReturnType<typeof result.current.discardDraft>>;
    await act(async () => { discarded = await result.current.discardDraft(); });
    expect(discarded).toMatchObject({ ok: true });
    const recoveredDraft = {
      ...stored.value,
      editSessionId: 'session-b',
      generation: 0,
      updatedAt: 9_000,
      value: profileValue('Recovered session value'),
    };
    const durable = await records.saveDraft(recoveredDraft);
    if (!durable.ok) throw new Error(`Could not persist recovered draft: ${durable.code}`);
    let recovered = false;
    act(() => { recovered = useClientDetailsStore.getState().recoverDraft(durable.value); });
    expect(recovered).toBe(true);

    releaseSave.resolve();
    await act(async () => { await oldCompletion; });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ revision: 1, description: '' });
    expect(await database.clientDrafts.get(draftA.id)).toMatchObject({
      editSessionId: 'session-b', generation: 0, value: { description: 'Recovered session value' },
    });
    expect(useClientDetailsStore.getState().drafts[draftA.id]).toMatchObject({
      editSessionId: 'session-b', value: { description: 'Recovered session value' },
    });
    expect(useClientDetailsStore.getState().saveStates[draftA.id]).toMatchObject({
      editSessionId: 'session-b', status: 'saved',
    });
  });

  it('captures client A across a switch and never writes A as client B', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const draftA = startProfileDraft('client-a', profileValue('Brand A'));
    const draftB = startProfileDraft('client-b', profileValue('Brand B'));
    const enteredA = deferred();
    const releaseA = deferred();
    const originalSaveProfile = records.saveProfile;
    const clientIds: string[] = [];
    vi.spyOn(records, 'saveProfile').mockImplementation(async (input) => {
      clientIds.push(input.clientId);
      if (input.clientId === 'client-a') {
        enteredA.resolve();
        await releaseA.promise;
      }
      return originalSaveProfile(input);
    });
    const { result, rerender } = renderHook(({ draft, value }: {
      draft: typeof draftA;
      value: ProfileDraftValue;
    }) => useClientAutosave({ draft, value, records }), {
      initialProps: { draft: draftA, value: draftA.value },
    });

    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    let completionA!: Promise<void>;
    await act(async () => { completionA = result.current.retry(); });
    await enteredA.promise;
    rerender({ draft: draftB, value: draftB.value });
    await act(async () => { await result.current.retry(); });
    expect(await database.clientProfiles.get('client-b')).toMatchObject({ description: 'Brand B' });

    releaseA.resolve();
    await act(async () => { await completionA; });
    expect(clientIds).toEqual(['client-a', 'client-b']);
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ description: 'Brand A' });
    expect(await database.clientProfiles.get('client-b')).toMatchObject({ description: 'Brand B' });
    expect(useClientDetailsStore.getState().saveStates[draftB.id]).toMatchObject({
      editSessionId: draftB.editSessionId, status: 'saved',
    });
  });

  it('flushes the latest draft on unmount before the debounce expires', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const initialValue: NoteDraftValue = { ...noteValue, bodyText: 'First typed text' };
    const draft = startNoteDraft('note-unmount', initialValue);
    const persisted = deferred();
    const originalSaveDraft = records.saveDraft;
    vi.spyOn(records, 'saveDraft').mockImplementation(async (input) => {
      const result = await originalSaveDraft(input);
      persisted.resolve();
      return result;
    });
    const { unmount, rerender } = renderHook(({ value }: { value: NoteDraftValue }) =>
      useClientAutosave({ draft, value, records }), { initialProps: { value: initialValue } });
    rerender({ value: noteValue });
    act(() => { vi.advanceTimersByTime(100); });
    unmount();
    vi.useRealTimers();
    await persisted.promise;

    expect(await database.clientDrafts.get(draft.id)).toMatchObject({
      value: { bodyText: 'Last keystroke' }, editSessionId: draft.editSessionId, generation: 1,
    });
    expect(await database.clientNotes.get('note-unmount')).toBeUndefined();
  });

  it('keeps notes as durable drafts until the explicit Save action', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const draft = startNoteDraft('note-explicit', {
      title: 'Call', bodyText: 'Discuss next steps', kind: 'call', occurredAt: 1_000, contactId: null,
    });
    const { result } = renderHook(() => useClientAutosave({ draft, value: draft.value, records }));
    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });
    expect(await database.clientDrafts.get(draft.id)).toBeDefined();
    expect(await database.clientNotes.get('note-explicit')).toBeUndefined();

    let published!: boolean;
    await act(async () => {
      const saved = await result.current.saveNote();
      published = saved.ok;
    });
    expect(published).toBe(true);
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
    expect(await database.clientNotes.get('note-explicit')).toMatchObject({
      id: 'note-explicit', title: 'Call', bodyText: 'Discuss next steps', revision: 1,
    });
  });
});
