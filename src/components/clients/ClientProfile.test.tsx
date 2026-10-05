import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../types';
import { createClientRecords } from '../../services/clients/records';
import { createRecordsFixture, cleanupRecordsFixtures, reopenRecordsDatabase } from '../../services/clients/recordsTestFixtures';
import type { RecordsFixture } from '../../services/clients/recordsTestFixtures';
import { ClientProfile } from './ClientProfile';
import { useClientStore } from '../../stores/clientStore';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import i18n from '../../i18n';

const persistClientUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
vi.mock('../../services/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/db')>(),
  db: { clients: { update: persistClientUpdate }, settings: { put: vi.fn().mockResolvedValue(undefined) } },
}));

let fixture: RecordsFixture;
let clients: Client[];

beforeEach(async () => {
  fixture = await createRecordsFixture();
  clients = await fixture.database.clients.toArray();
  persistClientUpdate.mockImplementation(async (id: string, updates: Partial<Pick<Client, 'name' | 'color'>>) => {
    await fixture.database.clients.update(id, updates);
    return 1;
  });
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
  useClientStore.setState({ ...useClientStore.getInitialState(), clients, isLoaded: true });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
  await cleanupRecordsFixtures();
});

describe('ClientProfile', () => {
  it('loads real profile and people records and keeps canonical and local saves distinct', async () => {
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: 'https://northwind.example', description: 'Existing local details' } });
    await fixture.records.saveContact({ id: 'person-a', clientId: 'client-a', expectedRevision: null,
      value: { name: 'Ada Lovelace', role: 'Lead', email: '', phone: '' } });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);

    expect(await screen.findByText('Existing local details')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit local profile' }));
    await user.clear(screen.getByLabelText('Website'));
    await user.type(screen.getByLabelText('Website'), 'https://updated.example');
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Updated local details');
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { website: 'https://updated.example', description: 'Updated local details' },
    }));

    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), 'Northwind New');
    fireEvent.change(screen.getByLabelText('Client color'), { target: { value: '#abcdef' } });
    await user.click(screen.getByRole('button', { name: 'Save client details' }));
    await waitFor(() => expect(persistClientUpdate).toHaveBeenCalledWith('client-a', { name: 'Northwind New', color: '#abcdef' }));
    expect(await screen.findByText('Client directory saved')).toBeInTheDocument();
    expect(useClientStore.getState().clients[0]).toMatchObject({ name: 'Northwind New', color: '#abcdef' });
    expect((await fixture.database.clientProfiles.get('client-a'))?.description).toBe('Updated local details');
    expect((await fixture.database.clientProfiles.get('client-a'))?.clientSnapshot.name).toBe('Northwind New');
  });

  it('never shows a late A profile in B after the selected client changes', async () => {
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: 'https://a.example', description: 'A-only details' } });
    await fixture.records.saveProfile({ clientId: 'client-b', expectedRevision: null,
      value: { website: 'https://b.example', description: 'B-only details' } });
    const { rerender } = render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    rerender(<ClientProfile client={clients[1]} records={fixture.records} database={fixture.database} />);

    expect(await screen.findByText('B-only details')).toBeInTheDocument();
    expect(screen.queryByText('A-only details')).not.toBeInTheDocument();
  });

  it('keeps an invalid local profile draft visible, retries it, and saves once corrected', async () => {
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    expect(await screen.findByText('No local profile details yet.')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    const website = screen.getByLabelText('Website');
    await user.type(website, 'not a valid website');
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(website).toHaveValue('not a valid website');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByLabelText('Website')).toHaveValue('not a valid website');

    await user.clear(screen.getByLabelText('Website'));
    await user.type(screen.getByLabelText('Website'), 'https://valid.example.test');
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { website: 'https://valid.example.test' },
    }));
  });

  it('creates a person with empty optional fields, sets and clears primary, and confirms only the target before soft delete', async () => {
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Add person' }));
    await user.type(screen.getByLabelText('Name'), 'Lin Q');
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(async () => expect(await fixture.records.listContacts('client-a')).toMatchObject({
      ok: true, value: [expect.objectContaining({ name: 'Lin Q', role: '', email: '', phone: '' })],
    }));

    await user.click(await screen.findByRole('button', { name: 'Edit person: Lin Q' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Lin Q Edited');
    await waitFor(async () => expect(await fixture.records.listContacts('client-a')).toMatchObject({
      ok: true, value: [expect.objectContaining({ name: 'Lin Q Edited', role: '', email: '', phone: '' })],
    }));

    await user.click(await screen.findByRole('button', { name: 'Make primary: Lin Q Edited' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: expect.any(String) },
    }));
    await user.click(await screen.findByRole('button', { name: 'Clear primary contact' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: null },
    }));

    await fixture.seedContacts();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Delete person: Ada Lovelace' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Ada Lovelace');
    expect(dialog).not.toHaveTextContent('Grace Hopper');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await fixture.records.listContacts('client-a')).toMatchObject({
      ok: true, value: [expect.objectContaining({ name: 'Lin Q Edited' })],
    }));
    expect(await fixture.database.clientContacts.get('contact-a')).toHaveProperty('deletedAt');
  });

  it('keeps an open local profile durable across a same-screen primary change and same-database reopen', async () => {
    await fixture.seedContacts();
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'Initial local details' } });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Saved before primary' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { description: 'Saved before primary', revision: 2 },
    }), { timeout: 4000 });

    await user.click(screen.getByRole('button', { name: 'Make primary: Ada Lovelace' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: 'contact-a', revision: 3 },
    }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'After primary must survive' } });
    const draftId = JSON.stringify(['client-a', 'profile', 'client-a']);
    await waitFor(() => {
      const state = useClientDetailsStore.getState().saveStates[draftId];
      expect(state?.status).not.toBe('idle');
    }, { timeout: 3000 });
    await waitFor(() => {
      const state = useClientDetailsStore.getState().saveStates[draftId];
      expect(state?.status).not.toBe('saving');
    }, { timeout: 3000 });

    cleanup();
    useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
    const reopened = await reopenRecordsDatabase(fixture.database);
    fixture = { ...fixture, database: reopened, records: createClientRecords(reopened) };
    const reopenedClient = await reopened.clients.get('client-a');
    if (!reopenedClient) throw new Error('Expected the reopened client fixture');
    render(<ClientProfile client={reopenedClient} records={fixture.records} database={reopened} />);

    expect(await screen.findByText('After primary must survive', {}, { timeout: 1500 })).toBeInTheDocument();
    expect(await reopened.clientProfiles.get('client-a')).toMatchObject({
      primaryContactId: 'contact-a', description: 'After primary must survive',
    });
  });

  it('keeps profile edits durable through clearing a primary contact', async () => {
    await fixture.seedContacts();
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'Initial local details' } });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Saved before clear' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { description: 'Saved before clear', revision: 2 },
    }), { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Make primary: Ada Lovelace' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: 'contact-a', revision: 3 },
    }));

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Before clear remains' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { description: 'Before clear remains', revision: 4 },
    }), { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Clear primary contact' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: null, description: 'Before clear remains', revision: 5 },
    }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'After clear survives' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: null, description: 'After clear survives', revision: 6 },
    }), { timeout: 4000 });
  });

  it('keeps profile edits durable through deleting the primary and reopening the same database', async () => {
    await fixture.seedContacts();
    await fixture.records.saveContact({ id: 'contact-grace', clientId: 'client-a', expectedRevision: null,
      value: { name: 'Grace Hopper', role: 'Engineer', email: '', phone: '' } });
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'Initial local details' } });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Before primary delete' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { description: 'Before primary delete', revision: 2 },
    }), { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Make primary: Grace Hopper' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: 'contact-grace', revision: 3 },
    }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Saved before delete' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { description: 'Saved before delete', revision: 4 },
    }), { timeout: 4000 });

    await user.click(screen.getByRole('button', { name: 'Delete person: Grace Hopper' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: null, description: 'Saved before delete', revision: 5 },
    }));
    expect(await fixture.database.clientContacts.get('contact-grace')).toHaveProperty('deletedAt');
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'After delete survives' } });
    await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
      ok: true, value: { primaryContactId: null, description: 'After delete survives', revision: 6 },
    }), { timeout: 4000 });

    cleanup();
    useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
    const reopened = await reopenRecordsDatabase(fixture.database);
    expect(await reopened.clientProfiles.get('client-a')).toMatchObject({
      primaryContactId: null, description: 'After delete survives',
    });
    expect(await reopened.clientContacts.get('contact-grace')).toHaveProperty('deletedAt');
  });

  it('persists a newer edit after a delayed primary mutation without leaking A state into B', async () => {
    await fixture.seedContacts();
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'A initial' } });
    await fixture.records.saveProfile({ clientId: 'client-b', expectedRevision: null,
      value: { website: '', description: 'B initial' } });
    const nativeSetPrimary = fixture.records.setPrimaryContact.bind(fixture.records);
    let announceCommitted: () => void = () => {};
    let releaseMutation: () => void = () => {};
    const committed = new Promise<void>((resolve) => { announceCommitted = resolve; });
    const held = new Promise<void>((resolve) => { releaseMutation = resolve; });
    vi.spyOn(fixture.records, 'setPrimaryContact').mockImplementation(async (input) => {
      const result = await nativeSetPrimary(input);
      announceCommitted();
      await held;
      return result;
    });
    const user = userEvent.setup();
    const { rerender } = render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    try {
      await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A saved before primary' } });
      await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
        ok: true, value: { description: 'A saved before primary', revision: 2 },
      }), { timeout: 4000 });
      await user.click(screen.getByRole('button', { name: 'Make primary: Ada Lovelace' }));
      await committed;
      await waitFor(() => expect(Object.keys(useClientDetailsStore.getState().profileRevisionMutations)).toContain(
        JSON.stringify(['client-a', 'profile', 'client-a']),
      ));

      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A typed during primary' } });
      rerender(<ClientProfile client={clients[1]} records={fixture.records} database={fixture.database} />);
      expect(await screen.findByText('B initial')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Edit local profile' }));
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'B independent edit' } });
      await waitFor(async () => expect(await fixture.records.getProfile('client-b')).toMatchObject({
        ok: true, value: { description: 'B independent edit', revision: 2 },
      }), { timeout: 4000 });

      releaseMutation();
      await waitFor(async () => expect(await fixture.records.getProfile('client-a')).toMatchObject({
        ok: true, value: { primaryContactId: 'contact-a', description: 'A typed during primary', revision: 4 },
      }), { timeout: 5000 });
      expect(await fixture.records.getProfile('client-b')).toMatchObject({
        ok: true, value: { description: 'B independent edit', revision: 2 },
      });
      rerender(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
      expect(await screen.findByText('A typed during primary')).toBeInTheDocument();
    } finally {
      releaseMutation();
    }

    cleanup();
    useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
    const reopened = await reopenRecordsDatabase(fixture.database);
    expect(await reopened.clientProfiles.get('client-a')).toMatchObject({
      primaryContactId: 'contact-a', description: 'A typed during primary',
    });
    expect((await reopened.clientProfiles.get('client-b'))?.description).toBe('B independent edit');
  });

  it('recovers a real external revision conflict and requires an explicit keep-or-reload choice', async () => {
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'Before external update' } });
    const nativeSaveProfile = fixture.records.saveProfile.bind(fixture.records);
    let causedExternalUpdate = false;
    vi.spyOn(fixture.records, 'saveProfile').mockImplementation(async (input) => {
      if (input.draftAck && !causedExternalUpdate) {
        causedExternalUpdate = true;
        await nativeSaveProfile({ clientId: 'client-a', expectedRevision: 1,
          value: { website: '', description: 'External saved value' } });
      }
      return nativeSaveProfile(input);
    });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Local value to recover' } });
    await waitFor(async () => expect(await fixture.database.clientDrafts.toArray()).toEqual([
      expect.objectContaining({ value: { website: '', description: 'Local value to recover' }, baseRevision: 1 }),
    ]), { timeout: 4000 });
    await screen.findByText('Save failed');
    expect(screen.getByLabelText('Description')).toHaveValue('Local value to recover');
    expect((await fixture.database.clientProfiles.get('client-a'))?.description).toBe('External saved value');
    expect(screen.getByRole('button', { name: 'Keep my edits and retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use latest saved profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    vi.restoreAllMocks();
    cleanup();
    useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
    const reopened = await reopenRecordsDatabase(fixture.database);
    fixture = { ...fixture, database: reopened, records: createClientRecords(reopened) };
    const reopenedClient = await reopened.clients.get('client-a');
    if (!reopenedClient) throw new Error('Expected the reopened client fixture');
    render(<ClientProfile client={reopenedClient} records={fixture.records} database={reopened} />);
    expect(await screen.findByLabelText('Description')).toHaveValue('Local value to recover');
    expect((await reopened.clientProfiles.get('client-a'))?.description).toBe('External saved value');
    await user.click(await screen.findByRole('button', { name: 'Keep my edits and retry' }, { timeout: 1500 }));
    await waitFor(async () => expect(await reopened.clientProfiles.get('client-a')).toMatchObject({
      description: 'Local value to recover',
    }), { timeout: 4000 });
    expect((await reopened.clientProfiles.get('client-a'))?.clientSnapshot.name).toBe('Brand A');
  });

  it('discards only the conflicted local profile when the user chooses the latest saved value', async () => {
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'Before external update' } });
    const nativeSaveProfile = fixture.records.saveProfile.bind(fixture.records);
    let causedExternalUpdate = false;
    vi.spyOn(fixture.records, 'saveProfile').mockImplementation(async (input) => {
      if (input.draftAck && !causedExternalUpdate) {
        causedExternalUpdate = true;
        await nativeSaveProfile({ clientId: 'client-a', expectedRevision: 1,
          value: { website: '', description: 'External saved value' } });
      }
      return nativeSaveProfile(input);
    });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Local value to discard' } });
    await screen.findByRole('button', { name: 'Use latest saved profile' });
    await user.click(screen.getByRole('button', { name: 'Use latest saved profile' }));
    expect(await screen.findByText('External saved value')).toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(await fixture.database.clientDrafts.get(JSON.stringify(['client-a', 'profile', 'client-a'])))
      .toBeUndefined();
    expect((await fixture.database.clientProfiles.get('client-a'))?.description).toBe('External saved value');
  });

  it('does not overwrite a second external revision during explicit conflict resolution', async () => {
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: '', description: 'Before external update' } });
    const nativeSaveProfile = fixture.records.saveProfile.bind(fixture.records);
    let causedFirstExternalUpdate = false;
    let causedResolutionRace = false;
    vi.spyOn(fixture.records, 'saveProfile').mockImplementation(async (input) => {
      if (input.draftAck && !causedFirstExternalUpdate) {
        causedFirstExternalUpdate = true;
        await nativeSaveProfile({ clientId: 'client-a', expectedRevision: 1,
          value: { website: '', description: 'External saved value' } });
      } else if (causedFirstExternalUpdate && !causedResolutionRace) {
        causedResolutionRace = true;
        await nativeSaveProfile({ clientId: 'client-a', expectedRevision: 2,
          value: { website: '', description: 'Second external saved value' } });
      }
      return nativeSaveProfile(input);
    });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Local value to preserve' } });
    await screen.findByRole('button', { name: 'Keep my edits and retry' });
    await user.click(screen.getByRole('button', { name: 'Keep my edits and retry' }));
    await waitFor(async () => expect(await fixture.database.clientProfiles.get('client-a')).toMatchObject({
      description: 'Second external saved value', revision: 3,
    }), { timeout: 4000 });
    expect(causedResolutionRace).toBe(true);
    expect(screen.getByLabelText('Description')).toHaveValue('Local value to preserve');
    expect(await fixture.database.clientDrafts.get(JSON.stringify(['client-a', 'profile', 'client-a'])))
      .toMatchObject({ value: { website: '', description: 'Local value to preserve' }, baseRevision: 1 });
    expect(screen.getByRole('button', { name: 'Keep my edits and retry' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use latest saved profile' }));
    expect(await screen.findByText('Second external saved value')).toBeInTheDocument();
    expect(await fixture.database.clientDrafts.get(JSON.stringify(['client-a', 'profile', 'client-a'])))
      .toBeUndefined();
  });

  it('recovers invalid profile text across reopen before explicitly saving a corrected value', async () => {
    await fixture.records.saveProfile({ clientId: 'client-a', expectedRevision: null,
      value: { website: 'https://before.example', description: 'Initial details' } });
    const nativeSaveProfile = fixture.records.saveProfile.bind(fixture.records);
    let causedExternalUpdate = false;
    vi.spyOn(fixture.records, 'saveProfile').mockImplementation(async (input) => {
      if (input.draftAck && !causedExternalUpdate) {
        causedExternalUpdate = true;
        await nativeSaveProfile({ clientId: 'client-a', expectedRevision: 1,
          value: { website: 'https://external.example', description: 'External details' } });
      }
      return nativeSaveProfile(input);
    });
    const user = userEvent.setup();
    render(<ClientProfile client={clients[0]} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit local profile' }));
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'not a valid website' } });
    await waitFor(async () => expect(await fixture.database.clientDrafts.get(
      JSON.stringify(['client-a', 'profile', 'client-a']),
    )).toMatchObject({ value: { website: 'not a valid website', description: 'Initial details' }, baseRevision: 1 }),
    { timeout: 4000 });
    await screen.findByText('Save failed');
    expect((await fixture.database.clientProfiles.get('client-a'))?.website).toBe('https://external.example');

    vi.restoreAllMocks();
    cleanup();
    useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
    const reopened = await reopenRecordsDatabase(fixture.database);
    fixture = { ...fixture, database: reopened, records: createClientRecords(reopened) };
    const reopenedClient = await reopened.clients.get('client-a');
    if (!reopenedClient) throw new Error('Expected the reopened client fixture');
    render(<ClientProfile client={reopenedClient} records={fixture.records} database={reopened} />);
    expect(await screen.findByLabelText('Website')).toHaveValue('not a valid website');
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('button', { name: 'Keep my edits and retry' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://corrected.example.test' } });
    await screen.findByRole('button', { name: 'Keep my edits and retry' });
    await user.click(screen.getByRole('button', { name: 'Keep my edits and retry' }));
    await waitFor(async () => expect(await reopened.clientProfiles.get('client-a')).toMatchObject({
      website: 'https://corrected.example.test', description: 'Initial details',
    }), { timeout: 4000 });
    expect(await reopened.clientDrafts.get(JSON.stringify(['client-a', 'profile', 'client-a'])))
      .toBeUndefined();
  });
});
