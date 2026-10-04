import { afterEach, describe, expect, it } from 'vitest';
import type { ClientDraft, NoteDraftValue } from '../types/clients';
import { useClientDetailsStore } from './clientDetailsStore';

const noteValue = (bodyText = 'Initial'): NoteDraftValue => ({
  title: 'Meeting', bodyText, kind: 'meeting', occurredAt: 1_000, contactId: null,
});

afterEach(() => {
  useClientDetailsStore.setState({ drafts: {}, saveStates: {} });
});

describe('client details edit state', () => {
  it('keeps a generated note identity and increases generation without changing its session', () => {
    const store = useClientDetailsStore.getState();
    const initial = store.startEdit({ clientId: 'client-a', kind: 'note', baseRevision: null, value: noteValue() });
    expect(initial).toMatchObject({
      id: JSON.stringify(['client-a', 'note', initial.recordId]),
      clientId: 'client-a', kind: 'note', generation: 0, baseRevision: null,
    });

    const changed = useClientDetailsStore.getState().updateDraft({
      id: initial.id, editSessionId: initial.editSessionId, value: noteValue('Changed'),
    });
    expect(changed).toMatchObject({
      id: initial.id, recordId: initial.recordId, editSessionId: initial.editSessionId,
      generation: 1, value: { bodyText: 'Changed' },
    });
    const retried = useClientDetailsStore.getState().drafts[initial.id];
    expect(retried).toMatchObject({ id: initial.id, recordId: initial.recordId,
      editSessionId: initial.editSessionId, generation: 1 });
  });

  it('requires explicit recovery and prevents stale-session completions from marking it saved', () => {
    const store = useClientDetailsStore.getState();
    const initial = store.startEdit({ clientId: 'client-a', kind: 'note', recordId: 'note-a',
      baseRevision: null, value: noteValue() });
    const pending = useClientDetailsStore.getState().updateDraft({
      id: initial.id, editSessionId: initial.editSessionId, value: noteValue('Pending generation'),
    });
    if (!pending || pending.kind !== 'note') throw new Error('Pending note edit missing');
    useClientDetailsStore.getState().markSaving(pending.id, pending.editSessionId, pending.generation);
    useClientDetailsStore.getState().markDraftSaved(pending.id, pending.editSessionId, pending.generation);

    const recovered = { ...pending, editSessionId: 'persisted-session', generation: 7,
      value: noteValue('Recovered durable text') };
    expect(useClientDetailsStore.getState().recoverDraft(recovered)).toBe(true);
    const returned = useClientDetailsStore.getState().startEdit({ clientId: 'client-a', kind: 'note',
      recordId: 'note-a', baseRevision: null, value: noteValue('Do not replace recovery') });
    expect(returned).toMatchObject({
      id: pending.id, editSessionId: 'persisted-session', generation: 7,
      value: { bodyText: 'Recovered durable text' },
    });

    useClientDetailsStore.getState().markSaved(pending.id, pending.editSessionId, pending.generation, 3);
    useClientDetailsStore.getState().markError({ id: pending.id, editSessionId: pending.editSessionId,
      generation: pending.generation, code: 'STORAGE' });
    expect(useClientDetailsStore.getState().drafts[pending.id]).toMatchObject({
      editSessionId: 'persisted-session', generation: 7, baseRevision: null,
      value: { bodyText: 'Recovered durable text' },
    });
    expect(useClientDetailsStore.getState().saveStates[pending.id]).toMatchObject({
      editSessionId: 'persisted-session', generation: 7, status: 'saved',
    });
  });

  it('rebases a newer local generation without showing the older completion as saved', () => {
    const initial = useClientDetailsStore.getState().startEdit({
      clientId: 'client-a', kind: 'note', recordId: 'note-race', baseRevision: null, value: noteValue(),
    });
    const older = useClientDetailsStore.getState().updateDraft({
      id: initial.id, editSessionId: initial.editSessionId, value: noteValue('Older'),
    });
    if (!older) throw new Error('Older edit missing');
    const newer = useClientDetailsStore.getState().updateDraft({
      id: initial.id, editSessionId: initial.editSessionId, value: noteValue('Newer'),
    });
    if (!newer) throw new Error('Newer edit missing');

    useClientDetailsStore.getState().markSaved(older.id, older.editSessionId, older.generation, 1);
    expect(useClientDetailsStore.getState().drafts[initial.id]).toMatchObject({
      generation: newer.generation, baseRevision: 1, value: { bodyText: 'Newer' },
    });
    expect(useClientDetailsStore.getState().saveStates[initial.id]).toMatchObject({
      generation: newer.generation, status: 'idle',
    });
  });

  it('refuses explicit recovery of a profile draft bound to a different record ID', () => {
    const invalid = {
      id: JSON.stringify(['client-a', 'profile', 'other-profile']),
      clientId: 'client-a', editSessionId: 'stored-session', generation: 2, baseRevision: 1,
      updatedAt: 1_000, kind: 'profile' as const, recordId: 'other-profile',
      value: { website: '', description: 'Do not attach this to client-a' },
    };

    expect(useClientDetailsStore.getState().recoverDraft(invalid)).toBe(false);
    expect(useClientDetailsStore.getState().drafts[invalid.id]).toBeUndefined();
  });

  it('does not take over a draft while its current edit session is saving', () => {
    const started = useClientDetailsStore.getState().startEdit({
      clientId: 'client-a', kind: 'note', recordId: 'note-saving', baseRevision: null, value: noteValue(),
    });
    if (started.kind !== 'note') throw new Error('Expected a note draft');
    const initial = started;
    useClientDetailsStore.getState().markSaving(initial.id, initial.editSessionId, initial.generation);
    const otherSession: Extract<ClientDraft, { kind: 'note' }> = {
      ...initial, editSessionId: 'takeover-session', generation: 1,
      value: noteValue('Must wait until the current save settles') };

    expect(useClientDetailsStore.getState().recoverDraft(otherSession)).toBe(false);
    expect(useClientDetailsStore.getState().drafts[initial.id]).toMatchObject({
      editSessionId: initial.editSessionId, generation: initial.generation,
    });
  });
});
