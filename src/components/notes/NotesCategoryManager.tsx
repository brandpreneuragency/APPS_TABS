import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotesStore } from '../../stores/notesStore';
import { NOTE_COLORS, type NoteCategory, type NoteColor } from '../../types/notes';
import { NoteBadge } from './NoteCard';
import { NotesConfirmation, NotesDialog } from './NotesDialog';

export function NotesCategoryManager() {
  const { t } = useTranslation();
  const categories = useNotesStore((state) => state.categories);
  const error = useNotesStore((state) => state.error);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [color, setColor] = useState<NoteColor | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<NoteCategory | null>(null);
  const canSave = !busy && Boolean(name.trim()) && color !== null;
  const reset = () => { setEditingId(undefined); setName(''); setColor(null); };
  const close = () => { if (!busy) useNotesStore.getState().setCategoryManagerOpen(false); };
  return <NotesDialog title={t('notes.addCategory')} onClose={close}>
    <button type="button" className="ui-icon-button notes-icon-button notes-dialog-close" aria-label={t('notes.close')} disabled={busy} onClick={close}><X /></button>
    <form className="notes-category-form" onSubmit={(event) => {
      event.preventDefault(); if (!canSave || color === null) return;
      setBusy(true);
      void useNotesStore.getState().saveCategory({ id: editingId, name, color }).then(reset).catch(() => undefined).finally(() => setBusy(false));
    }}>
      <label className="ui-field notes-field">
        <input className="ui-input" type="text" maxLength={60} required value={name} disabled={busy} aria-label={t('notes.categoryName')} placeholder={t('notes.categoryNamePlaceholder')}
          onChange={(event) => { setName(event.currentTarget.value); useNotesStore.getState().clearError(); }} /></label>
      <div className="notes-color-options" role="group" aria-label={t('notes.categoryColor')}>
        {NOTE_COLORS.map((item) => <button key={item} type="button" className="notes-color-option" data-color={item}
          aria-label={t(`notes.color_${item}`)} title={t(`notes.color_${item}`)} aria-pressed={color === item} disabled={busy} onClick={() => setColor(item)} />)}
      </div>
      <div className="notes-dialog-actions">
        {editingId && <button type="button" className="ui-button notes-button" disabled={busy} onClick={reset}>{t('notes.cancel')}</button>}
        <button type="submit" className="ui-icon-button notes-icon-button"
          aria-label={t('notes.save')} title={t('notes.save')}
          disabled={!canSave}>
          <Check /></button>
      </div>
    </form>
    {error && <p role="alert" className="notes-danger">{t(`notes.error_${error}`)}</p>}
    <div className="notes-category-list">
      {!categories.length && <p className="notes-muted">{t('notes.noCategories')}</p>}
      {[...categories].sort((left, right) => left.name.localeCompare(right.name)).map((category) => <div key={category.id} className="ui-list-row notes-category-row">
        <NoteBadge category={category} />
        <div className="notes-category-row-actions">
          <button type="button" className="ui-icon-button notes-icon-button" aria-label={t('notes.editCategory', { name: category.name })} disabled={busy}
            onClick={() => { setEditingId(category.id); setName(category.name); setColor(category.color); useNotesStore.getState().clearError(); }}><Pencil /></button>
          <button type="button" className="ui-icon-button ui-button--danger notes-icon-button" aria-label={t('notes.deleteCategory', { name: category.name })}
            disabled={busy} onClick={() => setDeleting(category)}><Trash2 /></button>
        </div>
      </div>)}
    </div>
    {deleting && <NotesConfirmation title={t('notes.deleteCategory', { name: deleting.name })}
      message={t('notes.deleteCategoryConfirm', { name: deleting.name })} confirmLabel={t('notes.delete')}
      onClose={() => setDeleting(null)} onConfirm={() => useNotesStore.getState().deleteCategory(deleting.id)} />}
  </NotesDialog>;
}
