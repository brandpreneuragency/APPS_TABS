// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ClientDraft, ContactDraftValue, NoteDraftValue, ProfileDraftValue } from '../types/clients';
import { cleanupRecordsFixtures, createRecordsFixture, reopenRecordsDatabase } from '../services/clients/recordsTestFixtures';
import { createClientRecords } from '../services/clients/records';
import { useClientDetailsStore } from '../stores/clientDetailsStore';
import { useClientAutosave, type UseClientAutosaveOptions } from './useClientAutosave';

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

function autosaveOptions(
  draft: ClientDraft,
  records: Awaited<ReturnType<typeof createRecordsFixture>>['records'],
): UseClientAutosaveOptions {
  if (draft.kind === 'profile') return { draft, value: draft.value, records };
  if (draft.kind === 'contact') return { draft, value: draft.value, records };
  return { draft, value: draft.value, records };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => { useClientDetailsStore.setState({ drafts: {}, saveStates: {} }); });
  await cleanupRecordsFixtures();
});

describe('useClientAutosave', () => {
  it.each([
    ['profile', 'automatic'], ['contact', 'automatic'],
    ['profile', 'retry'], ['contact', 'retry'],
  ] as const)('commits an unchanged recovered %s draft through %s after interruption', async (kind, mode) => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    vi.useFakeTimers();
    const draft = kind === 'profile'
      ? startProfileDraft('client-a', profileValue('Recovered profile'))
      : startContactDraft('client-a', 'contact-a', 1, {
        name: 'Ada Lovelace', role: 'Recovered role', email: 'ada@example.test', phone: '',
      });
    // Inject interruption only at the canonical boundary, after the real durable write.
    const interrupted = vi.spyOn(records, kind === 'profile' ? 'saveProfile' : 'saveContact')
      .mockImplementationOnce(async () => {
        expect(await database.clientDrafts.get(draft.id)).toMatchObject({
          editSessionId: draft.editSessionId, generation: draft.generation, value: draft.value,
        });
        throw new Error('Interrupted before canonical commit');
      });
    const options: UseClientAutosaveOptions = draft.kind === 'profile'
      ? { draft, value: draft.value, records }
      : { draft, value: draft.value, records };
    const initial = renderHook(() => useClientAutosave(options));
    vi.useRealTimers();
    await act(async () => { await initial.result.current.retry(); });
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(initial.result.current).toMatchObject({ status: 'error', errorCode: 'STORAGE' });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ revision: 1, description: '' });
    expect(await database.clientContacts.get('contact-a')).toMatchObject({ revision: 1, role: 'Analyst' });

    // Drop volatile edit state and reopen the same IndexedDB as a restarted app would.
    act(() => { useClientDetailsStore.setState({ drafts: {}, saveStates: {} }); });
    initial.unmount();
    const reopened = await reopenRecordsDatabase(database);
    const restartedRecords = createClientRecords(reopened);
    const stored = await restartedRecords.getDraft(draft.id);
    if (!stored.ok || !stored.value || stored.value.kind === 'note') throw new Error('Durable edit missing');
    const recovered = stored.value;
    expect(useClientDetailsStore.getState().recoverDraft(recovered)).toBe(true);
    const restartedOptions: UseClientAutosaveOptions = recovered.kind === 'profile'
      ? { draft: recovered, value: { ...recovered.value }, records: restartedRecords }
      : { draft: recovered, value: { ...recovered.value }, records: restartedRecords };
    vi.useFakeTimers();
    const restarted = renderHook(() => useClientAutosave(restartedOptions));
    // Equal values must not create a new generation to accidentally rescue autosave.
    expect(restarted.result.current.draft).toMatchObject({
      editSessionId: draft.editSessionId, generation: draft.generation, value: draft.value,
    });
    if (mode === 'automatic') {
      act(() => { vi.advanceTimersByTime(400); });
      vi.useRealTimers();
      await act(async () => {
        await waitFor(async () => { expect(await reopened.clientDrafts.get(draft.id)).toBeUndefined(); });
      });
    } else {
      // Retry before debounce, so this independently proves the explicit retry path.
      vi.useRealTimers();
      await act(async () => { await restarted.result.current.retry(); });
      expect(await reopened.clientDrafts.get(draft.id)).toBeUndefined();
    }
    if (kind === 'profile') {
      expect(await reopened.clientProfiles.get('client-a')).toMatchObject({ ...draft.value, revision: 2 });
    } else {
      expect(await reopened.clientContacts.get('contact-a')).toMatchObject({ ...draft.value, revision: 2 });
    }
    expect(restarted.result.current.status).toBe('saved');
    expect(restarted.result.current.draft?.generation).toBe(draft.generation);
    restarted.unmount();
  });

  it('does not automatically publish a recovered durable note, even on retry', async () => {
    const { database, records } = await createRecordsFixture();
    const draft = startNoteDraft('note-recovered');
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true });
    useClientDetailsStore.setState({ drafts: {}, saveStates: {} });
    const reopened = await reopenRecordsDatabase(database);
    const restartedRecords = createClientRecords(reopened);
    const stored = await restartedRecords.getDraft(draft.id);
    if (!stored.ok || !stored.value || stored.value.kind !== 'note') throw new Error('Durable note missing');
    const recovered = stored.value;
    expect(useClientDetailsStore.getState().recoverDraft(recovered)).toBe(true);
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useClientAutosave({
      draft: recovered, value: { ...recovered.value }, records: restartedRecords,
    }));
    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe('saved');
    expect(await reopened.clientDrafts.get(draft.id)).toEqual(recovered);
    expect(await reopened.clientNotes.get(draft.recordId)).toBeUndefined();

    await act(async () => { expect(await result.current.saveNote()).toMatchObject({ ok: true }); });
    expect(await reopened.clientDrafts.get(draft.id)).toBeUndefined();
    expect(await reopened.clientNotes.get(draft.recordId)).toMatchObject({ ...noteValue, revision: 1 });
    unmount();
  });

  it.each(['profile', 'contact'] as const)('keeps an invalid recovered %s durable with a validation error', async (kind) => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const draft = kind === 'profile'
      ? startProfileDraft('client-a', profileValue('Recovered invalid profile', 'javascript:alert(1)'))
      : startContactDraft('client-a', 'contact-a', 1, {
        name: 'Recovered invalid contact', role: 'Analyst', email: 'broken@', phone: '',
      });
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true });
    act(() => { useClientDetailsStore.setState({ drafts: {}, saveStates: {} }); });
    const reopened = await reopenRecordsDatabase(database);
    const restartedRecords = createClientRecords(reopened);
    const stored = await restartedRecords.getDraft(draft.id);
    if (!stored.ok || !stored.value || stored.value.kind === 'note') throw new Error('Durable edit missing');
    const recovered = stored.value;
    expect(useClientDetailsStore.getState().recoverDraft(recovered)).toBe(true);
    const options: UseClientAutosaveOptions = recovered.kind === 'profile'
      ? { draft: recovered, value: recovered.value, records: restartedRecords }
      : { draft: recovered, value: recovered.value, records: restartedRecords };
    const { result, unmount } = renderHook(() => useClientAutosave(options));

    await act(async () => { await result.current.retry(); });

    expect(result.current).toMatchObject({
      status: 'error', errorCode: 'VALIDATION', field: kind === 'profile' ? 'website' : 'email',
    });
    expect(await reopened.clientDrafts.get(draft.id)).toMatchObject({
      editSessionId: draft.editSessionId, generation: draft.generation, value: draft.value,
    });
    if (kind === 'profile') {
      expect(await reopened.clientProfiles.get('client-a')).toMatchObject({
        website: '', description: '', revision: 1,
      });
    } else {
      expect(await reopened.clientContacts.get('contact-a')).toMatchObject({
        name: 'Ada Lovelace', email: 'ada@example.test', revision: 1,
      });
    }
    unmount();
  });

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
      editSessionId: 'session-b', status: 'idle',
    });
  });

  it.each(['profile', 'contact', 'note'] as const)(
    'successful Discard cancels a first deferred %s draft write before a new session retries', async (kind) => {
      const { database, records, seedContacts } = await createRecordsFixture();
      if (kind === 'contact') await seedContacts();
      vi.useFakeTimers();
      const firstDraft = kind === 'profile'
        ? startProfileDraft('client-a', profileValue('Discarded value'))
        : kind === 'contact'
          ? startContactDraft('client-a', 'contact-a', 1, {
            name: 'Discarded contact', role: 'Analyst', email: 'discarded@example.test', phone: '',
          })
          : startNoteDraft('note-discard-race', { ...noteValue, bodyText: 'Discarded note' });
      const enteredSave = deferred();
      const releaseSave = deferred();
      const originalSaveDraft = records.saveDraft;
      vi.spyOn(records, 'saveDraft').mockImplementation(async (input) => {
        enteredSave.resolve();
        await releaseSave.promise;
        return originalSaveDraft(input);
      });
      const { result, rerender } = renderHook(({ draft }: { draft: ClientDraft }) =>
        useClientAutosave(autosaveOptions(draft, records)), { initialProps: { draft: firstDraft } });
      let firstSave!: Promise<void>;
      await act(async () => {
        firstSave = result.current.retry();
        await enteredSave.promise;
      });
      vi.useRealTimers();

      let discarded!: Awaited<ReturnType<typeof result.current.discardDraft>>;
      await act(async () => { discarded = await result.current.discardDraft(); });
      expect(discarded).toMatchObject({ ok: true });
      expect(await database.clientDrafts.get(firstDraft.id)).toBeUndefined();
      expect(useClientDetailsStore.getState().drafts[firstDraft.id]).toBeUndefined();

      let nextDraft!: ClientDraft;
      act(() => {
        nextDraft = kind === 'profile'
          ? startProfileDraft('client-a', profileValue('New session value'))
          : kind === 'contact'
            ? startContactDraft('client-a', 'contact-a', 1, {
              name: 'New session contact', role: 'Analyst', email: 'new@example.test', phone: '',
            })
            : startNoteDraft('note-discard-race', { ...noteValue, bodyText: 'New session note' });
      });
      expect(nextDraft.id).toBe(firstDraft.id);
      expect(nextDraft.editSessionId).not.toBe(firstDraft.editSessionId);
      act(() => { rerender({ draft: nextDraft }); });
      let nextSave!: Promise<void>;
      await act(async () => {
        nextSave = result.current.retry();
      });
      releaseSave.resolve();
      await act(async () => { await Promise.all([firstSave, nextSave]); });

      expect(result.current.status).toBe('saved');
      if (kind === 'profile') {
        expect(await database.clientProfiles.get('client-a')).toMatchObject({ description: 'New session value' });
        expect(await database.clientDrafts.get(nextDraft.id)).toBeUndefined();
      } else if (kind === 'contact') {
        expect(await database.clientContacts.get('contact-a')).toMatchObject({ name: 'New session contact' });
        expect(await database.clientDrafts.get(nextDraft.id)).toBeUndefined();
      } else {
        expect(await database.clientDrafts.get(nextDraft.id)).toMatchObject({
          editSessionId: nextDraft.editSessionId, generation: nextDraft.generation, value: nextDraft.value,
        });
        expect(await database.clientNotes.get('note-discard-race')).toBeUndefined();
      }
    },
  );

  it('successful Discard prevents deferred explicit note Save from publishing or poisoning a new session', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const firstDraft = startNoteDraft('note-discard-explicit', {
      ...noteValue, bodyText: 'Discarded explicit note',
    });
    const enteredSave = deferred();
    const releaseSave = deferred();
    const originalSaveDraft = records.saveDraft;
    vi.spyOn(records, 'saveDraft').mockImplementation(async (input) => {
      enteredSave.resolve();
      await releaseSave.promise;
      return originalSaveDraft(input);
    });
    const { result, rerender } = renderHook(({ draft }: { draft: ClientDraft }) =>
      useClientAutosave(autosaveOptions(draft, records)), { initialProps: { draft: firstDraft } });
    let firstSave!: ReturnType<typeof result.current.saveNote>;
    await act(async () => {
      firstSave = result.current.saveNote();
      await enteredSave.promise;
    });
    vi.useRealTimers();

    let discarded!: Awaited<ReturnType<typeof result.current.discardDraft>>;
    await act(async () => { discarded = await result.current.discardDraft(); });
    expect(discarded).toMatchObject({ ok: true });
    let nextDraft!: Extract<ClientDraft, { kind: 'note' }>;
    act(() => { nextDraft = startNoteDraft('note-discard-explicit', { ...noteValue, bodyText: 'New explicit note' }); });
    expect(nextDraft.id).toBe(firstDraft.id);
    expect(nextDraft.editSessionId).not.toBe(firstDraft.editSessionId);
    act(() => { rerender({ draft: nextDraft }); });
    let nextSave!: ReturnType<typeof result.current.saveNote>;
    await act(async () => {
      nextSave = result.current.saveNote();
    });
    releaseSave.resolve();

    let firstResult!: Awaited<typeof firstSave>;
    let nextResult!: Awaited<typeof nextSave>;
    await act(async () => {
      [firstResult, nextResult] = await Promise.all([firstSave, nextSave]);
    });
    expect(firstResult).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(nextResult).toMatchObject({ ok: true, value: { bodyText: 'New explicit note' } });
    expect(await database.clientNotes.get(firstDraft.recordId)).toMatchObject({ bodyText: 'New explicit note' });
    expect(await database.clientDrafts.get(firstDraft.id)).toBeUndefined();
  });

  it('successful Discard cancels explicit note Save already waiting at the canonical boundary', async () => {
    const { database, records } = await createRecordsFixture();
    vi.useFakeTimers();
    const firstDraft = startNoteDraft('note-discard-publish', {
      ...noteValue, bodyText: 'Discarded after durable draft',
    });
    const { result, rerender, unmount } = renderHook(({ draft }: { draft: ClientDraft }) =>
      useClientAutosave(autosaveOptions(draft, records)), { initialProps: { draft: firstDraft } });
    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await act(async () => { await result.current.retry(); });
    expect(await database.clientDrafts.get(firstDraft.id)).toMatchObject({
      editSessionId: firstDraft.editSessionId, generation: firstDraft.generation,
    });

    const enteredPublish = deferred();
    const releasePublish = deferred();
    const originalSaveNote = records.saveNote;
    vi.spyOn(records, 'saveNote').mockImplementationOnce(async (input) => {
      enteredPublish.resolve();
      await releasePublish.promise;
      return originalSaveNote(input);
    });
    let firstSave!: ReturnType<typeof result.current.saveNote>;
    await act(async () => {
      firstSave = result.current.saveNote();
      await enteredPublish.promise;
    });

    let discarded!: Awaited<ReturnType<typeof result.current.discardDraft>>;
    await act(async () => { discarded = await result.current.discardDraft(); });
    expect(discarded).toMatchObject({ ok: true });
    expect(await database.clientDrafts.get(firstDraft.id)).toBeUndefined();
    let nextDraft!: Extract<ClientDraft, { kind: 'note' }>;
    act(() => { nextDraft = startNoteDraft('note-discard-publish', { ...noteValue, bodyText: 'New session note' }); });
    expect(nextDraft.editSessionId).not.toBe(firstDraft.editSessionId);
    act(() => { rerender({ draft: nextDraft }); });
    let nextSave!: ReturnType<typeof result.current.saveNote>;
    await act(async () => { nextSave = result.current.saveNote(); });

    releasePublish.resolve();
    let firstResult!: Awaited<typeof firstSave>;
    let nextResult!: Awaited<typeof nextSave>;
    await act(async () => {
      [firstResult, nextResult] = await Promise.all([firstSave, nextSave]);
    });
    expect(firstResult).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(nextResult).toMatchObject({ ok: true, value: { bodyText: 'New session note' } });
    expect(await database.clientNotes.get(firstDraft.recordId)).toMatchObject({ bodyText: 'New session note' });
    expect(await database.clientDrafts.get(firstDraft.id)).toBeUndefined();
    unmount();
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

  it('keeps hook cancellation owned while an overlapping discard can still succeed', async () => {
    const { database, records } = await createRecordsFixture();
    const firstDraft = startProfileDraft('client-a', profileValue('First session'));
    expect(await records.saveDraft(firstDraft)).toMatchObject({ ok: true });
    const saveDraft = vi.spyOn(records, 'saveDraft');
    const firstEntered = deferred();
    const firstRelease = deferred();
    const secondEntered = deferred();
    const secondRelease = deferred();
    let discardCalls = 0;
    vi.spyOn(records, 'discardDraft').mockImplementation(async () => {
      discardCalls += 1;
      if (discardCalls === 1) {
        firstEntered.resolve();
        await firstRelease.promise;
        return { ok: false, code: 'STORAGE' };
      }
      secondEntered.resolve();
      await secondRelease.promise;
      await database.clientDrafts.delete(firstDraft.id);
      return { ok: true, value: undefined };
    });

    const { result, rerender, unmount } = renderHook(({ draft }: { draft: ClientDraft }) =>
      useClientAutosave(autosaveOptions(draft, records)), { initialProps: { draft: firstDraft } });
    let firstDiscard!: ReturnType<typeof result.current.discardDraft>;
    await act(async () => {
      firstDiscard = result.current.discardDraft();
      await firstEntered.promise;
    });
    let secondDiscard!: ReturnType<typeof result.current.discardDraft>;
    await act(async () => {
      secondDiscard = result.current.discardDraft();
      await secondEntered.promise;
    });

    firstRelease.resolve();
    let firstResult!: Awaited<typeof firstDiscard>;
    await act(async () => { firstResult = await firstDiscard; });
    await act(async () => { await result.current.retry(); });
    const firstSessionWrites = saveDraft.mock.calls.length;

    secondRelease.resolve();
    let secondResult!: Awaited<typeof secondDiscard>;
    await act(async () => { secondResult = await secondDiscard; });
    let nextDraft!: Extract<ClientDraft, { kind: 'profile' }>;
    act(() => {
      const next = useClientDetailsStore.getState().startEdit({
        clientId: 'client-a', kind: 'profile', baseRevision: 1, value: profileValue('New session'),
      });
      if (next.kind !== 'profile') throw new Error('Expected a profile draft');
      nextDraft = next;
    });
    expect(nextDraft.id).toBe(firstDraft.id);
    expect(nextDraft.editSessionId).not.toBe(firstDraft.editSessionId);
    act(() => { rerender({ draft: nextDraft }); });
    await act(async () => { await result.current.retry(); });

    expect(firstResult).toEqual({ ok: false, code: 'STORAGE' });
    expect(secondResult).toEqual({ ok: true, value: undefined });
    expect(firstSessionWrites).toBe(0);
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      description: 'New session', revision: 2,
    });
    expect(result.current.status).toBe('saved');
    unmount();
  });
});
