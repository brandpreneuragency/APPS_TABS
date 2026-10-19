import Dexie, { type Table } from 'dexie';
import type { NoteCategory, NoteDraft, NoteRecord } from '../../types/notes';

/** Local-only Notes storage, separate from task authority and client notes. */
export class NotesDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  categories!: Table<NoteCategory, string>;
  drafts!: Table<NoteDraft, string>;

  constructor(name = 'TabsNotesDB') {
    super(name);
    this.version(1).stores({
      notes: 'id, categoryId, order',
      categories: 'id, name',
      drafts: 'id',
    });
  }
}

export const notesDatabase = new NotesDatabase();
