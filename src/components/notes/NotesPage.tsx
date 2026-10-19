import { useEffect, useState, type DragEvent } from 'react';
import { Plus, Search, StickyNote, Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotesStore } from '../../stores/notesStore';
import { noteText } from '../../types/notes';
import { NoteCard } from './NoteCard';
import { NotesCategoryManager } from './NotesCategoryManager';
import { AssistantToggle } from '../layout/workspace/AssistantToggle';
import './notes.css';

export function NotesPage() {
  const { t } = useTranslation();
  const notes = useNotesStore((state) => state.notes);
  const drafts = useNotesStore((state) => state.drafts);
  const categories = useNotesStore((state) => state.categories);
  const activeNoteId = useNotesStore((state) => state.activeNoteId);
  const categoryFilter = useNotesStore((state) => state.categoryFilter);
  const pinnedOnly = useNotesStore((state) => state.pinnedOnly);
  const isLoaded = useNotesStore((state) => state.isLoaded);
  const error = useNotesStore((state) => state.error);
  const managerOpen = useNotesStore((state) => state.categoryManagerOpen);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [reordering, setReordering] = useState(false);
  useEffect(() => { void useNotesStore.getState().load().catch(() => undefined); }, []);

  const query = search.trim().toLocaleLowerCase();
  const cards = [
    ...notes.map((note) => ({ id: note.id, note, draft: drafts[note.id], order: note.order, pinned: note.pinned })),
    ...Object.values(drafts).filter((draft) => !notes.some((note) => note.id === draft.id))
      .map((draft) => ({ id: draft.id, note: undefined, draft, order: draft.order, pinned: false })),
  ].filter((card) => {
    if (card.id === activeNoteId) return true;
    const value = card.note ?? card.draft;
    return value && (!categoryFilter || value.categoryId === categoryFilter || (categoryFilter === '__uncategorized__' && !value.categoryId))
      && (!pinnedOnly || card.pinned)
      && (!query || `${value.title} ${noteText(value.content)}`.toLocaleLowerCase().includes(query));
  }).sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.order - left.order || left.id.localeCompare(right.id));
  const filtered = Boolean(query || categoryFilter || pinnedOnly);
  const canDrop = (id: string) => {
    const source = cards.find((card) => card.id === draggedId);
    const target = cards.find((card) => card.id === id);
    return Boolean(source && target && source.id !== target.id && source.pinned === target.pinned && !reordering);
  };
  const resetDrag = () => { setDraggedId(null); setDropTarget(null); };
  const reorder = (id: string, targetId: string, after: boolean) => {
    resetDrag(); setReordering(true);
    void useNotesStore.getState().reorderNote(id, targetId, after)
      .catch(() => undefined).finally(() => setReordering(false));
  };
  const dropAfter = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const gridWidth = event.currentTarget.parentElement?.clientWidth ?? 0;
    return gridWidth > rect.width * 1.5 ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
  };

  return <section className="ui-page-body notes-page" aria-label={t('navigation.notes')}>
    <div className="notes-toolbar-wrapper">
      <div className="ui-toolbar notes-toolbar">
        <label className="notes-search"><Search />
          <input className="ui-input" type="search" aria-label={t('notes.search')} placeholder={t('notes.search')} value={search}
            onChange={(event) => setSearch(event.currentTarget.value)} /></label>
        <div className="notes-toolbar-actions">
          <button type="button" className="ui-icon-button notes-icon-button" title={t('notes.manageCategories')} aria-label={t('notes.manageCategories')}
            onClick={() => useNotesStore.getState().setCategoryManagerOpen(true)}><Tags /></button>
          <button type="button" className="ui-button ui-button--primary notes-button notes-button--primary" disabled={!isLoaded || creating} onClick={() => {
            if (creating) return;
            setCreating(true); setSearch('');
            void useNotesStore.getState().createNote().catch(() => undefined).finally(() => setCreating(false));
          }}><Plus />{t('notes.newNote')}</button>
          <AssistantToggle id="notes-btn-assistant" variant="header" />
        </div>
      </div>
    </div>
    {error && <div role="alert" className="notes-error">{t(`notes.error_${error}`)}
      {!isLoaded && <button type="button" className="ui-button notes-button" onClick={() => void useNotesStore.getState().load().catch(() => undefined)}>{t('notes.retry')}</button>}
    </div>}
    {!isLoaded ? <div className="notes-empty" role="status">{t('notes.loading')}</div>
      : !cards.length ? <div className="notes-empty"><StickyNote />
        <h2>{t(filtered ? 'notes.noResults' : 'notes.empty')}</h2>
        <p>{t(filtered ? 'notes.noResultsHint' : 'notes.emptyHint')}</p>
        {filtered && <button type="button" className="ui-button notes-button" onClick={() => {
          setSearch(''); useNotesStore.getState().setCategoryFilter(null); useNotesStore.getState().setPinnedOnly(false);
        }}>{t('notes.clearFilters')}</button>}
      </div> : <div className="notes-grid" aria-label={t('notes.grid')}>
        {cards.map((card) => <NoteCard key={card.id} id={card.id} note={card.note} newDraft={card.draft} categories={categories}
          dragEnabled={!reordering} dragging={draggedId === card.id}
          dropPlacement={dropTarget?.id === card.id ? dropTarget.after ? 'after' : 'before' : undefined}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-tabs-note', card.id);
            setDraggedId(card.id);
          }} onDragEnd={resetDrag}
          onDragOver={(event) => {
            if (!canDrop(card.id)) { setDropTarget(null); return; }
            event.preventDefault(); event.dataTransfer.dropEffect = 'move';
            setDropTarget({ id: card.id, after: dropAfter(event) });
          }} onDragLeave={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
          }} onDrop={(event) => {
            if (!canDrop(card.id) || !draggedId) { resetDrag(); return; }
            event.preventDefault(); reorder(draggedId, card.id, dropAfter(event));
          }} onMove={(direction) => {
            const group = cards.filter((item) => item.pinned === card.pinned);
            const target = group[group.findIndex((item) => item.id === card.id) + direction];
            if (target) reorder(card.id, target.id, direction > 0);
          }} />)}
      </div>}
    {managerOpen && <NotesCategoryManager />}
  </section>;
}
