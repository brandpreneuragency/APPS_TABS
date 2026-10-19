import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { notesDatabase, type NotesDatabase } from '../services/notes/database';
import { emptyNoteContent, type NoteCategory, type NoteDraft, type NoteRecord, type NoteValue } from '../types/notes';

interface NotesStore {
  notes: NoteRecord[];
  categories: NoteCategory[];
  drafts: Record<string, NoteDraft>;
  activeNoteId: string | null;
  categoryFilter: string | null;
  pinnedOnly: boolean;
  isLoaded: boolean;
  savingNoteId: string | null;
  error: 'storage' | 'conflict' | 'categoryName' | null;
  load: () => Promise<void>;
  createNote: () => Promise<string>;
  beginEdit: (id: string) => void;
  updateDraft: (id: string, change: Partial<NoteValue>) => void;
  saveNote: (id: string) => Promise<void>;
  discardDraft: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  reorderNote: (id: string, targetId: string, after: boolean) => Promise<void>;
  saveCategory: (category: Omit<NoteCategory, 'id'> & { id?: string }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setCategoryFilter: (id: string | null) => void;
  setPinnedOnly: (value: boolean) => void;
  clearError: () => void;
  categoryManagerOpen: boolean;
  setCategoryManagerOpen: (open: boolean) => void;
  flush: () => Promise<void>;
}

export function createNotesStore(database: NotesDatabase) {
  // All writes share an ordered lane: late draft writes cannot resurrect Save/Delete.
  let writes: Promise<void> = Promise.resolve();
  let loading: Promise<void> | null = null;
  const closingNotes = new Set<string>();
  return create<NotesStore>((set, get) => {
    const queue = <T,>(operation: () => Promise<T>): Promise<T> => {
      const result = writes.then(operation);
      writes = result.then(() => undefined, () => undefined);
      return result.catch((error: unknown) => {
        set({ error: error instanceof Error && error.message === 'conflict' ? 'conflict'
          : error instanceof Error && error.message === 'categoryName' ? 'categoryName' : 'storage' });
        throw error;
      });
    };
    const persistDraft = (draft: NoteDraft) => database.transaction('rw', database.notes, database.drafts, async () => {
      const stored = await database.drafts.get(draft.id);
      const note = await database.notes.get(draft.id);
      await database.drafts.put({ ...draft, order: note?.order ?? stored?.order ?? draft.order });
    });
    return {
      notes: [], categories: [], drafts: {}, activeNoteId: null,
      categoryFilter: null, pinnedOnly: false, isLoaded: false, savingNoteId: null, error: null,
      load: async () => {
        if (get().isLoaded) return;
        if (loading) return loading;
        loading = queue(async () => {
          const [notes, categories, drafts] = await database.transaction('r', database.notes, database.categories, database.drafts,
            () => Promise.all([database.notes.toArray(), database.categories.toArray(), database.drafts.toArray()]));
          set({ notes, categories, drafts: Object.fromEntries(drafts.map((draft) => [draft.id, draft])), isLoaded: true, error: null });
        });
        try { await loading; } finally { loading = null; }
      },
      createNote: async () => {
        await get().load();
        const state = get();
        const draft: NoteDraft = {
          id: nanoid(), title: '', content: emptyNoteContent(),
          categoryId: state.categoryFilter && state.categories.some((category) => category.id === state.categoryFilter)
            ? state.categoryFilter : null,
          order: Math.max(0, ...state.notes.map((note) => note.order), ...Object.values(state.drafts).map((item) => item.order)) + 1,
          baseRevision: null,
        };
        await queue(async () => {
          await database.drafts.add(draft);
          set((current) => ({ drafts: { ...current.drafts, [draft.id]: draft }, activeNoteId: draft.id, pinnedOnly: false, error: null }));
        });
        return draft.id;
      },
      beginEdit: (id) => {
        if (get().savingNoteId || closingNotes.has(id)) return;
        const state = get();
        const note = state.notes.find((item) => item.id === id);
        if (!state.drafts[id] && !note) return;
        const draft = state.drafts[id] ?? (note && {
          id, title: note.title, content: note.content, categoryId: note.categoryId, order: note.order, baseRevision: note.revision,
        });
        if (!draft) return;
        set({ activeNoteId: id, drafts: { ...state.drafts, [id]: draft } });
        void queue(() => persistDraft(draft)).catch(() => undefined);
      },
      updateDraft: (id, change) => {
        const current = get().drafts[id];
        if (!current || get().savingNoteId === id || closingNotes.has(id)) return;
        const draft = { ...current, ...change };
        set((state) => ({ drafts: { ...state.drafts, [id]: draft } }));
        void queue(() => persistDraft(draft)).catch(() => undefined);
      },
      saveNote: async (id) => {
        const draft = get().drafts[id];
        if (!draft || get().savingNoteId || closingNotes.has(id)) return;
        set({ savingNoteId: id, error: null });
        try {
          await queue(async () => {
            const saved = await database.transaction('rw', database.notes, database.drafts, database.categories, async () => {
              const existing = await database.notes.get(id);
              if ((existing?.revision ?? null) !== draft.baseRevision) throw new Error('conflict');
              const categoryId = draft.categoryId && await database.categories.get(draft.categoryId) ? draft.categoryId : null;
              const storedDraft = await database.drafts.get(id);
              const note: NoteRecord = {
                id, title: draft.title.trim(), content: draft.content, categoryId, order: existing?.order ?? storedDraft?.order ?? draft.order,
                pinned: existing?.pinned ?? false, revision: (existing?.revision ?? 0) + 1,
              };
              await database.notes.put(note);
              await database.drafts.delete(id);
              return note;
            });
            set((state) => {
              const drafts = { ...state.drafts };
              delete drafts[id];
              return { notes: [...state.notes.filter((note) => note.id !== id), saved], drafts,
                activeNoteId: state.activeNoteId === id ? null : state.activeNoteId, error: null };
            });
          });
        } finally { set({ savingNoteId: null }); }
      },
      discardDraft: (id) => {
        closingNotes.add(id);
        return queue(async () => {
          await database.drafts.delete(id);
          set((state) => {
            const drafts = { ...state.drafts };
            delete drafts[id];
            return { drafts, activeNoteId: state.activeNoteId === id ? null : state.activeNoteId, error: null };
          });
        }).finally(() => { closingNotes.delete(id); });
      },
      deleteNote: (id) => {
        closingNotes.add(id);
        return queue(async () => {
          await database.transaction('rw', database.notes, database.drafts, async () => {
            await database.notes.delete(id);
            await database.drafts.delete(id);
          });
          set((state) => {
            const drafts = { ...state.drafts };
            delete drafts[id];
            return { notes: state.notes.filter((note) => note.id !== id), drafts,
              activeNoteId: state.activeNoteId === id ? null : state.activeNoteId, error: null };
          });
        }).finally(() => { closingNotes.delete(id); });
      },
      togglePin: (id) => queue(async () => {
        const note = await database.transaction('rw', database.notes, async () => {
          const current = await database.notes.get(id);
          if (!current) return null;
          const next = { ...current, pinned: !current.pinned };
          await database.notes.put(next);
          return next;
        });
        if (note) set((state) => ({ notes: state.notes.map((item) => item.id === id ? note : item), error: null }));
      }),
      reorderNote: (id, targetId, after) => queue(async () => {
        if (id === targetId) return;
        const orders = await database.transaction('rw', database.notes, database.drafts, async () => {
          const notes = await database.notes.toArray();
          const drafts = await database.drafts.toArray();
          const cards = [
            ...notes.map((note) => ({ id: note.id, order: note.order, pinned: note.pinned })),
            ...drafts.filter((draft) => !notes.some((note) => note.id === draft.id))
              .map((draft) => ({ id: draft.id, order: draft.order, pinned: false })),
          ];
          const source = cards.find((card) => card.id === id);
          const target = cards.find((card) => card.id === targetId);
          if (!source || !target || source.pinned !== target.pinned) return null;
          const group = cards.filter((card) => card.pinned === source.pinned)
            .sort((left, right) => right.order - left.order || left.id.localeCompare(right.id));
          const remaining = group.filter((card) => card.id !== id);
          remaining.splice(remaining.findIndex((card) => card.id === targetId) + Number(after), 0, source);
          const nextOrders = new Map(remaining.map((card, index) => [card.id, remaining.length - index]));
          for (const [noteId, order] of nextOrders) {
            await database.notes.update(noteId, { order });
            await database.drafts.update(noteId, { order });
          }
          return nextOrders;
        });
        if (!orders) return;
        set((state) => ({
          notes: state.notes.map((note) => ({ ...note, order: orders.get(note.id) ?? note.order })),
          drafts: Object.fromEntries(Object.entries(state.drafts).map(([key, draft]) => [key,
            { ...draft, order: orders.get(key) ?? draft.order }])),
          error: null,
        }));
      }),
      saveCategory: (input) => queue(async () => {
        const name = input.name.trim();
        if (!name || name.length > 60) throw new Error('categoryName');
        const category: NoteCategory = { id: input.id ?? nanoid(), name, color: input.color };
        await database.transaction('rw', database.categories, async () => {
          const categories = await database.categories.toArray();
          if (categories.some((item) => item.id !== category.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            throw new Error('categoryName');
          }
          if (input.id && !await database.categories.get(input.id)) throw new Error('conflict');
          await database.categories.put(category);
        });
        set((state) => ({ categories: [...state.categories.filter((item) => item.id !== category.id), category], error: null }));
      }),
      deleteCategory: (id) => queue(async () => {
        await database.transaction('rw', database.notes, database.categories, database.drafts, async () => {
          await database.categories.delete(id);
          await database.notes.where('categoryId').equals(id).modify({ categoryId: null });
          await database.drafts.filter((draft) => draft.categoryId === id).modify({ categoryId: null });
        });
        set((state) => ({
          categories: state.categories.filter((category) => category.id !== id),
          notes: state.notes.map((note) => note.categoryId === id ? { ...note, categoryId: null } : note),
          drafts: Object.fromEntries(Object.entries(state.drafts).map(([key, draft]) => [key,
            draft.categoryId === id ? { ...draft, categoryId: null } : draft])),
          categoryFilter: state.categoryFilter === id ? null : state.categoryFilter, error: null,
        }));
      }),
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      setPinnedOnly: (pinnedOnly) => set({ pinnedOnly }),
      clearError: () => set({ error: null }),
      categoryManagerOpen: false,
      setCategoryManagerOpen: (categoryManagerOpen) => set({ categoryManagerOpen, error: null }),
      flush: () => writes,
    };
  });
}

export const useNotesStore = createNotesStore(notesDatabase);
