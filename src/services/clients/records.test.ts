// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupRecordsFixtures, createRecordsFixture } from './recordsTestFixtures';

afterEach(cleanupRecordsFixtures);

describe('client records profiles', () => {
  it('preserves the canonical client and creates one extension record', async () => {
    const { database, records } = await createRecordsFixture();
    const canonicalBefore = await database.clients.get('client-a');

    expect(await records.getProfile('client-a')).toEqual({ ok: true, value: null });
    const saved = await records.saveProfile({
      clientId: 'client-a', expectedRevision: null,
      value: { website: 'https://brand-a.example.test', description: 'Local profile' },
    });

    expect(saved).toMatchObject({
      ok: true,
      value: {
        clientId: 'client-a', clientSnapshot: canonicalBefore,
        website: 'https://brand-a.example.test', description: 'Local profile',
        primaryContactId: null, revision: 1,
      },
    });
    expect(await database.clients.get('client-a')).toEqual(canonicalBefore);
    expect(await database.clientProfiles.count()).toBe(1);
    expect(await database.projects.count()).toBe(0);

    if (!saved.ok) throw new Error('Initial profile was not saved');
    const renamedClient = { ...canonicalBefore!, name: 'Brand A renamed', color: '#abcdef' };
    await database.clients.put(renamedClient);
    const updated = await records.saveProfile({
      clientId: 'client-a', expectedRevision: saved.value.revision,
      value: { website: '', description: 'Fresh canonical snapshot' },
    });
    expect(updated).toMatchObject({ ok: true, value: {
      clientSnapshot: renamedClient, revision: 2, primaryContactId: null,
    } });
    expect(await database.clients.get('client-a')).toEqual(renamedClient);
  });

  it('rejects synthetic General/No Client owners and malformed relation IDs', async () => {
    const { database, records } = await createRecordsFixture();
    await database.clients.bulkAdd([
      { id: 'synthetic-general', name: 'General', color: '#000000', createdAt: 1, order: 2 },
      { id: 'synthetic-none', name: 'No Client', color: '#000000', createdAt: 2, order: 3 },
    ]);
    expect(await records.saveProfile({ clientId: 'synthetic-general', expectedRevision: null,
      value: { website: '', description: '' } })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await records.saveContact({ id: 'contact-none', clientId: 'synthetic-none', expectedRevision: null,
      value: { name: 'Not editable', role: '', email: '', phone: '' } }))
      .toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await records.saveNote({ id: 'note-general', clientId: 'synthetic-general', expectedRevision: null,
      value: { title: 'No', bodyText: '', kind: 'note', occurredAt: 0, contactId: null },
      draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await records.saveNote({ id: 'note-bad-contact', clientId: 'client-a', expectedRevision: null,
      value: { title: 'No', bodyText: '', kind: 'note', occurredAt: 0, contactId: '  ' },
      draftId: null, generation: null, editSessionId: null })).toMatchObject({ ok: false, code: 'VALIDATION', field: 'contactId' });
    expect(await database.clientProfiles.count()).toBe(0);
    expect(await database.clientContacts.count()).toBe(0);
    expect(await database.clientNotes.count()).toBe(0);
  });

  it('does not allow a primary contact from another client and supports clearing it', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();

    const crossClient = await records.setPrimaryContact({
      clientId: 'client-a', contactId: 'contact-b', expectedProfileRevision: null,
    });
    expect(crossClient).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientProfiles.get('client-a')).toBeUndefined();

    const selected = await records.setPrimaryContact({
      clientId: 'client-a', contactId: 'contact-a', expectedProfileRevision: null,
    });
    expect(selected).toMatchObject({ ok: true, value: { primaryContactId: 'contact-a', revision: 1 } });
    if (!selected.ok) throw new Error('Primary contact was not selected');
    selected.value.primaryContactId = 'mutated-result';
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ primaryContactId: 'contact-a' });

    const cleared = await records.setPrimaryContact({
      clientId: 'client-a', contactId: null, expectedProfileRevision: selected.value.revision,
    });
    expect(cleared).toMatchObject({ ok: true, value: { primaryContactId: null, revision: 2 } });
  });

  it('clears a deleted primary contact atomically and rolls back on profile failure', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const selected = await records.setPrimaryContact({
      clientId: 'client-a', contactId: 'contact-a', expectedProfileRevision: null,
    });
    expect(selected.ok).toBe(true);

    const update = vi.spyOn(database.clientProfiles, 'update').mockRejectedValueOnce(new Error('injected'));
    const failed = await records.deleteContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1 });
    expect(failed).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await database.clientContacts.get('contact-a')).not.toHaveProperty('deletedAt');
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ primaryContactId: 'contact-a', revision: 1 });
    update.mockRestore();

    const deleted = await records.deleteContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1 });
    expect(deleted).toMatchObject({ ok: true, value: { deletedAt: expect.any(Number) } });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({ primaryContactId: null, revision: 2 });
  });

  it('serializes stale profile and contact revisions without overwriting the winner', async () => {
    const { database, records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    const profile = await records.saveProfile({
      clientId: 'client-a', expectedRevision: null, value: { website: '', description: 'base' },
    });
    expect(profile.ok).toBe(true);

    const profileSaves = await Promise.all([
      records.saveProfile({ clientId: 'client-a', expectedRevision: 1,
        value: { website: '', description: 'winner A' } }),
      records.saveProfile({ clientId: 'client-a', expectedRevision: 1,
        value: { website: '', description: 'winner B' } }),
    ]);
    expect(profileSaves.filter((result) => result.ok)).toHaveLength(1);
    expect(profileSaves.filter((result) => !result.ok && result.code === 'CONFLICT')).toHaveLength(1);
    const storedProfile = await database.clientProfiles.get('client-a');
    expect(['winner A', 'winner B']).toContain(storedProfile?.description);

    const contactSaves = await Promise.all([
      records.saveContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
        value: { name: 'Ada One', role: 'Analyst', email: '', phone: '' } }),
      records.saveContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1,
        value: { name: 'Ada Two', role: 'Analyst', email: '', phone: '' } }),
    ]);
    expect(contactSaves.filter((result) => result.ok)).toHaveLength(1);
    expect(contactSaves.filter((result) => !result.ok && result.code === 'CONFLICT')).toHaveLength(1);
    const storedContact = await database.clientContacts.get('contact-a');
    expect(['Ada One', 'Ada Two']).toContain(storedContact?.name);
  });

  it('creates a profile with contact writes and returns independent values', async () => {
    const { database, records } = await createRecordsFixture();
    const saved = await records.saveContact({
      id: 'contact-new', clientId: 'client-a', expectedRevision: null,
      value: { name: '  Çağla 李  ', role: ' Analyst ', email: '', phone: ' 555 ' },
    });
    expect(saved).toMatchObject({ ok: true, value: { name: 'Çağla 李', role: 'Analyst', phone: '555' } });
    if (!saved.ok) throw new Error('Contact was not saved');
    saved.value.name = 'Mutated result';
    expect(await database.clientContacts.get('contact-new')).toMatchObject({ name: 'Çağla 李', revision: 1 });
    expect(await database.clientProfiles.get('client-a')).toMatchObject({
      clientSnapshot: { id: 'client-a', name: 'Brand A' }, revision: 1,
    });

    const profile = await records.getProfile('client-a');
    if (!profile.ok || !profile.value) throw new Error('Profile was not readable');
    profile.value.clientSnapshot.name = 'Mutated snapshot';
    expect((await records.getProfile('client-a'))).toMatchObject({
      ok: true, value: { clientSnapshot: { name: 'Brand A' } },
    });
  });

  it('lists only live contacts with case-insensitive name and ID ordering', async () => {
    const { records, seedContacts } = await createRecordsFixture();
    await seedContacts();
    await records.saveContact({ id: 'contact-a-lower', clientId: 'client-a', expectedRevision: null,
      value: { name: 'ada lovelace', role: '', email: '', phone: '' } });
    await records.saveContact({ id: 'contact-z', clientId: 'client-a', expectedRevision: null,
      value: { name: 'Zora Neale Hurston', role: '', email: '', phone: '' } });

    const contacts = await records.listContacts('client-a');
    expect(contacts).toMatchObject({ ok: true, value: [
      { id: 'contact-a', name: 'Ada Lovelace' },
      { id: 'contact-a-lower', name: 'ada lovelace' },
      { id: 'contact-z', name: 'Zora Neale Hurston' },
    ] });
    await records.deleteContact({ id: 'contact-a', clientId: 'client-a', expectedRevision: 1 });
    expect(await records.listContacts('client-a')).toMatchObject({
      ok: true, value: [{ id: 'contact-a-lower' }, { id: 'contact-z' }],
    });
  });
});
