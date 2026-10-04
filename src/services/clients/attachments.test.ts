// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDraft, ClientNote, NoteDraftValue } from '../../types/clients';
import { cleanupRecordsFixtures, createRecordsFixture } from './recordsTestFixtures';
import { MAX_ATTACHMENT_BYTES } from './schema';

const saveAsSpy = vi.hoisted(() => vi.fn());
vi.mock('file-saver', () => ({ saveAs: saveAsSpy }));

import { exportClientAttachment, sanitizeAttachmentFilename } from './attachments';

afterEach(async () => {
  vi.restoreAllMocks();
  saveAsSpy.mockReset();
  await cleanupRecordsFixtures();
});

const noteValue = (overrides: Partial<NoteDraftValue> = {}): NoteDraftValue => ({
  title: 'Attachment test', bodyText: 'plain text', kind: 'note', occurredAt: 1_000, contactId: null, ...overrides,
});
const testFile = (name: string, bytes = 'file bytes') => new File([bytes], name, { type: 'text/plain' });

function seedNoteDraft(overrides: Partial<Extract<ClientDraft, { kind: 'note' }>> = {}): Extract<ClientDraft, { kind: 'note' }> {
  const id = JSON.stringify(['client-a', 'note', 'note-draft']);
  return {
    id, clientId: 'client-a', editSessionId: 'session-a', generation: 0, baseRevision: null, updatedAt: 1_000,
    kind: 'note', recordId: 'note-draft', value: noteValue(), ...overrides,
  };
}

async function createNote(records: Awaited<ReturnType<typeof createRecordsFixture>>['records']): Promise<ClientNote> {
  const result = await records.saveNote({ id: 'note-owner', clientId: 'client-a', expectedRevision: null,
    value: noteValue(), draftId: null, generation: null, editSessionId: null });
  if (!result.ok) throw new Error(`Could not create note: ${result.code}`);
  return result.value;
}

describe('client detail attachments', () => {
  it('atomically creates a matching durable draft when attaching to a new note draft', async () => {
    const { database, records } = await createRecordsFixture();
    const draft = seedNoteDraft();
    const input = { id: 'first-draft-file', clientId: 'client-a', ownerType: 'draft' as const,
      ownerId: draft.id, file: testFile('first.txt'), draft };

    const added = await Reflect.apply(records.addAttachment, records, [input]);
    expect(added).toMatchObject({ ok: true, value: {
      id: 'first-draft-file', clientId: 'client-a', ownerType: 'draft', ownerId: draft.id, bytes: 10,
    } });
    expect(await database.clientDrafts.get(draft.id)).toMatchObject({
      id: draft.id, editSessionId: 'session-a', generation: 0, baseRevision: null, kind: 'note', recordId: 'note-draft',
    });
    expect(await (await database.clientAttachments.get('first-draft-file'))?.data.text()).toBe('file bytes');

    const retry = await Reflect.apply(records.addAttachment, records, [input]);
    expect(retry).toMatchObject({ ok: true, value: { id: 'first-draft-file' } });
    expect(await database.clientDrafts.count()).toBe(1);
    expect(await database.clientAttachments.count()).toBe(1);
  });

  it('rolls back the newly seeded draft when the attachment transaction aborts', async () => {
    const { database, records } = await createRecordsFixture();
    const draft = seedNoteDraft();
    vi.spyOn(database.clientAttachments, 'add').mockRejectedValueOnce(new Error('quota'));

    const result = await Reflect.apply(records.addAttachment, records, [{
      id: 'aborted-file', clientId: 'client-a', ownerType: 'draft', ownerId: draft.id,
      file: testFile('abort.txt'), draft,
    }]);
    expect(result).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await database.clientDrafts.get(draft.id)).toBeUndefined();
    expect(await database.clientAttachments.get('aborted-file')).toBeUndefined();
    expect(await database.clientProfiles.get('client-a')).toBeUndefined();
  });

  it('rejects a foreign or mismatched draft seed without creating an orphan attachment', async () => {
    const { database, records } = await createRecordsFixture();
    const foreignDraft = seedNoteDraft({ clientId: 'client-b' });
    const result = await Reflect.apply(records.addAttachment, records, [{
      id: 'foreign-file', clientId: 'client-a', ownerType: 'draft', ownerId: foreignDraft.id,
      file: testFile('foreign.txt'), draft: foreignDraft,
    }]);
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await database.clientDrafts.count()).toBe(0);
    expect(await database.clientAttachments.count()).toBe(0);
  });

  it('accepts empty and exact-limit files, rejects oversize files, and enforces five per owner', async () => {
    const { database, records } = await createRecordsFixture();
    const note = await createNote(records);
    expect(await records.addAttachment({ id: 'empty', clientId: 'client-a', ownerType: 'note', ownerId: note.id,
      file: new File([], 'empty.txt', { type: 'text/plain' }) })).toMatchObject({ ok: true, value: { bytes: 0 } });

    const exactBytes = new Uint8Array(MAX_ATTACHMENT_BYTES);
    exactBytes[MAX_ATTACHMENT_BYTES - 1] = 19;
    const exact = await records.addAttachment({ id: 'exact', clientId: 'client-a', ownerType: 'note', ownerId: note.id,
      file: new File([exactBytes], 'exact.bin', { type: 'application/octet-stream' }) });
    expect(exact).toMatchObject({ ok: true, value: { bytes: MAX_ATTACHMENT_BYTES } });
    expect(await database.clientAttachments.get('exact')).toMatchObject({ bytes: MAX_ATTACHMENT_BYTES });

    expect(await records.addAttachment({ id: 'too-large', clientId: 'client-a', ownerType: 'note', ownerId: note.id,
      file: new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.bin') }))
      .toMatchObject({ ok: false, code: 'LIMIT', field: 'file' });
    for (let index = 2; index < 5; index += 1) {
      expect((await records.addAttachment({ id: `file-${index}`, clientId: 'client-a', ownerType: 'note',
        ownerId: note.id, file: testFile(`${index}.txt`) })).ok).toBe(true);
    }
    expect(await records.addAttachment({ id: 'sixth', clientId: 'client-a', ownerType: 'note', ownerId: note.id,
      file: testFile('sixth.txt') })).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(await database.clientAttachments.count()).toBe(5);
  });

  it('retains a note draft and its attachment when publishing rolls back', async () => {
    const { database, records } = await createRecordsFixture();
    const draft = seedNoteDraft();
    const added = await records.addAttachment({
      id: 'preserved-on-failure', clientId: 'client-a', ownerType: 'draft', ownerId: draft.id,
      file: testFile('preserved.txt'), draft,
    });
    expect(added).toMatchObject({ ok: true });
    vi.spyOn(database.clientAttachments, 'put').mockRejectedValueOnce(new Error('quota'));

    const result = await records.saveNote({
      id: draft.recordId, clientId: draft.clientId, expectedRevision: draft.baseRevision,
      value: draft.value, draftId: draft.id, generation: draft.generation, editSessionId: draft.editSessionId,
    });

    expect(result).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await database.clientNotes.get(draft.recordId)).toBeUndefined();
    expect(await database.clientDrafts.get(draft.id)).toMatchObject({
      editSessionId: draft.editSessionId, generation: draft.generation, value: draft.value,
    });
    const attachment = await database.clientAttachments.get('preserved-on-failure');
    expect(attachment).toMatchObject({ ownerType: 'draft', ownerId: draft.id, clientId: draft.clientId });
    expect(await attachment?.data.text()).toBe('file bytes');
  });

  it('exports only the stored Blob with a sanitized filename and never mutates source data on failure', async () => {
    const attachment = {
      id: 'export-id', clientId: 'client-a', ownerType: 'note' as const, ownerId: 'note-owner',
      displayName: '..\\folder\\bad\u0000name.txt', mime: 'text/plain', bytes: 4,
      data: new Blob(['data'], { type: 'text/plain' }), createdAt: 1,
    };
    expect(sanitizeAttachmentFilename(attachment.displayName)).toBe('badname.txt');
    expect(sanitizeAttachmentFilename('..')).toBe('attachment');
    expect(await exportClientAttachment(attachment)).toMatchObject({ ok: true });
    expect(saveAsSpy).toHaveBeenCalledTimes(1);
    expect(saveAsSpy).toHaveBeenCalledWith(attachment.data, 'badname.txt');
    expect(await attachment.data.text()).toBe('data');

    saveAsSpy.mockImplementationOnce(() => { throw new Error('download failed'); });
    expect(await exportClientAttachment(attachment)).toMatchObject({ ok: false, code: 'STORAGE' });
    expect(await attachment.data.text()).toBe('data');
  });
});
