// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDraft, ContactDraftValue, NoteDraftValue, ProfileDraftValue } from '../../types/clients';
import { cleanupRecordsFixtures, createRecordsFixture, reopenRecordsDatabase } from './recordsTestFixtures';
import Dexie from 'dexie';
import { createClientRecords } from './records';


afterEach(async () => {
  await cleanupRecordsFixtures();
});

const profileValue = (overrides: Partial<ProfileDraftValue> = {}): ProfileDraftValue => ({
  website: 'https://example.test', description: 'Profile text', ...overrides,
});
const contactValue = (overrides: Partial<ContactDraftValue> = {}): ContactDraftValue => ({
  name: 'Ada Lovelace', role: 'Analyst', email: 'ada@example.test', phone: '', ...overrides,
});
const noteValue = (overrides: Partial<NoteDraftValue> = {}): NoteDraftValue => ({
  title: 'Follow-up', bodyText: 'Plain text', kind: 'note', occurredAt: 2_000, contactId: null, ...overrides,
});

type DraftInput = (
  | { kind: 'profile'; value: ProfileDraftValue }
  | { kind: 'contact'; value: ContactDraftValue }
  | { kind: 'note'; value: NoteDraftValue }
) & {
  clientId?: string;
  recordId?: string;
  generation?: number;
  baseRevision: number | null;
  editSessionId?: string;
};

function makeDraft(input: Extract<DraftInput, { kind: 'profile' }>): Extract<ClientDraft, { kind: 'profile' }>;
function makeDraft(input: Extract<DraftInput, { kind: 'contact' }>): Extract<ClientDraft, { kind: 'contact' }>;
function makeDraft(input: Extract<DraftInput, { kind: 'note' }>): Extract<ClientDraft, { kind: 'note' }>;
function makeDraft(input: DraftInput): ClientDraft {
  const clientId = input.clientId ?? 'client-a';
  const recordId = input.recordId ?? (input.kind === 'profile' ? clientId : `record-${input.kind}`);
  const common = {
    id: JSON.stringify([clientId, input.kind, recordId]),
    clientId,
    editSessionId: input.editSessionId ?? 'session-a',
    generation: input.generation ?? 1,
    baseRevision: input.baseRevision,
    updatedAt: 5_000 + (input.generation ?? 1),
    recordId,
  };
  if (input.kind === 'profile') return { ...common, kind: 'profile', value: input.value };
  if (input.kind === 'contact') return { ...common, kind: 'contact', value: input.value };
  return { ...common, kind: 'note', value: input.value };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('client detail drafts', () => {
  it('durably keeps incomplete profile, contact, and note text across close and reopen', async () => {
    const { database, records } = await createRecordsFixture();
    const drafts = [
      makeDraft({ kind: 'profile', baseRevision: null, value: profileValue({ website: 'javascript:alert(1)' }) }),
      makeDraft({ kind: 'contact', baseRevision: null, value: contactValue({ name: '  ', email: 'not an email' }) }),
      makeDraft({ kind: 'note', baseRevision: null, value: noteValue({ title: '  ', bodyText: '\n\t' }) }),
    ];

    for (const draft of drafts) expect(await records.saveDraft(draft)).toMatchObject({ ok: true });
    expect(await records.saveProfile({ clientId: 'client-a', expectedRevision: 1,
      value: profileValue({ website: 'javascript:alert(1)' }) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await records.saveContact({ id: 'record-contact', clientId: 'client-a', expectedRevision: null,
      value: contactValue({ name: '  ', email: 'not an email' }) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await records.saveNote({ id: 'record-note', clientId: 'client-a', expectedRevision: null,
      value: noteValue({ title: '  ', bodyText: '\n\t' }), draftId: null, generation: null,
      editSessionId: null })).toMatchObject({ ok: false, code: 'VALIDATION' });

    const reopened = await reopenRecordsDatabase(database);
    const reopenedRecords = (await import('./records')).createClientRecords(reopened);
    for (const draft of drafts) {
      const expectedDraft = draft.kind === 'profile' ? { ...draft, baseRevision: 1 } : draft;
      expect(await reopenedRecords.getDraft(draft.id)).toMatchObject({ ok: true, value: expectedDraft });
    }
    expect(await reopened.clientContacts.get('record-contact')).toBeUndefined();
    expect(await reopened.clientNotes.get('record-note')).toBeUndefined();
  });

  it('rebases a newer profile edit while consuming only the exact acknowledged generation', async () => {
    const { database, records } = await createRecordsFixture();
    const initial = await records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: profileValue({ description: 'Initial' }) });
    expect(initial).toMatchObject({ ok: true, value: { revision: 1 } });

    const first = makeDraft({ kind: 'profile', baseRevision: 1,
      value: profileValue({ description: 'Generation one' }) });
    const newer = { ...first, generation: 2, updatedAt: 5_002,
      value: profileValue({ description: 'Generation two' }) };
    expect(await records.saveDraft(first)).toMatchObject({ ok: true });
    expect(await records.saveDraft(newer)).toMatchObject({ ok: true });

    const saved = await Reflect.apply(records.saveProfile, records, [{
      clientId: 'client-a', expectedRevision: 1, value: first.value,
      draftAck: { id: first.id, generation: first.generation, editSessionId: first.editSessionId },
    }]);
    expect(saved).toMatchObject({ ok: true, value: { revision: 2, description: 'Generation one' } });
    expect(await records.getDraft(first.id)).toMatchObject({ ok: true, value: {
      generation: 2, baseRevision: 2, value: { description: 'Generation two' },
    } });

    const newest = await Reflect.apply(records.saveProfile, records, [{
      clientId: 'client-a', expectedRevision: 2, value: newer.value,
      draftAck: { id: newer.id, generation: newer.generation, editSessionId: newer.editSessionId },
    }]);
    expect(newest).toMatchObject({ ok: true, value: { revision: 3, description: 'Generation two' } });
    expect(await database.clientDrafts.get(first.id)).toBeUndefined();
  });

  it('rebases a newer contact edit and never lets an old acknowledgement delete it', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const first = makeDraft({ kind: 'contact', recordId: 'contact-a', baseRevision: 1,
      value: contactValue({ role: 'Generation one' }) });
    const newer = { ...first, generation: 2, updatedAt: 5_002,
      value: contactValue({ role: 'Generation two' }) };
    expect(await records.saveDraft(first)).toMatchObject({ ok: true });
    expect(await records.saveDraft(newer)).toMatchObject({ ok: true });

    const saved = await Reflect.apply(records.saveContact, records, [{
      id: 'contact-a', clientId: 'client-a', expectedRevision: 1, value: first.value,
      draftAck: { id: first.id, generation: first.generation, editSessionId: first.editSessionId },
    }]);
    expect(saved).toMatchObject({ ok: true, value: { revision: 2, role: 'Generation one' } });
    expect(await records.getDraft(first.id)).toMatchObject({ ok: true, value: {
      generation: 2, baseRevision: 2, value: { role: 'Generation two' },
    } });

    const latest = await Reflect.apply(records.saveContact, records, [{
      id: 'contact-a', clientId: 'client-a', expectedRevision: 2, value: newer.value,
      draftAck: { id: newer.id, generation: newer.generation, editSessionId: newer.editSessionId },
    }]);
    expect(latest).toMatchObject({ ok: true, value: { revision: 3, role: 'Generation two' } });
    expect(await database.clientDrafts.get(first.id)).toBeUndefined();
  });

  it('rejects a profile acknowledgement whose normalized value differs from the saved draft', async () => {
    const { database, records } = await createRecordsFixture();
    await records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: profileValue({ website: '', description: 'Canonical baseline' }) });
    const draft = makeDraft({ kind: 'profile', baseRevision: 1,
      value: profileValue({ website: '', description: 'Draft value' }) });
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true });

    const result = await Reflect.apply(records.saveProfile, records, [{
      clientId: 'client-a', expectedRevision: 1,
      value: profileValue({ website: '', description: 'Different valid value' }),
      draftAck: { id: draft.id, generation: draft.generation, editSessionId: draft.editSessionId },
    }]);

    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      revision: 1, description: 'Canonical baseline',
    });
    expect(await records.getDraft(draft.id)).toMatchObject({ ok: true, value: draft });
  });

  it('does not consume a contact draft acknowledged by a different edit session', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const draft = makeDraft({ kind: 'contact', recordId: 'contact-a', baseRevision: 1,
      value: contactValue({ role: 'Draft role' }) });
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true });

    const result = await Reflect.apply(records.saveContact, records, [{
      id: 'contact-a', clientId: 'client-a', expectedRevision: 1, value: draft.value,
      draftAck: { id: draft.id, generation: draft.generation, editSessionId: 'other-session' },
    }]);

    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientContacts.get('contact-a')).toMatchObject({ revision: 1, role: 'Analyst' });
    expect(await records.getDraft(draft.id)).toMatchObject({ ok: true, value: draft });
  });

  it('accepts the validated normalized value of the exact acknowledged contact draft', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const draft = makeDraft({ kind: 'contact', recordId: 'contact-a', baseRevision: 1,
      value: contactValue({ name: ' Ada Lovelace ', role: ' Principal Analyst ' }) });
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true });

    const result = await Reflect.apply(records.saveContact, records, [{
      id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
      value: contactValue({ name: 'Ada Lovelace', role: 'Principal Analyst' }),
      draftAck: { id: draft.id, generation: draft.generation, editSessionId: draft.editSessionId },
    }]);

    expect(result).toMatchObject({ ok: true, value: { revision: 2, role: 'Principal Analyst' } });
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
  });

  it.each(['profile', 'contact'] as const)('rejects an older %s acknowledgement value that was never durable', async (kind) => {
    const { database, records, seedContacts } = await createRecordsFixture();
    if (kind === 'contact') await seedContacts();

    if (kind === 'profile') {
      const input = makeDraft({ kind, baseRevision: null, generation: 1,
        value: profileValue({ website: '', description: 'Generation one' }) });
      const durableFirst = await records.saveDraft(input);
      if (!durableFirst.ok || durableFirst.value.kind !== 'profile') throw new Error('Profile draft missing');
      const first = durableFirst.value;
      const newer = { ...first, generation: 2,
        value: profileValue({ website: '', description: 'Generation two' }) };
      expect(await records.saveDraft(newer)).toMatchObject({ ok: true });
      const beforeProfile = await database.clientProfiles.get('client-a');
      const beforeDraft = await database.clientDrafts.get(first.id);

      const result = await records.saveProfile({
        clientId: 'client-a', expectedRevision: 1,
        value: profileValue({ website: '', description: 'NEVER_DURABLE' }),
        draftAck: { id: first.id, editSessionId: first.editSessionId, generation: 1 },
      });

      expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(await database.clientProfiles.get('client-a')).toEqual(beforeProfile);
      expect(await database.clientDrafts.get(first.id)).toEqual(beforeDraft);
      return;
    }

    const input = makeDraft({ kind, recordId: 'contact-a', baseRevision: 1, generation: 1,
      value: contactValue({ name: 'Generation one' }) });
    const durableFirst = await records.saveDraft(input);
    if (!durableFirst.ok || durableFirst.value.kind !== 'contact') throw new Error('Contact draft missing');
    const first = durableFirst.value;
    const newer = { ...first, generation: 2, value: contactValue({ name: 'Generation two' }) };
    expect(await records.saveDraft(newer)).toMatchObject({ ok: true });
    const beforeContact = await database.clientContacts.get('contact-a');
    const beforeDraft = await database.clientDrafts.get(first.id);

    const result = await records.saveContact({
      id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
      value: contactValue({ name: 'NEVER_DURABLE' }),
      draftAck: { id: first.id, editSessionId: first.editSessionId, generation: 1 },
    });

    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientContacts.get('contact-a')).toEqual(beforeContact);
    expect(await database.clientDrafts.get(first.id)).toEqual(beforeDraft);
  });

  it.each(['profile', 'contact'] as const)('rejects a %s acknowledgement for an older generation that never existed', async (kind) => {
    const { database, records, seedContacts } = await createRecordsFixture();
    if (kind === 'contact') await seedContacts();

    if (kind === 'profile') {
      const current = makeDraft({ kind, baseRevision: null, generation: 2,
        value: profileValue({ website: '', description: 'Generation two' }) });
      const durable = await records.saveDraft(current);
      expect(durable).toMatchObject({ ok: true });
      const beforeProfile = await database.clientProfiles.get('client-a');
      const beforeDraft = await database.clientDrafts.get(current.id);
      const result = await records.saveProfile({
        clientId: 'client-a', expectedRevision: 1,
        value: profileValue({ website: '', description: 'NEVER_DURABLE' }),
        draftAck: { id: current.id, editSessionId: current.editSessionId, generation: 1 },
      });
      expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(await database.clientProfiles.get('client-a')).toEqual(beforeProfile);
      expect(await database.clientDrafts.get(current.id)).toEqual(beforeDraft);
      return;
    }

    const current = makeDraft({ kind, recordId: 'contact-a', baseRevision: 1, generation: 2,
      value: contactValue({ name: 'Generation two' }) });
    const durable = await records.saveDraft(current);
    expect(durable).toMatchObject({ ok: true });
    const beforeContact = await database.clientContacts.get('contact-a');
    const beforeDraft = await database.clientDrafts.get(current.id);
    const result = await records.saveContact({
      id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
      value: contactValue({ name: 'NEVER_DURABLE' }),
      draftAck: { id: current.id, editSessionId: current.editSessionId, generation: 1 },
    });
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientContacts.get('contact-a')).toEqual(beforeContact);
    expect(await database.clientDrafts.get(current.id)).toEqual(beforeDraft);
  });

  it('rebases implicit profile creation once and makes the same generation retry idempotent', async () => {
    const { records } = await createRecordsFixture();
    const draft = makeDraft({ kind: 'profile', baseRevision: null, value: profileValue() });
    const first = await records.saveDraft(draft);
    expect(first).toMatchObject({ ok: true, value: { generation: 1, baseRevision: 1 } });
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true, value: { generation: 1, baseRevision: 1 } });
    const stored = await records.getDraft(draft.id);
    if (!stored.ok || !stored.value || stored.value.kind !== 'profile') throw new Error('Profile draft missing');
    expect(await Reflect.apply(records.saveProfile, records, [{
      clientId: 'client-a', expectedRevision: stored.value.baseRevision, value: draft.value,
      draftAck: { id: draft.id, generation: draft.generation, editSessionId: draft.editSessionId },
    }])).toMatchObject({ ok: true, value: { revision: 2 } });
    expect(await records.getDraft(draft.id)).toMatchObject({ ok: true, value: null });
  });

  it('keeps a pending overlapping discard cancellation after another attempt fails first', async () => {
    const { database, records } = await createRecordsFixture();
    const draft = makeDraft({ kind: 'profile', baseRevision: null, value: profileValue() });
    const durable = await records.saveDraft(draft);
    if (!durable.ok || durable.value.kind !== 'profile') throw new Error('Profile draft missing');

    const firstEntered = deferred();
    const firstRelease = deferred();
    const secondEntered = deferred();
    const secondRelease = deferred();
    const nativeTransaction = database.transaction.bind(database);
    let transactionCalls = 0;
    vi.spyOn(database, 'transaction').mockImplementation((...args) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        firstEntered.resolve();
        return Dexie.Promise.resolve(firstRelease.promise).then(() => {
          throw new DOMException('quota', 'QuotaExceededError');
        });
      }
      if (transactionCalls === 2) {
        secondEntered.resolve();
        return Dexie.Promise.resolve(secondRelease.promise).then(() => nativeTransaction(...args));
      }
      return nativeTransaction(...args);
    });

    const discardInput = {
      id: durable.value.id,
      editSessionId: durable.value.editSessionId,
      generation: durable.value.generation,
    };
    const first = records.discardDraft(discardInput);
    await firstEntered.promise;
    const second = createClientRecords(database).discardDraft(discardInput);
    await secondEntered.promise;

    firstRelease.resolve();
    const firstResult = await first;
    const lateFirstWrite = await records.saveDraft(durable.value);
    secondRelease.resolve();
    const secondResult = await second;

    expect(firstResult).toEqual({ ok: false, code: 'STORAGE' });
    expect(lateFirstWrite).toEqual({ ok: false, code: 'CONFLICT' });
    expect(secondResult).toEqual({ ok: true, value: undefined });
    const nextSession = {
      ...durable.value,
      editSessionId: 'session-b',
      generation: 0,
      value: profileValue({ description: 'New session' }),
    };
    expect(nextSession.id).toBe(durable.value.id);
    expect(await records.saveDraft(nextSession)).toMatchObject({ ok: true, value: nextSession });
  });
});
