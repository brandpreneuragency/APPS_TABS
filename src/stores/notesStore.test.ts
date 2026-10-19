import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesDatabase } from '../services/notes/database';
import { createNotesStore } from './notesStore';

const databases: NotesDatabase[] = [];
function fixture() {
  const database = new NotesDatabase(`notes-test-${crypto.randomUUID()}`);
  databases.push(database);
  return { database, store: createNotesStore(database) };
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('independent local notes', () => {
  it('persists moves in both directions, including unsaved notes and open drafts', async () => {
    const { database, store } = fixture();
    const first = await store.getState().createNote();
    store.getState().updateDraft(first, { title: 'First' });
    await store.getState().saveNote(first);
    const second = await store.getState().createNote();
    await store.getState().saveNote(second);
    const third = await store.getState().createNote();
    store.getState().beginEdit(first);
    const moving = store.getState().reorderNote(first, third, false);
    store.getState().updateDraft(first, { title: 'Unfinished' });
    const saving = store.getState().saveNote(first);
    await Promise.all([moving, saving]);
    const reopened = createNotesStore(database);
    await reopened.getState().load();
    const orderedIds = () => [...reopened.getState().notes, ...Object.values(reopened.getState().drafts)]
      .sort((left, right) => right.order - left.order).map((note) => note.id);
    expect(orderedIds()).toEqual([first, third, second]);
    expect(await database.notes.get(first)).toMatchObject({ title: 'Unfinished', revision: 2 });
    await reopened.getState().reorderNote(third, second, true);
    await reopened.getState().saveNote(third);
    expect(orderedIds()).toEqual([first, second, third]);
  });

  it('keeps pin groups separate and ignores missing or identical targets', async () => {
    const { database, store } = fixture();
    const first = await store.getState().createNote();
    await store.getState().saveNote(first);
    const second = await store.getState().createNote();
    await store.getState().saveNote(second);
    await store.getState().togglePin(first);
    const before = await database.notes.toArray();
    await store.getState().reorderNote(first, second, true);
    await store.getState().reorderNote(first, 'missing', false);
    await store.getState().reorderNote('missing', first, false);
    await store.getState().reorderNote(first, first, false);
    expect(await database.notes.toArray()).toEqual(before);
  });

  it('keeps reordered draft-only notes in position when text and Save are queued during the move', async () => {
    const { database, store } = fixture();
    const first = await store.getState().createNote();
    const second = await store.getState().createNote();
    const moving = store.getState().reorderNote(first, second, false);
    store.getState().updateDraft(first, { title: 'Latest input' });
    const saving = store.getState().saveNote(first);
    await Promise.all([moving, saving]);
    expect(await database.notes.get(first)).toMatchObject({ title: 'Latest input', order: 2 });
    expect(await database.drafts.get(second)).toMatchObject({ order: 1 });
  });

  it('reorders pinned notes without changing the unpinned group or content revisions', async () => {
    const { database, store } = fixture();
    const first = await store.getState().createNote();
    await store.getState().saveNote(first);
    const second = await store.getState().createNote();
    await store.getState().saveNote(second);
    const third = await store.getState().createNote();
    await store.getState().saveNote(third);
    await store.getState().togglePin(first);
    await store.getState().togglePin(second);
    await store.getState().reorderNote(first, second, false);
    expect(await database.notes.get(first)).toMatchObject({ pinned: true, order: 2, revision: 1 });
    expect(await database.notes.get(second)).toMatchObject({ pinned: true, order: 1, revision: 1 });
    expect(await database.notes.get(third)).toMatchObject({ pinned: false, order: 3, revision: 1 });
  });

  it('rolls back a failed reorder without changing saved notes or drafts', async () => {
    const { database, store } = fixture();
    const first = await store.getState().createNote();
    await store.getState().saveNote(first);
    const second = await store.getState().createNote();
    const notes = await database.notes.toArray();
    const drafts = await database.drafts.toArray();
    vi.spyOn(database.drafts, 'update').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(store.getState().reorderNote(first, second, false)).rejects.toThrow('disk unavailable');
    expect(await database.notes.toArray()).toEqual(notes);
    expect(await database.drafts.toArray()).toEqual(drafts);
    expect(store.getState().notes).toEqual(notes);
    expect(store.getState().error).toBe('storage');
  });

  it('keeps rich text as a recoverable draft until Save and restores the saved note after reopening', async () => {
    const { database, store } = fixture();
    await store.getState().load();
    const id = await store.getState().createNote();
    const content = {
      type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First idea', marks: [{ type: 'bold' }] }] },
      ] }] }],
    };
    store.getState().updateDraft(id, { title: 'Design ideas', content });
    await store.getState().flush();
    expect(await database.notes.get(id)).toBeUndefined();
    expect(await database.drafts.get(id)).toMatchObject({ title: 'Design ideas', content });

    const recovered = createNotesStore(database);
    await recovered.getState().load();
    expect(recovered.getState().drafts[id]).toMatchObject({ title: 'Design ideas', content });
    await recovered.getState().saveNote(id);
    expect(await database.drafts.get(id)).toBeUndefined();

    database.close();
    await database.open();
    const reopened = createNotesStore(database);
    await reopened.getState().load();
    expect(reopened.getState().notes).toEqual([expect.objectContaining({ id, title: 'Design ideas', content, revision: 1 })]);
    expect(reopened.getState().drafts).toEqual({});
  });

  it('preserves drafts when a save fails and rejects stale publication', async () => {
    const { database, store } = fixture();
    const id = await store.getState().createNote();
    store.getState().updateDraft(id, { title: 'Keep my work' });
    await store.getState().flush();
    const failure = vi.spyOn(database.notes, 'put').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(store.getState().saveNote(id)).rejects.toThrow();
    expect(store.getState().drafts[id].title).toBe('Keep my work');
    expect(await database.drafts.get(id)).toMatchObject({ title: 'Keep my work' });
    failure.mockRestore();
    await store.getState().saveNote(id);
    store.getState().beginEdit(id);
    store.getState().updateDraft(id, { title: 'Local change' });
    await store.getState().flush();
    await database.notes.update(id, { title: 'Other window', revision: 2 });
    await expect(store.getState().saveNote(id)).rejects.toThrow('conflict');
    expect(await database.notes.get(id)).toMatchObject({ title: 'Other window' });
    expect(store.getState().drafts[id].title).toBe('Local change');
  });

  it('unlinks deleted categories without deleting notes or their draft content', async () => {
    const { database, store } = fixture();
    await store.getState().saveCategory({ name: 'Design', color: 'blue' });
    const category = store.getState().categories[0];
    const id = await store.getState().createNote();
    store.getState().updateDraft(id, { title: 'Idea', categoryId: category.id });
    await store.getState().saveNote(id);
    store.getState().beginEdit(id);
    store.getState().updateDraft(id, { title: 'Unsaved idea' });
    await store.getState().saveCategory({ ...category, name: 'Product', color: 'green' });
    expect(store.getState().categories[0]).toMatchObject({ id: category.id, name: 'Product', color: 'green' });
    await expect(store.getState().saveCategory({ name: 'Product', color: 'red' })).rejects.toThrow('categoryName');
    await store.getState().deleteCategory(category.id);
    expect(await database.notes.get(id)).toMatchObject({ title: 'Idea', categoryId: null });
    expect(await database.drafts.get(id)).toMatchObject({ title: 'Unsaved idea', categoryId: null });
    await store.getState().saveNote(id);
    expect(await database.notes.get(id)).toMatchObject({ title: 'Unsaved idea', categoryId: null });
  });

  it('persists pins without conflicting with an open draft', async () => {
    const { database, store } = fixture();
    const id = await store.getState().createNote();
    await store.getState().saveNote(id);
    store.getState().beginEdit(id);
    await store.getState().togglePin(id);
    await store.getState().saveNote(id);
    expect(await database.notes.get(id)).toMatchObject({ pinned: true });
    await store.getState().togglePin(id);
    expect(await database.notes.get(id)).toMatchObject({ pinned: false });
  });

  it('does not resurrect a deleted or discarded draft from late input', async () => {
    const { database, store } = fixture();
    const id = await store.getState().createNote();
    const deleting = store.getState().deleteNote(id);
    store.getState().updateDraft(id, { title: 'Late input' });
    await deleting;
    await store.getState().flush();
    expect(await database.drafts.get(id)).toBeUndefined();
    const secondId = await store.getState().createNote();
    const discarding = store.getState().discardDraft(secondId);
    store.getState().updateDraft(secondId, { title: 'Late input' });
    await discarding;
    await store.getState().flush();
    expect(await database.drafts.get(secondId)).toBeUndefined();
  });
});
