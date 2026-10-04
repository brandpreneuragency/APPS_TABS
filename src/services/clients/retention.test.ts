// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDraft, NoteDraftValue } from '../../types/clients';
import { createClientRecords } from './records';
import { cleanupRecordsFixtures, createRecordsFixture, reopenRecordsDatabase } from './recordsTestFixtures';
import { MAX_ATTACHMENT_BYTES } from './schema';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRecordsFixtures();
});

const noteValue = (overrides: Partial<{
  title: string;
  bodyText: string;
  kind: 'call' | 'meeting' | 'decision' | 'note';
  occurredAt: number;
  contactId: string | null;
}> = {}) => ({
  title: 'Follow-up', bodyText: 'Plain text note', kind: 'note' as const,
  occurredAt: 2_000, contactId: null, ...overrides,
});

const makeNoteDraft = (input: {
  id: string;
  recordId: string;
  value: NoteDraftValue;
  generation?: number;
  baseRevision?: number | null;
  editSessionId?: string;
}): Extract<ClientDraft, { kind: 'note' }> => ({
  id: input.id,
  clientId: 'client-a',
  editSessionId: input.editSessionId ?? 'session-a',
  generation: input.generation ?? 1,
  baseRevision: input.baseRevision ?? null,
  updatedAt: 3_000 + (input.generation ?? 1),
  kind: 'note',
  recordId: input.recordId,
  value: input.value,
});

const testFile = (name = 'note.txt', content = 'attachment bytes') =>
  new File([content], name, { type: 'text/plain' });

describe('client note retention and lifecycle', () => {
  it('requires the publishing caller to match the durable draft edit session', async () => {
    const { database, records } = await createRecordsFixture();
    const draft = makeNoteDraft({ id: 'note:client-a:note-session', recordId: 'note-session', value: noteValue() });
    expect(await records.saveDraft(draft)).toMatchObject({ ok: true });
    expect(await records.discardDraft({ id: draft.id, editSessionId: 'session-a', generation: 1 }))
      .toMatchObject({ ok: true });
    const replacement = { ...draft, editSessionId: 'session-b' };
    expect(await records.saveDraft(replacement)).toMatchObject({ ok: true });
    expect(await records.addAttachment({ id: 'session-b-attachment', clientId: 'client-a',
      ownerType: 'draft', ownerId: draft.id, file: testFile('session-b.txt', 'BBB') }))
      .toMatchObject({ ok: true });

    expect(await records.saveNote({ id: 'note-session', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: draft.id, generation: 1, editSessionId: 'session-a' }))
      .toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientNotes.get('note-session')).toBeUndefined();
    expect(await database.settings.get('clientsV1Actor')).toBeUndefined();
    expect(await records.getDraft(draft.id)).toMatchObject({ ok: true, value: replacement });
    expect(await (await database.clientAttachments.get('session-b-attachment'))?.data.text()).toBe('BBB');

    const missingSession = {
      id: 'note-session', clientId: 'client-a', expectedRevision: null, value: noteValue(),
      draftId: draft.id, generation: 1, editSessionId: 'session-b',
    };
    Reflect.deleteProperty(missingSession, 'editSessionId');
    expect(await Reflect.apply(records.saveNote, records, [missingSession]))
      .toMatchObject({ ok: false, code: 'VALIDATION', field: 'editSessionId' });
    expect(await records.getDraft(draft.id)).toMatchObject({ ok: true, value: replacement });

    expect(await records.saveNote({ id: 'note-session', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: draft.id, generation: 1, editSessionId: 'session-b' }))
      .toMatchObject({ ok: true, value: { revision: 1 } });
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
    expect(await database.clientAttachments.get('session-b-attachment'))
      .toMatchObject({ ownerType: 'note', ownerId: 'note-session' });
    expect(await (await database.clientAttachments.get('session-b-attachment'))?.data.text()).toBe('BBB');
  });

  const publicationCases = (['create', 'update'] as const).flatMap((target) =>
    ([true, false] as const).flatMap((publishFirst) =>
      ([1, 3, 4] as const).map((generation) => ({ target, publishFirst, generation }))));

  it.each(publicationCases)(
    'linearizes $target note draft generation $generation with publishFirst=$publishFirst',
    async ({ target, publishFirst, generation }) => {
      const { database, records } = await createRecordsFixture();
      const recordId = `note-${target}-publish`;
      const initialNote = target === 'update'
        ? await records.saveNote({ id: recordId, clientId: 'client-a', expectedRevision: null,
          value: noteValue(), draftId: null, generation: null, editSessionId: null })
        : null;
      if (initialNote && !initialNote.ok) throw new Error('Could not create update target');
      const baseRevision = initialNote?.ok ? initialNote.value.revision : null;
      const initialDraft = makeNoteDraft({ id: `draft-${target}-publish`, recordId, value: noteValue(),
        generation: 3, baseRevision });
      expect(await records.saveDraft(initialDraft)).toMatchObject({ ok: true });
      expect(await records.addAttachment({ id: `attachment-${target}-publish`, clientId: 'client-a',
        ownerType: 'draft', ownerId: initialDraft.id, file: testFile('publish.txt', 'publish bytes') }))
        .toMatchObject({ ok: true });

      let publishGeneration = initialDraft.generation;
      let publishValue = initialDraft.value;
      if (!publishFirst) {
        const autosave = makeNoteDraft({ ...initialDraft, generation,
          value: generation > initialDraft.generation ? noteValue({ bodyText: 'newer before publish' }) : noteValue() });
        const autosaveResult = await records.saveDraft(autosave);
        if (generation < initialDraft.generation) {
          expect(autosaveResult).toMatchObject({ ok: false, code: 'CONFLICT' });
        } else {
          expect(autosaveResult).toMatchObject({ ok: true });
          if (generation > initialDraft.generation) {
            publishGeneration = generation;
            publishValue = autosave.value;
          }
        }
      }

      const published = await records.saveNote({ id: recordId, clientId: 'client-a', expectedRevision: baseRevision,
        value: publishValue, draftId: initialDraft.id, generation: publishGeneration, editSessionId: 'session-a' });
      expect(published).toMatchObject({ ok: true, value: {
        revision: target === 'create' ? 1 : 2, bodyText: publishValue.bodyText,
      } });

      if (publishFirst) {
        const delayed = makeNoteDraft({ ...initialDraft, generation,
          value: generation > initialDraft.generation ? noteValue({ bodyText: 'late after publish' }) : noteValue() });
        expect(await records.saveDraft(delayed)).toMatchObject({ ok: false, code: 'CONFLICT' });
      }
      expect(await database.clientDrafts.get(initialDraft.id)).toBeUndefined();
      const storedNote = await database.clientNotes.get(recordId);
      expect(storedNote).toMatchObject({ revision: target === 'create' ? 1 : 2, bodyText: publishValue.bodyText });
      expect(await database.clientAttachments.get(`attachment-${target}-publish`))
        .toMatchObject({ ownerType: 'note', ownerId: recordId });
      expect(await (await database.clientAttachments.get(`attachment-${target}-publish`))?.data.text())
        .toBe('publish bytes');
    },
  );

  it('rejects foreign, deleted, missing-update, and stale note/contact draft targets before mutation', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const foreignNote = await records.saveNote({ id: 'foreign-note', clientId: 'client-b', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null });
    expect(foreignNote.ok).toBe(true);
    const beforeForeignDrafts = {
      profile: await database.clientProfiles.get('client-a'), drafts: await database.clientDrafts.toArray(),
      attachments: await database.clientAttachments.toArray(), actor: await database.settings.get('clientsV1Actor'),
    };
    expect(await records.saveDraft(makeNoteDraft({ id: 'draft-foreign-note', recordId: 'foreign-note',
      value: noteValue(), baseRevision: 1 }))).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await records.saveDraft({ id: 'draft-foreign-contact', clientId: 'client-a', kind: 'contact',
      recordId: 'contact-b', editSessionId: 'session-a', generation: 1, baseRevision: 1, updatedAt: 5000,
      value: { name: 'Foreign edit', role: '', email: '', phone: '' } }))
      .toMatchObject({ ok: false, code: 'CONFLICT' });
    expect({
      profile: await database.clientProfiles.get('client-a'), drafts: await database.clientDrafts.toArray(),
      attachments: await database.clientAttachments.toArray(), actor: await database.settings.get('clientsV1Actor'),
    }).toEqual(beforeForeignDrafts);

    const deletedNote = await records.saveNote({ id: 'deleted-note', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null });
    expect(deletedNote.ok).toBe(true);
    expect(await records.setNoteDeleted({ id: 'deleted-note', clientId: 'client-a', expectedRevision: 1, deleted: true }))
      .toMatchObject({ ok: true });
    expect(await records.saveContact({ id: 'deleted-contact', clientId: 'client-a', expectedRevision: null,
      value: { name: 'Deleted contact', role: '', email: '', phone: '' } })).toMatchObject({ ok: true });
    expect(await records.deleteContact({ id: 'deleted-contact', clientId: 'client-a', expectedRevision: 1 }))
      .toMatchObject({ ok: true });
    expect(await records.saveNote({ id: 'stale-note', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: true });
    expect(await records.saveNote({ id: 'stale-note', clientId: 'client-a', expectedRevision: 1,
      value: noteValue({ bodyText: 'revision two' }), draftId: null, generation: null, editSessionId: null }))
      .toMatchObject({ ok: true });
    expect(await records.saveContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
      value: { name: 'Ada revision two', role: 'Analyst', email: 'ada@example.test', phone: '' } }))
      .toMatchObject({ ok: true });

    const contactDraft = (id: string, recordId: string, baseRevision: number | null) => ({
      id, clientId: 'client-a', kind: 'contact' as const, recordId, editSessionId: 'session-a',
      generation: 1, baseRevision, updatedAt: 6000,
      value: { name: 'Draft contact', role: '', email: '', phone: '' },
    });
    const failures = [
      [makeNoteDraft({ id: 'draft-deleted-note', recordId: 'deleted-note', value: noteValue(), baseRevision: 1 }), 'NOT_FOUND'],
      [contactDraft('draft-deleted-contact', 'deleted-contact', 1), 'NOT_FOUND'],
      [makeNoteDraft({ id: 'draft-missing-note', recordId: 'missing-note', value: noteValue(), baseRevision: 1 }), 'CONFLICT'],
      [contactDraft('draft-missing-contact', 'missing-contact', 1), 'CONFLICT'],
      [makeNoteDraft({ id: 'draft-stale-note', recordId: 'stale-note', value: noteValue(), baseRevision: 1 }), 'CONFLICT'],
      [contactDraft('draft-stale-contact', 'contact-a', 1), 'CONFLICT'],
    ] as const;
    const before = {
      profiles: await database.clientProfiles.toArray(), notes: await database.clientNotes.toArray(),
      contacts: await database.clientContacts.toArray(), drafts: await database.clientDrafts.toArray(),
      attachments: await database.clientAttachments.toArray(), settings: await database.settings.toArray(),
    };
    for (const [draft, code] of failures) {
      expect(await records.saveDraft(draft)).toMatchObject({ ok: false, code });
    }
    expect({
      profiles: await database.clientProfiles.toArray(), notes: await database.clientNotes.toArray(),
      contacts: await database.clientContacts.toArray(), drafts: await database.clientDrafts.toArray(),
      attachments: await database.clientAttachments.toArray(), settings: await database.settings.toArray(),
    }).toEqual(before);

    expect(await records.saveDraft(makeNoteDraft({ id: 'draft-valid-note-create', recordId: 'new-note',
      value: noteValue(), baseRevision: null }))).toMatchObject({ ok: true });
    expect(await records.saveDraft(contactDraft('draft-valid-contact-create', 'new-contact', null)))
      .toMatchObject({ ok: true });
    expect(await records.saveDraft(makeNoteDraft({ id: 'draft-valid-note-update', recordId: 'stale-note',
      value: noteValue(), baseRevision: 2 }))).toMatchObject({ ok: true });
    expect(await records.saveDraft(contactDraft('draft-valid-contact-update', 'contact-a', 2)))
      .toMatchObject({ ok: true });
  });

  it('creates, pins, soft-deletes, and restores a note without changing identity or history', async () => {
    const { database, records } = await createRecordsFixture();
    const created = await records.saveNote({
      id: 'note-1', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null,
    });
    expect(created).toMatchObject({ ok: true, value: { id: 'note-1', revision: 1, pinned: false } });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      clientSnapshot: { id: 'client-a', name: 'Brand A' }, revision: 1,
    });
    if (!created.ok) throw new Error('Note was not created');

    const pinned = await records.setNotePinned({
      id: 'note-1', clientId: 'client-a', expectedRevision: 1, pinned: true,
    });
    expect(pinned).toMatchObject({ ok: true, value: { id: 'note-1', revision: 2, pinned: true } });
    const deleted = await records.setNoteDeleted({
      id: 'note-1', clientId: 'client-a', expectedRevision: 2, deleted: true,
    });
    expect(deleted).toMatchObject({ ok: true, value: { id: 'note-1', revision: 3, deletedAt: expect.any(Number) } });
    const restored = await records.setNoteDeleted({
      id: 'note-1', clientId: 'client-a', expectedRevision: 3, deleted: false,
    });

    expect(restored).toMatchObject({
      ok: true,
      value: {
        id: 'note-1', clientId: 'client-a', title: 'Follow-up', bodyText: 'Plain text note',
        authorId: created.value.authorId, createdAt: created.value.createdAt, revision: 4,
        pinned: true,
      },
    });
    expect(restored.ok && restored.value.deletedAt).toBeUndefined();
    expect((await database.clientNotes.get('note-1'))?.updatedAt).toBeGreaterThan(created.value.updatedAt);
  });

  it('preserves historical contact snapshots through contact edits/deletes and snapshots a deliberate re-link', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    await database.clientContacts.add({
      id: 'contact-a2', clientId: 'client-a', name: 'Katherine Johnson', role: 'Mathematician',
      email: 'kj@example.test', phone: '', revision: 1, createdAt: 500, updatedAt: 500,
    });
    const created = await records.saveNote({
      id: 'note-contact', clientId: 'client-a', expectedRevision: null,
      value: noteValue({ contactId: 'contact-a' }), draftId: null, generation: null, editSessionId: null,
    });
    expect(created).toMatchObject({ ok: true, value: {
      contactId: 'contact-a', contactSnapshot: { name: 'Ada Lovelace', email: 'ada@example.test' },
    } });

    const edited = await records.saveContact({
      id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
      value: { name: 'Ada Byron', role: 'Writer', email: 'ada-new@example.test', phone: '' },
    });
    expect(edited.ok).toBe(true);
    expect(await database.clientNotes.get('note-contact')).toMatchObject({
      contactSnapshot: { name: 'Ada Lovelace', email: 'ada@example.test' },
    });
    const contactDeleted = await records.deleteContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 2 });
    expect(contactDeleted.ok).toBe(true);

    const sameLink = await records.saveNote({
      id: 'note-contact', clientId: 'client-a', expectedRevision: 1,
      value: noteValue({ bodyText: 'Updated body, same historical link', contactId: 'contact-a' }),
      draftId: null, generation: null, editSessionId: null,
    });
    expect(sameLink).toMatchObject({ ok: true, value: {
      contactId: 'contact-a', contactSnapshot: { name: 'Ada Lovelace', email: 'ada@example.test' },
    } });
    const relinked = await records.saveNote({
      id: 'note-contact', clientId: 'client-a', expectedRevision: 2,
      value: noteValue({ bodyText: 'Re-linked', contactId: 'contact-a2' }),
      draftId: null, generation: null, editSessionId: null,
    });
    expect(relinked).toMatchObject({ ok: true, value: {
      contactId: 'contact-a2', contactSnapshot: { name: 'Katherine Johnson', email: 'kj@example.test' },
    } });
  });

  it('retains snapshots and local rows when the canonical brand disappears', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const profile = await records.saveProfile({
      clientId: 'client-a', expectedRevision: null, value: { website: '', description: 'Retain' },
    });
    const note = await records.saveNote({
      id: 'note-archived', clientId: 'client-a', expectedRevision: null,
      value: noteValue({ title: 'Retain this history' }), draftId: null, generation: null, editSessionId: null,
    });
    expect(profile.ok && note.ok).toBe(true);
    await records.addAttachment({ id: 'attachment-archived', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-archived', file: testFile('archive.txt', 'preserve bytes') });
    const before = {
      profile: await database.clientProfiles.get('client-a'),
      contacts: await database.clientContacts.toArray(),
      notes: await database.clientNotes.toArray(),
      attachments: await database.clientAttachments.toArray(),
    };

    await database.clients.delete('client-a');

    expect(await database.clientProfiles.get('client-a')).toEqual(before.profile);
    expect(await database.clientContacts.toArray()).toEqual(before.contacts);
    expect(await database.clientNotes.toArray()).toEqual(before.notes);
    const afterAttachments = await database.clientAttachments.toArray();
    const attachmentMetadata = (row: (typeof afterAttachments)[number]) => [
      row.id, row.clientId, row.ownerType, row.ownerId, row.displayName, row.mime, row.bytes, row.createdAt,
    ];
    expect(afterAttachments.map(attachmentMetadata)).toEqual(before.attachments.map(attachmentMetadata));
    expect(await afterAttachments[0].data.text()).toBe('preserve bytes');
    expect(await records.getProfile('client-a')).toMatchObject({
      ok: true, value: { clientSnapshot: { id: 'client-a', name: 'Brand A' } },
    });
    const archived = await records.listNotes({
      clientId: null, deleted: false, archived: true, query: 'retain',
    });
    expect(archived).toMatchObject({ ok: true, value: [{
      id: 'note-archived', clientId: 'client-a',
    }] });
    expect(await records.saveProfile({
      clientId: 'client-a', expectedRevision: 1, value: { website: '', description: 'No owner' },
    })).toMatchObject({ ok: false, code: 'DETACHED' });
    expect(await records.setNoteDeleted({
      id: 'note-archived', clientId: 'client-a', expectedRevision: 1, deleted: false,
    })).toMatchObject({ ok: false, code: 'DETACHED' });
  });

  it('conditionally refreshes canonical snapshots through note/contact writes and rolls failures back', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const profile = await records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: 'https://local.example.test', description: 'Keep local description' } });
    expect(profile).toMatchObject({ ok: true, value: { revision: 1 } });
    const primary = await records.setPrimaryContact({ clientId: 'client-a', contactId: 'contact-a',
      expectedProfileRevision: 1 });
    expect(primary).toMatchObject({ ok: true, value: { revision: 2, primaryContactId: 'contact-a' } });

    const created = await records.saveNote({ id: 'snapshot-note', clientId: 'client-a', expectedRevision: null,
      value: noteValue({ contactId: 'contact-a' }), draftId: null, generation: null, editSessionId: null });
    expect(created).toMatchObject({ ok: true, value: {
      contactSnapshot: { name: 'Ada Lovelace', email: 'ada@example.test' },
    } });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ revision: 2 });

    const firstCanonical = { ...(await database.clients.get('client-a'))!, name: 'Brand A latest', color: '#abcdef' };
    await database.clients.put(firstCanonical);
    expect(await records.saveNote({ id: 'snapshot-note', clientId: 'client-a', expectedRevision: 1,
      value: noteValue({ bodyText: 'after first canonical rename', contactId: 'contact-a' }),
      draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: true, value: { revision: 2 } });
    const afterNoteRefresh = await database.clientProfiles.get('client-a');
    expect(afterNoteRefresh).toMatchObject({
      clientSnapshot: firstCanonical, website: 'https://local.example.test',
      description: 'Keep local description', primaryContactId: 'contact-a', revision: 3,
    });

    expect(await records.saveContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
      value: { name: 'Ada Lovelace', role: 'Analyst', email: 'ada@example.test', phone: '' } }))
      .toMatchObject({ ok: true, value: { revision: 2 } });
    expect(await database.clientProfiles.get('client-a')).toEqual(afterNoteRefresh);

    const secondCanonical = { ...firstCanonical, name: 'Brand A color update', color: '#fedcba' };
    await database.clients.put(secondCanonical);
    const contactUpdate = await records.saveContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 2,
      value: { name: 'Ada Byron', role: 'Writer', email: 'ada-new@example.test', phone: '' } });
    expect(contactUpdate).toMatchObject({ ok: true, value: { revision: 3 } });
    const afterContactRefresh = await database.clientProfiles.get('client-a');
    expect(afterContactRefresh).toMatchObject({
      clientSnapshot: secondCanonical, website: 'https://local.example.test',
      description: 'Keep local description', primaryContactId: 'contact-a', revision: 4,
    });
    expect(afterContactRefresh?.updatedAt).toBeGreaterThan(afterNoteRefresh?.updatedAt ?? 0);
    expect(await database.clientNotes.get('snapshot-note')).toMatchObject({
      contactSnapshot: { name: 'Ada Lovelace', email: 'ada@example.test' },
    });

    const rollbackCanonical = { ...secondCanonical, name: 'Uncommitted canonical update', color: '#111111' };
    await database.clients.put(rollbackCanonical);
    const beforeFailedNote = await database.clientNotes.get('snapshot-note');
    vi.spyOn(database.clientNotes, 'put').mockRejectedValueOnce(new Error('injected note failure'));
    expect(await records.saveNote({ id: 'snapshot-note', clientId: 'client-a', expectedRevision: 2,
      value: noteValue({ bodyText: 'must roll back', contactId: 'contact-a' }),
      draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await database.clientProfiles.get('client-a')).toEqual(afterContactRefresh);
    expect(await database.clientNotes.get('snapshot-note')).toEqual(beforeFailedNote);

    const beforeFailedContact = await database.clientContacts.get('contact-a');
    vi.spyOn(database.clientContacts, 'put').mockRejectedValueOnce(new Error('injected contact failure'));
    expect(await records.saveContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 3,
      value: { name: 'Must roll back', role: '', email: '', phone: '' } }))
      .toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await database.clientProfiles.get('client-a')).toEqual(afterContactRefresh);
    expect(await database.clientContacts.get('contact-a')).toEqual(beforeFailedContact);

    await database.clients.delete('client-a');
    expect(await records.getProfile('client-a')).toMatchObject({ ok: true, value: {
      clientSnapshot: secondCanonical, website: 'https://local.example.test',
      description: 'Keep local description', primaryContactId: 'contact-a', revision: 4,
    } });
    expect(await database.clientNotes.get('snapshot-note')).toMatchObject({
      contactSnapshot: { name: 'Ada Lovelace', email: 'ada@example.test' },
    });
  });

  it('rolls back the profile and actor when the note write fails', async () => {
    const { database, records } = await createRecordsFixture();
    vi.spyOn(database.clientNotes, 'put').mockRejectedValueOnce(new Error('injected note write failure'));

    const result = await records.saveNote({
      id: 'note-rollback', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null,
    });

    expect(result).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await database.clientProfiles.get('client-a')).toBeUndefined();
    expect(await database.clientNotes.get('note-rollback')).toBeUndefined();
    expect(await database.settings.get('clientsV1Actor')).toBeUndefined();
  });

  it('keeps drafts monotonic per edit session and discards only matching draft attachments', async () => {
    const { database, records } = await createRecordsFixture();
    const value = noteValue();
    await records.saveNote({ id: 'note-draft', clientId: 'client-a', expectedRevision: null,
      value, draftId: null, generation: null, editSessionId: null });
    const first = makeNoteDraft({ id: 'draft-1', recordId: 'note-draft', value, generation: 1, baseRevision: 1 });
    expect(await records.saveDraft(first)).toMatchObject({ ok: true, value: { generation: 1 } });
    const returnedDraft = await records.getDraft('draft-1');
    expect(returnedDraft).toMatchObject({ ok: true, value: first });
    if (!returnedDraft.ok || !returnedDraft.value || returnedDraft.value.kind !== 'note') {
      throw new Error('Draft was not readable');
    }
    returnedDraft.value.value.bodyText = 'Mutated result';
    expect(await records.getDraft('draft-1')).toMatchObject({ ok: true, value: { value: { bodyText: 'Plain text note' } } });

    expect((await records.addAttachment({ id: 'note-attachment-kept', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-draft', file: testFile('kept.txt', 'note bytes') })).ok).toBe(true);

    const file = await records.addAttachment({
      id: 'draft-attachment', clientId: 'client-a', ownerType: 'draft', ownerId: 'draft-1', file: testFile(),
    });
    expect(file.ok).toBe(true);
    const newer = makeNoteDraft({ id: 'draft-1', recordId: 'note-draft', value: noteValue({ bodyText: 'newer' }),
      generation: 2, baseRevision: 1 });
    expect(await records.saveDraft(newer)).toMatchObject({ ok: true, value: { generation: 2 } });
    expect(await records.saveDraft(first)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await records.saveDraft(makeNoteDraft({ id: 'draft-1', recordId: 'note-draft', value,
      generation: 3, baseRevision: 1, editSessionId: 'session-b' }))).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await records.discardDraft({ id: 'draft-1', editSessionId: 'session-a', generation: 1 }))
      .toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await records.discardDraft({ id: 'draft-1', editSessionId: 'session-a', generation: 2 }))
      .toMatchObject({ ok: true });
    expect(await database.clientDrafts.get('draft-1')).toBeUndefined();
    expect(await database.clientAttachments.get('draft-attachment')).toBeUndefined();
    expect(await database.clientAttachments.get('note-attachment-kept')).toMatchObject({ ownerType: 'note' });
  });

  it('uses stable attachment IDs, enforces owner boundaries, and removes idempotently', async () => {
    const { database, records } = await createRecordsFixture();
    const note = await records.saveNote({
      id: 'note-attachment', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null,
    });
    expect(note.ok).toBe(true);
    const firstFile = testFile('same.txt', 'same bytes');
    const first = await records.addAttachment({
      id: 'attachment-1', clientId: 'client-a', ownerType: 'note', ownerId: 'note-attachment', file: firstFile,
    });
    const retry = await records.addAttachment({
      id: 'attachment-1', clientId: 'client-a', ownerType: 'note', ownerId: 'note-attachment',
      file: testFile('same.txt', 'same bytes'),
    });
    expect(first).toMatchObject({ ok: true, value: { id: 'attachment-1', ownerId: 'note-attachment' } });
    expect(retry).toMatchObject({ ok: true, value: { id: 'attachment-1' } });
    expect(await database.clientAttachments.count()).toBe(1);
    expect(await records.addAttachment({
      id: 'attachment-1', clientId: 'client-a', ownerType: 'note', ownerId: 'note-attachment',
      file: testFile('same.txt', 'different bytes'),
    })).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await records.addAttachment({
      id: 'attachment-foreign', clientId: 'client-b', ownerType: 'note', ownerId: 'note-attachment',
      file: testFile(),
    })).toMatchObject({ ok: false, code: 'CONFLICT' });

    const listed = await records.listAttachments({ ownerType: 'note', ownerId: 'note-attachment' });
    expect(listed).toMatchObject({ ok: true, value: [{ id: 'attachment-1', bytes: 10, mime: 'text/plain' }] });
    expect(await records.removeAttachment({
      id: 'attachment-1', clientId: 'client-b', ownerType: 'note', ownerId: 'note-attachment',
    })).toMatchObject({ ok: false });
    expect(await database.clientAttachments.get('attachment-1')).toBeDefined();
    expect(await records.removeAttachment({
      id: 'attachment-1', clientId: 'client-a', ownerType: 'note', ownerId: 'note-attachment',
    })).toMatchObject({ ok: true });
    expect(await records.removeAttachment({
      id: 'attachment-1', clientId: 'client-a', ownerType: 'note', ownerId: 'note-attachment',
    })).toMatchObject({ ok: true });
    expect(await database.clientAttachments.get('attachment-1')).toBeUndefined();
  });

  it('linearizes same-ID attachment retries against the current immutable Blob snapshot', async () => {
    const { database } = await createRecordsFixture();
    const records = createClientRecords(database, () => 10_000);
    expect(await records.saveNote({ id: 'note-aba', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: true });
    const owner = { id: 'attachment-aba', clientId: 'client-a', ownerType: 'note' as const, ownerId: 'note-aba' };
    const original = await records.addAttachment({ ...owner, file: testFile('same.txt', 'AAA') });
    expect(original).toMatchObject({ ok: true });

    let enterComparison!: () => void;
    let releasePreparation!: () => void;
    const entered = new Promise<void>((resolve) => { enterComparison = resolve; });
    const gate = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const retryFile = testFile('same.txt', 'AAA');
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async function (this: Blob) {
      if (this === retryFile) {
        enterComparison();
        await gate;
      }
      return nativeArrayBuffer.call(this);
    });

    const pending = records.addAttachment({ ...owner, file: retryFile });
    await entered;
    expect(await records.removeAttachment(owner)).toMatchObject({ ok: true });
    const replacement = await records.addAttachment({ ...owner, file: testFile('same.txt', 'BBB') });
    expect(replacement).toMatchObject({ ok: true, value: {
      displayName: 'same.txt', mime: 'text/plain', bytes: 3, createdAt: original.ok ? original.value.createdAt : -1,
    } });
    releasePreparation();

    expect(await pending).toMatchObject({ ok: false, code: 'CONFLICT' });
    const stored = await database.clientAttachments.get(owner.id);
    expect(stored).toMatchObject({ bytes: 3, createdAt: original.ok ? original.value.createdAt : -1 });
    expect(await stored?.data.text()).toBe('BBB');
  });

  it('returns the original immutable retry snapshot if replacement linearizes after its read', async () => {
    const { database } = await createRecordsFixture();
    const records = createClientRecords(database, () => 10_000);
    expect(await records.saveNote({ id: 'note-aba-snapshot', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: true });
    const owner = { id: 'attachment-aba-snapshot', clientId: 'client-a', ownerType: 'note' as const,
      ownerId: 'note-aba-snapshot' };
    expect(await records.addAttachment({ ...owner, file: testFile('same.txt', 'AAA') })).toMatchObject({ ok: true });

    let enterComparison!: () => void;
    let releaseComparison!: () => void;
    let paused = false;
    const entered = new Promise<void>((resolve) => { enterComparison = resolve; });
    const gate = new Promise<void>((resolve) => { releaseComparison = resolve; });
    const retryFile = testFile('same.txt', 'AAA');
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async function (this: Blob) {
      if (!(this instanceof File) && !paused) {
        paused = true;
        enterComparison();
        await gate;
      }
      return nativeArrayBuffer.call(this);
    });

    const pending = records.addAttachment({ ...owner, file: retryFile });
    await entered;
    expect(await records.removeAttachment(owner)).toMatchObject({ ok: true });
    expect(await records.addAttachment({ ...owner, file: testFile('same.txt', 'BBB') })).toMatchObject({ ok: true });
    releaseComparison();

    const result = await pending;
    expect(result).toMatchObject({ ok: true, value: { bytes: 3, displayName: 'same.txt' } });
    if (!result.ok) throw new Error('Original retry snapshot was not returned');
    expect(await result.value.data.text()).toBe('AAA');
    expect(await (await database.clientAttachments.get(owner.id))?.data.text()).toBe('BBB');
  });

  it('accepts real empty/exact-limit Files, rejects spoofed and over-limit bytes without mutation', async () => {
    const { database, records } = await createRecordsFixture();
    expect(await records.saveNote({ id: 'note-file-validation', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: true });

    const oversizedBytes = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const lookalike = { name: 'fake.txt', type: 'text/plain', size: 1, slice: () => new Blob([oversizedBytes]) };
    const fakeResult = await Reflect.apply(records.addAttachment, records, [{
      id: 'fake-file', clientId: 'client-a', ownerType: 'note', ownerId: 'note-file-validation', file: lookalike,
    }]);
    expect(fakeResult).toMatchObject({ ok: false, code: 'VALIDATION', field: 'file' });
    expect(await database.clientAttachments.get('fake-file')).toBeUndefined();

    const spoofedRealFile = new File([oversizedBytes], 'spoofed.txt', { type: 'text/plain' });
    Object.defineProperty(spoofedRealFile, 'size', { value: 1 });
    Object.defineProperty(spoofedRealFile, 'slice', { value: () => new Blob(['x']) });
    expect(await records.addAttachment({ id: 'spoofed-real-file', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-file-validation', file: spoofedRealFile }))
      .toMatchObject({ ok: false, code: 'LIMIT', field: 'file' });
    expect(await database.clientAttachments.get('spoofed-real-file')).toBeUndefined();

    const empty = new File([], 'empty.txt', { type: 'text/plain' });
    const exactBytes = new Uint8Array(MAX_ATTACHMENT_BYTES);
    exactBytes[MAX_ATTACHMENT_BYTES - 1] = 123;
    const exact = new File([exactBytes], 'exact.bin', { type: 'application/octet-stream' });
    expect(await records.addAttachment({ id: 'empty-file', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-file-validation', file: empty })).toMatchObject({ ok: true, value: { bytes: 0 } });
    expect(await records.addAttachment({ id: 'exact-file', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-file-validation', file: exact })).toMatchObject({
      ok: true, value: { bytes: MAX_ATTACHMENT_BYTES },
    });
    expect(await records.addAttachment({ id: 'over-limit-file', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-file-validation', file: new File([oversizedBytes], 'over.txt', { type: 'text/plain' }) }))
      .toMatchObject({ ok: false, code: 'LIMIT', field: 'file' });
    expect(await database.clientAttachments.count()).toBe(2);
    const listed = await records.listAttachments({ ownerType: 'note', ownerId: 'note-file-validation' });
    expect(listed).toMatchObject({ ok: true, value: [
      { id: 'empty-file', bytes: 0 }, { id: 'exact-file', bytes: MAX_ATTACHMENT_BYTES },
    ] });
    if (!listed.ok) throw new Error('Attachments were not listed');
    expect(listed.value.find((row) => row.id === 'exact-file')?.data.size).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('keeps concurrent same-ID same-byte attachment creation idempotent', async () => {
    const { database, records } = await createRecordsFixture();
    expect(await records.saveNote({ id: 'note-concurrent-attachment', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: true });
    const input = { id: 'concurrent-attachment', clientId: 'client-a', ownerType: 'note' as const,
      ownerId: 'note-concurrent-attachment' };
    const [first, second] = await Promise.all([
      records.addAttachment({ ...input, file: testFile('same.txt', 'same concurrent bytes') }),
      records.addAttachment({ ...input, file: testFile('same.txt', 'same concurrent bytes') }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await database.clientAttachments.count()).toBe(1);
    expect(await (await database.clientAttachments.get(input.id))?.data.text()).toBe('same concurrent bytes');
  });

  it('enforces the per-owner attachment count and per-file byte limit', async () => {
    const { records } = await createRecordsFixture();
    const note = await records.saveNote({
      id: 'note-max-attachments', clientId: 'client-a', expectedRevision: null,
      value: noteValue(), draftId: null, generation: null, editSessionId: null,
    });
    expect(note.ok).toBe(true);
    for (let index = 0; index < 5; index += 1) {
      expect((await records.addAttachment({ id: `max-${index}`, clientId: 'client-a', ownerType: 'note',
        ownerId: 'note-max-attachments', file: testFile(`${index}.txt`, `${index}`) })).ok).toBe(true);
    }
    expect(await records.addAttachment({ id: 'max-overflow', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-max-attachments', file: testFile('overflow.txt', 'x') }))
      .toMatchObject({ ok: false, code: 'LIMIT' });
    expect(await records.addAttachment({ id: 'too-large', clientId: 'client-a', ownerType: 'note',
      ownerId: 'note-max-attachments', file: testFile('large.txt', 'x'.repeat(10 * 1024 * 1024 + 1)) }))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('atomically moves matching draft attachments to a note and rejects an over-limit combined owner', async () => {
    const { database, records } = await createRecordsFixture();
    const value = noteValue();
    const staleDraft = makeNoteDraft({ id: 'draft-stale', recordId: 'note-stale', value, generation: 4 });
    await records.saveDraft(staleDraft);
    await records.addAttachment({ id: 'stale-draft-attachment', clientId: 'client-a', ownerType: 'draft',
      ownerId: 'draft-stale', file: testFile('stale.txt', 'keep') });
    expect(await records.saveNote({
      id: 'note-stale', clientId: 'client-a', expectedRevision: null,
      value, draftId: 'draft-stale', generation: 3, editSessionId: 'session-a',
    })).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientNotes.get('note-stale')).toBeUndefined();
    expect(await database.clientDrafts.get('draft-stale')).toMatchObject({ generation: 4 });
    expect(await database.clientAttachments.get('stale-draft-attachment')).toMatchObject({
      ownerType: 'draft', ownerId: 'draft-stale',
    });

    const draft = makeNoteDraft({ id: 'draft-move', recordId: 'note-move', value });
    expect((await records.saveDraft(draft)).ok).toBe(true);
    await records.addAttachment({ id: 'move-attachment', clientId: 'client-a', ownerType: 'draft',
      ownerId: 'draft-move', file: testFile('move.txt', 'move') });
    const saved = await records.saveNote({
      id: 'note-move', clientId: 'client-a', expectedRevision: null,
      value, draftId: 'draft-move', generation: 1, editSessionId: 'session-a',
    });
    expect(saved).toMatchObject({ ok: true, value: { id: 'note-move', revision: 1 } });
    expect(await database.clientDrafts.get('draft-move')).toBeUndefined();
    expect(await database.clientAttachments.get('move-attachment')).toMatchObject({
      ownerType: 'note', ownerId: 'note-move', clientId: 'client-a',
    });

    const limited = await records.saveNote({
      id: 'note-limit', clientId: 'client-a', expectedRevision: null,
      value, draftId: null, generation: null, editSessionId: null,
    });
    expect(limited.ok).toBe(true);
    if (!limited.ok) throw new Error('Limit-test note was not created');
    for (let index = 0; index < 5; index += 1) {
      expect((await records.addAttachment({
        id: `note-limit-${index}`, clientId: 'client-a', ownerType: 'note', ownerId: 'note-limit', file: testFile(),
      })).ok).toBe(true);
    }
    const limitDraft = makeNoteDraft({ id: 'draft-limit', recordId: 'note-limit', value,
      generation: 2, baseRevision: limited.value.revision });
    await records.saveDraft(limitDraft);
    await records.addAttachment({ id: 'draft-limit-attachment', clientId: 'client-a', ownerType: 'draft',
      ownerId: 'draft-limit', file: testFile() });
    expect(await records.saveNote({
      id: 'note-limit', clientId: 'client-a', expectedRevision: limited.value.revision,
      value, draftId: 'draft-limit', generation: 2, editSessionId: 'session-a',
    })).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(await database.clientDrafts.get('draft-limit')).toBeDefined();
    expect(await database.clientAttachments.get('draft-limit-attachment')).toMatchObject({ ownerType: 'draft' });
    expect(await database.clientNotes.get('note-limit')).toMatchObject({ revision: 1 });
  });

  it('creates one stable actor across concurrent note writes and database reopen', async () => {
    const { database, records } = await createRecordsFixture();
    const [first, second] = await Promise.all([
      records.saveNote({ id: 'note-actor-a', clientId: 'client-a', expectedRevision: null,
        value: noteValue(), draftId: null, generation: null, editSessionId: null }),
      records.saveNote({ id: 'note-actor-b', clientId: 'client-a', expectedRevision: null,
        value: noteValue({ title: 'Concurrent note' }), draftId: null, generation: null, editSessionId: null }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Concurrent notes were not saved');
    expect(first.value.authorId).toBe(second.value.authorId);
    const actorId = first.value.authorId;
    expect(await database.settings.get('clientsV1Actor')).toEqual({ key: 'clientsV1Actor', value: actorId });

    const reopened = await reopenRecordsDatabase(database);
    const reopenedRecords = createClientRecords(reopened, () => 30_000);
    const third = await reopenedRecords.saveNote({ id: 'note-actor-c', clientId: 'client-a', expectedRevision: null,
      value: noteValue({ title: 'After reopen' }), draftId: null, generation: null, editSessionId: null });
    expect(third).toMatchObject({ ok: true, value: { authorId: actorId } });
    expect(await reopened.settings.get('clientsV1Actor')).toEqual({ key: 'clientsV1Actor', value: actorId });
  });

  it('filters note history by plain-text query, deletion/archive state, and stable occurred-time order', async () => {
    const { database, records } = await createRecordsFixture();
    await Promise.all([
      records.saveNote({ id: 'note-c', clientId: 'client-a', expectedRevision: null,
        value: noteValue({ title: 'Needle third', occurredAt: 200 }), draftId: null, generation: null, editSessionId: null }),
      records.saveNote({ id: 'note-a', clientId: 'client-a', expectedRevision: null,
        value: noteValue({ bodyText: 'Needle first', occurredAt: 300 }), draftId: null, generation: null, editSessionId: null }),
      records.saveNote({ id: 'note-b', clientId: 'client-a', expectedRevision: null,
        value: noteValue({ title: 'Needle second', occurredAt: 300 }), draftId: null, generation: null, editSessionId: null }),
    ]);
    await database.clients.add({ id: 'general-client', name: 'General', color: '#000000', createdAt: 1, order: 2 });
    await records.saveNote({ id: 'note-deleted', clientId: 'client-b', expectedRevision: null,
      value: noteValue({ title: 'Needle deleted', occurredAt: 400 }), draftId: null, generation: null, editSessionId: null });
    await records.setNoteDeleted({ id: 'note-deleted', clientId: 'client-b', expectedRevision: 1, deleted: true });

    expect(await records.listNotes({ clientId: 'client-a', deleted: false, archived: false, query: 'NEEDLE' }))
      .toMatchObject({ ok: true, value: [{ id: 'note-a' }, { id: 'note-b' }, { id: 'note-c' }] });
    expect(await records.listNotes({ clientId: null, deleted: true, archived: false, query: 'needle' }))
      .toMatchObject({ ok: true, value: [{ id: 'note-deleted' }] });
    expect(await records.listNotes({ clientId: null, deleted: false, archived: true, query: '' }))
      .toMatchObject({ ok: true, value: [] });
  });
});
