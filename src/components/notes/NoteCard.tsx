import { useEffect, useRef, useState, type DragEventHandler } from 'react';
import { ChevronUp, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotesStore } from '../../stores/notesStore';
import type { NoteCategory, NoteDraft, NoteRecord } from '../../types/notes';
import { NoteRichEditor } from './NoteRichEditor';
import { NotePreview } from './NotePreview';
import { NotesConfirmation } from './NotesDialog';

export function NoteBadge({ category }: { category?: NoteCategory }) {
  const { t } = useTranslation();
  return <span className="notes-badge" data-color={category?.color ?? 'neutral'}>{category?.name ?? t('notes.uncategorized')}</span>;
}

export function NoteCard({ id, note, newDraft, categories, dragEnabled = false, dragging = false, dropPlacement,
  onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop, onMove }: {
  id: string; note?: NoteRecord; newDraft?: NoteDraft; categories: NoteCategory[];
  dragEnabled?: boolean; dragging?: boolean; dropPlacement?: 'before' | 'after';
  onDragStart?: DragEventHandler<HTMLElement>; onDragOver?: DragEventHandler<HTMLElement>;
  onDragLeave?: DragEventHandler<HTMLElement>; onDragEnd?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>; onMove?: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const draft = useNotesStore((state) => state.drafts[id]);
  const editing = useNotesStore((state) => state.activeNoteId === id);
  const saving = useNotesStore((state) => state.savingNoteId === id);
  const [menu, setMenu] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const categoryPickerRef = useRef<HTMLDivElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);
  const value = editing ? draft : note ?? draft ?? newDraft;
  const title = value?.title || t('notes.untitled');
  const category = categories.find((item) => item.id === value?.categoryId);

  useEffect(() => {
    if (!editing) return;
    titleRef.current?.focus();
    cardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [editing]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menuButton.current?.contains(event.target)) setMenu(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menu]);
  useEffect(() => {
    if (!categoryOpen) return;
    const picker = categoryPickerRef.current;
    const selected = picker?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? picker?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !picker?.contains(event.target)) setCategoryOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [categoryOpen]);
  if (!value) return null;

  const canDrag = dragEnabled && !editing && !saving && !menu && !confirm;
  return <article ref={cardRef} className={`ui-card notes-card${editing ? ' notes-card--editing' : ''}${dragging ? ' notes-card--dragging' : ''}${dropPlacement ? ` notes-card--drop-${dropPlacement}` : ''}`} aria-label={title}
    draggable={canDrag} onDragStart={(event) => {
      const control = event.target instanceof Element ? event.target.closest('button, input, select, textarea, a, [contenteditable="true"]') : null;
      if (!canDrag || (control && !control.matches('.notes-card-hitarea'))) { event.preventDefault(); return; }
      onDragStart?.(event);
    }} onDragOver={onDragOver} onDragLeave={onDragLeave} onDragEnd={onDragEnd} onDrop={onDrop}
    onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && editing) {
        event.preventDefault(); void useNotesStore.getState().saveNote(id).catch(() => undefined);
      }
    }}>
    {!editing && <button type="button" className="notes-card-hitarea" aria-label={t('notes.edit', { title })}
      title={canDrag && onMove ? t('notes.reorderHint') : undefined}
      onKeyDown={(event) => {
        if (!canDrag || !onMove || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        onMove(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      }}
      onClick={() => useNotesStore.getState().beginEdit(id)} />}
    <header className="notes-card-header">
      {editing && draft ? <input ref={titleRef} className="ui-input notes-card-title" type="text" maxLength={200}
        aria-label={t('notes.noteTitle')} placeholder={t('notes.titlePlaceholder')} value={draft.title} disabled={saving}
        onChange={(event) => useNotesStore.getState().updateDraft(id, { title: event.currentTarget.value })} />
        : <h2 className="notes-card-title">{title}</h2>}
      <div className="notes-card-actions">
        {note?.pinned && <Pin className="notes-pin-indicator" aria-label={t('notes.pinned')} />}
        <button ref={menuButton} type="button" className="ui-icon-button notes-icon-button" aria-label={t('notes.actions', { title })}
          aria-haspopup="menu" aria-expanded={menu} disabled={saving} onClick={() => setMenu(!menu)}><MoreHorizontal /></button>
        {menu && <div ref={menuRef} className="drop notes-menu" role="menu" aria-label={t('notes.actions', { title })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') { setMenu(false); if (event.key === 'Escape') menuButton.current?.focus(); }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[index]?.focus();
          }}>
          <button type="button" className="ui-list-row drop-item" role="menuitem" disabled={!note} onClick={() => {
            setMenu(false); void useNotesStore.getState().togglePin(id).catch(() => undefined);
          }}>{note?.pinned ? <PinOff /> : <Pin />}{t(note?.pinned ? 'notes.unpin' : 'notes.pin')}</button>
          <button type="button" className="ui-list-row ui-button--danger drop-item" role="menuitem" onClick={() => { setMenu(false); setConfirm('delete'); }}>
            <Trash2 />{t('notes.delete')}</button>
        </div>}
      </div>
    </header>
    {editing && draft ? <div className="notes-card-editor"><NoteRichEditor draft={draft} disabled={saving} /></div>
      : <NotePreview content={value.content} />}
    <footer className="notes-card-footer">
      {editing && draft ? <div className="notes-category-picker">
        <button ref={categoryButtonRef} type="button" className="ui-input notes-category-select" aria-label={t('notes.category')}
          aria-haspopup="listbox" aria-expanded={categoryOpen} disabled={saving}
          onClick={() => setCategoryOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); setCategoryOpen(true);
            }
          }}>
          <span>{category?.name ?? t('notes.uncategorized')}</span><ChevronUp aria-hidden="true" />
        </button>
        {categoryOpen && <div ref={categoryPickerRef} className="notes-category-options" role="listbox" aria-label={t('notes.category')}
          onKeyDown={(event) => {
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
            const current = options.indexOf(document.activeElement as HTMLElement);
            if (event.key === 'Escape') { event.preventDefault(); setCategoryOpen(false); categoryButtonRef.current?.focus(); }
            else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); (document.activeElement as HTMLElement | null)?.click();
            }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
              options[index]?.focus();
            }
          }}>
          {[{ id: '', name: t('notes.uncategorized') }, ...categories].map((item) => <button key={item.id || 'uncategorized'} type="button"
            role="option" aria-selected={(draft.categoryId ?? '') === item.id} tabIndex={(draft.categoryId ?? '') === item.id ? 0 : -1}
            onClick={() => { useNotesStore.getState().updateDraft(id, { categoryId: item.id || null }); setCategoryOpen(false); categoryButtonRef.current?.focus(); }}>
            {item.name}
          </button>)}
        </div>}
      </div> : <NoteBadge category={category} />}
      {editing ? <div className="notes-card-save-actions">
        <button type="button" className="ui-button notes-button" disabled={saving} onClick={() => setConfirm('discard')}>{t('notes.cancel')}</button>
        <button type="button" className="ui-button ui-button--primary notes-button notes-button--primary" disabled={saving}
          onClick={() => void useNotesStore.getState().saveNote(id).catch(() => undefined)}>{t(saving ? 'notes.saving' : 'notes.save')}</button>
      </div> : draft && <span className="notes-draft-indicator">{t('notes.draft')}</span>}
    </footer>
    {confirm && <NotesConfirmation title={t(confirm === 'delete' ? 'notes.delete' : 'notes.discard')}
      message={t(confirm === 'delete' ? 'notes.deleteConfirm' : 'notes.discardConfirm', { title })}
      confirmLabel={t(confirm === 'delete' ? 'notes.delete' : 'notes.discard')}
      onClose={() => setConfirm(null)} onConfirm={() => confirm === 'delete'
        ? useNotesStore.getState().deleteNote(id) : useNotesStore.getState().discardDraft(id)} />}
  </article>;
}
