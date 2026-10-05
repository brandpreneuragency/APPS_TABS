import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientNote } from '../../types/clients';
import type { Client } from '../../types';
import { createRecordsFixture, cleanupRecordsFixtures } from '../../services/clients/recordsTestFixtures';
import type { RecordsFixture } from '../../services/clients/recordsTestFixtures';
import { ClientNotes } from './ClientNotes';
import { useClientStore } from '../../stores/clientStore';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import i18n from '../../i18n';
import { saveAs } from 'file-saver';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

let fixture: RecordsFixture;
let clients: Client[];

function makeNote(id: string, index: number, overrides: Partial<ClientNote> = {}): ClientNote {
  return {
    id, clientId: 'client-a', title: `Project update ${String(index).padStart(2, '0')}`,
    bodyText: `Text ${index}`, kind: index % 2 ? 'call' : 'decision', occurredAt: 10_000 + index,
    contactId: null, contactSnapshot: null, pinned: index % 3 === 0, authorId: 'synthetic',
    revision: 1, createdAt: 10_000 + index, updatedAt: 10_000 + index, ...overrides,
  };
}

beforeEach(async () => {
  fixture = await createRecordsFixture();
  clients = await fixture.database.clients.toArray();
  await i18n.changeLanguage('en');
  useClientStore.setState({ ...useClientStore.getInitialState(), clients, isLoaded: true });
  useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
  vi.clearAllMocks();
});

afterEach(async () => {
  cleanup();
  useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
  await cleanupRecordsFixtures();
});

describe('ClientNotes', () => {
  it('filters real notes and loads more than the first 50 without changing stable note identity', async () => {
    await fixture.database.clientNotes.bulkAdd(Array.from({ length: 53 }, (_, index) => makeNote(`note-${index}`, index)));
    render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);

    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(50));
    expect(screen.getByRole('article', { name: 'Project update 52' })).toHaveAttribute('data-note-id', 'note-52');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    expect(screen.getAllByRole('article')).toHaveLength(53);

    fireEvent.click(screen.getByLabelText('Pinned only'));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(18));
    expect(screen.getByRole('article', { name: 'Project update 51' })).toHaveAttribute('data-note-id', 'note-51');
    fireEvent.click(screen.getByLabelText('Pinned only'));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(53));

    fireEvent.change(screen.getByLabelText('Note type'), { target: { value: 'call' } });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(26));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'Project update 51' } });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.getByRole('article', { name: 'Project update 51' })).toHaveAttribute('data-note-id', 'note-51');
  });

  it('keeps note Enter as a newline, recovers the durable draft, and publishes plus exports only on explicit actions', async () => {
    const user = userEvent.setup();
    render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Internal note', { selector: 'p' })).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Title'), 'Planning note');
    await user.type(await screen.findByLabelText('Note text'), 'First line');
    await user.keyboard('{Enter}Second line');
    expect(await fixture.database.clientNotes.count()).toBe(0);
    await waitFor(async () => expect((await fixture.database.clientDrafts.toArray()).some((draft) =>
      draft.kind === 'note' && draft.value.bodyText.includes('First line\nSecond line'))).toBe(true), { timeout: 4000 });

    await user.click(screen.getByRole('button', { name: 'Cancel and keep draft' }));
    await user.click(await screen.findByRole('button', { name: 'Resume note draft: Planning note' }));
    expect(await screen.findByLabelText('Note text')).toHaveValue('First line\nSecond line');
    const file = new File(['<svg onload="alert(1)"></svg>'], 'literal.svg', { type: 'image/svg+xml' });
    await user.upload(await screen.findByLabelText('Add files'), file);
    await waitFor(async () => expect(await fixture.database.clientAttachments.count()).toBe(1));
    const activeDraft = (await fixture.database.clientDrafts.toArray())[0];
    const [draftAttachment] = await fixture.database.clientAttachments.where({
      ownerType: 'draft', ownerId: activeDraft.id,
    }).toArray();
    expect(draftAttachment).toBeDefined();
    if (!draftAttachment) throw new Error('uploaded draft attachment is missing');
    expect(draftAttachment).toMatchObject({ ownerType: 'draft', ownerId: activeDraft.id,
      displayName: 'literal.svg', bytes: file.size, mime: file.type });
    expect(await screen.findByText('literal.svg')).toBeInTheDocument();
    expect(document.querySelector('svg[onload]')).toBeNull();
    expect(saveAs).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('region', { name: 'Attachments' }))
      .getByRole('button', { name: 'Export literal.svg' }));
    expect(saveAs).toHaveBeenCalledOnce();
    await user.click(within(screen.getByRole('region', { name: 'Attachments' }))
      .getByRole('button', { name: 'Remove literal.svg' }));
    await waitFor(async () => expect(await fixture.database.clientAttachments.count()).toBe(0));

    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('article', { name: 'Planning note' })).toBeInTheDocument();
    const published = await fixture.database.clientNotes.toArray();
    expect(published).toHaveLength(1);
    expect(published[0].bodyText).toBe('First line\nSecond line');
    expect(await fixture.database.clientAttachments.count()).toBe(0);
  });

  it('flushes the open session draft on a client switch without showing it in the next client', async () => {
    const { rerender } = render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add note' }));
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Switch-safe draft' } });
    rerender(<ClientNotes clientId="client-b" records={fixture.records} database={fixture.database} />);

    expect(await screen.findByText('No notes for this client yet.')).toBeInTheDocument();
    await waitFor(async () => expect((await fixture.database.clientDrafts.toArray()).some((draft) =>
      draft.kind === 'note' && draft.clientId === 'client-a' && draft.value.title === 'Switch-safe draft')).toBe(true));
    expect(screen.queryByDisplayValue('Switch-safe draft')).not.toBeInTheDocument();
  });

  it('requires a live brand before creating from Everything and never creates in No Client', async () => {
    const user = userEvent.setup();
    render(<ClientNotes clientId={null} records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Add note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a client before creating a note.');
    expect(useClientDetailsStore.getState().drafts).toEqual({});
    await user.selectOptions(screen.getByLabelText('Select a client'), 'client-a');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    expect(Object.values(useClientDetailsStore.getState().drafts)).toEqual([
      expect.objectContaining({ kind: 'note', clientId: 'client-a' }),
    ]);

    cleanup();
    useClientDetailsStore.setState(useClientDetailsStore.getInitialState());
    const noClient: Client = { id: 'general', name: 'General', color: '#777777', createdAt: 1, order: 2 };
    await fixture.database.clients.put(noClient);
    useClientStore.setState({ clients: [...clients, noClient], isLoaded: true });
    render(<ClientNotes clientId="general" records={fixture.records} database={fixture.database} />);
    expect(await screen.findByText('Notes cannot be created without a client.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });

  it('keeps Cancel and confirmed Discard separate for a durable note draft', async () => {
    const user = userEvent.setup();
    render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Add note' }));
    await user.type(await screen.findByLabelText('Title'), 'Discard decision');
    await waitFor(async () => expect((await fixture.database.clientDrafts.toArray()).some((draft) =>
      draft.kind === 'note' && draft.value.title === 'Discard decision')).toBe(true), { timeout: 4000 });

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Discard this saved draft and its attachments? This cannot be undone.');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const confirmDiscard = within(dialog).getByRole('button', { name: 'Discard draft' });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirmDiscard).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(screen.getByRole('button', { name: 'Discard draft' })).toHaveFocus();
    expect(await fixture.database.clientDrafts.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toHaveFocus();
    expect(await fixture.database.clientDrafts.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.tab({ shift: true });
    const confirmButton = within(confirm).getByRole('button', { name: 'Discard draft' });
    expect(confirmButton).toHaveFocus();
    await user.click(confirmButton);
    await waitFor(async () => expect(await fixture.database.clientDrafts.count()).toBe(0));
    expect(await fixture.database.clientNotes.count()).toBe(0);
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('edits the original note/contact IDs and formats occurredAt as local wall time', async () => {
    await fixture.seedContacts();
    const occurredAt = Date.UTC(2024, 2, 9, 15, 7);
    const result = await fixture.records.saveNote({ id: 'stable-note', clientId: 'client-a', expectedRevision: null,
      value: { title: 'Stable meeting', bodyText: 'Keep association', kind: 'meeting', occurredAt, contactId: 'contact-a' },
      draftId: null, generation: null, editSessionId: null });
    expect(result).toMatchObject({ ok: true });
    const user = userEvent.setup();
    render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Edit note: Stable meeting' }));

    const localDate = new Date(occurredAt);
    const pad = (value: number) => String(value).padStart(2, '0');
    const expectedLocal = `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}`
      + `T${pad(localDate.getHours())}:${pad(localDate.getMinutes())}`;
    const dateInput = await screen.findByLabelText('Date and time');
    expect(dateInput).toHaveValue(expectedLocal);
    expect(screen.getByLabelText('Related person')).toHaveValue('contact-a');

    fireEvent.change(dateInput, { target: { value: '2024-01-12T13:45' } });
    await waitFor(async () => {
      const draft = (await fixture.database.clientDrafts.toArray()).find((entry) => entry.kind === 'note');
      expect(draft).toMatchObject({ clientId: 'client-a', recordId: 'stable-note',
        value: { contactId: 'contact-a', occurredAt: new Date('2024-01-12T13:45').getTime() } });
    });
  });

  it('limits a multi-file selection to five and reports the size of the actual failure', async () => {
    const user = userEvent.setup();
    render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);
    await user.click(await screen.findByRole('button', { name: 'Add note' }));
    const files = Array.from({ length: 6 }, (_, index) => new File([`bytes-${index}`], `limit-${index}.txt`));
    await user.upload(await screen.findByLabelText('Add files'), files);

    await waitFor(async () => expect(await fixture.database.clientAttachments.count()).toBe(5));
    expect(await screen.findByRole('alert')).toHaveTextContent('A note can have up to 5 files.');
    expect(screen.queryByText(/limit-5\.txt/)).not.toBeInTheDocument();
  });

  it('restores only a trashed live-brand note from the trash filter', async () => {
    const created = await fixture.records.saveNote({ id: 'trashed-note', clientId: 'client-a', expectedRevision: null,
      value: { title: 'Trashed follow-up', bodyText: 'Keep this record', kind: 'call', occurredAt: 50_000, contactId: null },
      draftId: null, generation: null, editSessionId: null });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error(`Could not seed trash test: ${created.code}`);
    expect(await fixture.records.setNoteDeleted({ id: created.value.id, clientId: 'client-a',
      expectedRevision: created.value.revision, deleted: true })).toMatchObject({ ok: true });

    const user = userEvent.setup();
    render(<ClientNotes clientId="client-a" records={fixture.records} database={fixture.database} />);
    expect(await screen.findByText('No notes for this client yet.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Trash'));
    const trashed = await screen.findByRole('article', { name: 'Trashed follow-up' });
    expect(within(trashed).getByRole('button', { name: 'Restore note' })).toBeInTheDocument();
    expect(within(trashed).queryByRole('button', { name: 'Edit note: Trashed follow-up' })).not.toBeInTheDocument();

    await user.click(within(trashed).getByRole('button', { name: 'Restore note' }));
    await waitFor(async () => expect((await fixture.database.clientNotes.get('trashed-note'))?.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Trashed follow-up' })).not.toBeInTheDocument());
  });

  it('shows detached notes from their saved client/contact snapshot and keeps archived attachments read-only', async () => {
    await fixture.seedContacts();
    const created = await fixture.records.saveNote({ id: 'archived-note', clientId: 'client-a', expectedRevision: null,
      value: { title: 'Archived plan', bodyText: 'Historical discussion', kind: 'decision', occurredAt: 60_000, contactId: 'contact-a' },
      draftId: null, generation: null, editSessionId: null });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error(`Could not seed archive test: ${created.code}`);
    expect(await fixture.records.addAttachment({ id: 'archived-file', clientId: 'client-a', ownerType: 'note',
      ownerId: created.value.id, file: new File(['archived bytes'], 'archive.svg', { type: 'image/svg+xml' }) }))
      .toMatchObject({ ok: true });
    await fixture.database.clients.delete('client-a');
    useClientStore.setState({ clients: clients.filter((client) => client.id !== 'client-a'), isLoaded: true });

    const user = userEvent.setup();
    render(<ClientNotes clientId={null} records={fixture.records} database={fixture.database} />);
    await user.click(screen.getByLabelText('Archived clients'));
    const archived = await screen.findByRole('article', { name: 'Archived plan' });
    expect(archived).toHaveTextContent('Archived client: Brand A');
    expect(archived).toHaveTextContent('Historical contact: Ada Lovelace');
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    expect(within(archived).queryByRole('button', { name: 'Edit note: Archived plan' })).not.toBeInTheDocument();
    expect(within(archived).queryByRole('button', { name: 'Move to trash' })).not.toBeInTheDocument();

    await user.click(within(archived).getByRole('button', { name: 'Show attachments' }));
    const attachmentSection = within(archived).getByRole('region', { name: 'Attachments' });
    expect(await within(attachmentSection).findByText('archive.svg')).toBeInTheDocument();
    expect(within(attachmentSection).queryByLabelText('Add files')).not.toBeInTheDocument();
    expect(within(attachmentSection).queryByRole('button', { name: 'Remove archive.svg' })).not.toBeInTheDocument();
    await user.click(within(attachmentSection).getByRole('button', { name: 'Export archive.svg' }));
    expect(saveAs).toHaveBeenCalledOnce();
  });
});
