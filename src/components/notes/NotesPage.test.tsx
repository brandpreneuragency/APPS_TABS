import 'fake-indexeddb/auto';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesDatabase } from '../../services/notes/database';
import { useNotesStore } from '../../stores/notesStore';
import { NotesPage } from './NotesPage';
import { NotesCategoryManager } from './NotesCategoryManager';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(async () => {
  useNotesStore.setState(useNotesStore.getInitialState());
  await Promise.all([notesDatabase.notes.clear(), notesDatabase.drafts.clear(), notesDatabase.categories.clear()]);
  await useNotesStore.getState().load();
});
afterEach(async () => { cleanup(); await useNotesStore.getState().flush(); });

async function savedNote(title = 'Ideas') {
  const id = await useNotesStore.getState().createNote();
  useNotesStore.getState().updateDraft(id, { title, content: { type: 'doc', content: [
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An idea' }] }] }] },
  ] } });
  await useNotesStore.getState().saveNote(id);
  return id;
}

describe('Notes cards', () => {
  it('requires a category name and explicit color selection, then resets after saving', async () => {
    render(<NotesCategoryManager />);
    const save = screen.getByRole('button', { name: 'notes.save' });
    const name = screen.getByRole('textbox', { name: 'notes.categoryName' });
    const color = screen.getByRole('button', { name: 'notes.color_blue' });
    const form = name.closest('form')!;
    expect(save).toBeDisabled();
    expect(save.querySelector('.lucide-check')).not.toBeNull();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    fireEvent.change(name, { target: { value: 'Design' } });
    expect(save).toBeDisabled();
    fireEvent.submit(form);
    expect(useNotesStore.getState().categories).toHaveLength(0);
    fireEvent.click(color);
    expect(save).toBeEnabled();
    fireEvent.change(name, { target: { value: '   ' } });
    expect(save).toBeDisabled();
    fireEvent.submit(form);
    expect(useNotesStore.getState().categories).toHaveLength(0);
    fireEvent.change(name, { target: { value: 'Design' } });
    fireEvent.click(save);
    await waitFor(() => expect(name).toHaveValue(''));
    expect(await notesDatabase.categories.toArray()).toEqual([
      expect.objectContaining({ name: 'Design', color: 'blue' }),
    ]);
    expect(save).toBeDisabled();
    expect(color).toHaveAttribute('aria-pressed', 'false');
  });

  it('drags a card before and after another card and persists its position', async () => {
    const first = await savedNote('First');
    await savedNote('Second');
    render(<NotesPage />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const source = screen.getByRole('article', { name: 'First' });
    const target = screen.getByRole('article', { name: 'Second' });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    const dragAt = (type: 'dragOver' | 'drop', clientY: number) => {
      const event = createEvent[type](target, { dataTransfer });
      Object.defineProperty(event, 'clientY', { value: clientY });
      fireEvent(target, event);
    };
    expect(screen.queryByRole('button', { name: 'notes.reorder' })).toBeNull();
    fireEvent.dragStart(within(source).getByRole('button', { name: 'notes.edit' }), { dataTransfer });
    expect(source).toHaveClass('notes-card--dragging');
    dragAt('dragOver', 10);
    expect(target).toHaveClass('notes-card--drop-before');
    dragAt('drop', 10);
    await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('First'));
    expect(screen.queryByRole('textbox', { name: 'notes.noteTitle' })).toBeNull();
    // The optimistic order renders before persistence releases the drag lock.
    await waitFor(() => expect(source).toHaveAttribute('draggable', 'true'));
    fireEvent.dragStart(source, { dataTransfer });
    dragAt('dragOver', 190);
    expect(target).toHaveClass('notes-card--drop-after');
    dragAt('drop', 190);
    await waitFor(() => expect(screen.getAllByRole('article')[1]).toHaveAccessibleName('First'));
    expect(await notesDatabase.notes.get(first)).toMatchObject({ order: 1 });
    expect(source).not.toHaveClass('notes-card--dragging');
  });

  it('reorders filtered notes with the keyboard without losing hidden notes', async () => {
    await savedNote('Match first');
    await savedNote('Hidden');
    await savedNote('Match last');
    render(<NotesPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Match' } });
    const handle = within(screen.getByRole('article', { name: 'Match first' })).getByRole('button', { name: 'notes.edit' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Match first'));
    expect(handle).toHaveFocus();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label')))
      .toEqual(['Match first', 'Match last', 'Hidden']);
  });

  it('uses the horizontal drop position in a multi-column grid and clears cancelled drags', async () => {
    await savedNote('First');
    await savedNote('Second');
    render(<NotesPage />);
    const source = screen.getByRole('article', { name: 'First' });
    const target = screen.getByRole('article', { name: 'Second' });
    const grid = target.parentElement!;
    vi.spyOn(grid, 'clientWidth', 'get').mockReturnValue(700);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(source, { dataTransfer });
    const over = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperties(over, { clientX: { value: 300 }, clientY: { value: 10 } });
    fireEvent(target, over);
    expect(target).toHaveClass('notes-card--drop-after');
    fireEvent.dragEnd(source, { dataTransfer });
    expect(target).not.toHaveClass('notes-card--drop-after');
    expect(source).not.toHaveClass('notes-card--dragging');
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Second', 'First']);
    const foreignDrop = createEvent.drop(target, { dataTransfer });
    fireEvent(target, foreignDrop);
    await act(() => useNotesStore.getState().flush());
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Second', 'First']);
  });

  it('rejects cross-pin drops and disables dragging while editing', async () => {
    const first = await savedNote('Pinned');
    await useNotesStore.getState().togglePin(first);
    const second = await savedNote('Plain');
    render(<NotesPage />);
    const source = screen.getByRole('article', { name: 'Plain' });
    const target = screen.getByRole('article', { name: 'Pinned' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).not.toHaveClass('notes-card--drop-before');
    fireEvent.drop(target, { dataTransfer });
    await act(() => useNotesStore.getState().flush());
    expect(await notesDatabase.notes.get(second)).toMatchObject({ order: 2, pinned: false });
    fireEvent.click(within(source).getByRole('button', { name: 'notes.edit' }));
    expect(source).toHaveAttribute('draggable', 'false');
    expect(within(source).queryByRole('button', { name: 'notes.reorder' })).toBeNull();
  });

  it('renders formatted text and a category badge without calendar/date UI, then edits in place on click', async () => {
    const id = await savedNote();
    render(<NotesPage />);
    expect(screen.getByRole('list')).toHaveTextContent('An idea');
    expect(screen.getByText('notes.uncategorized')).toBeInTheDocument();
    expect(document.querySelector('time, input[type="date"], .task-calendar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'notes.edit' }));
    expect(screen.getByRole('textbox', { name: 'notes.noteTitle' })).toHaveValue('Ideas');
    expect(screen.getByRole('textbox', { name: 'notes.noteBody' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'notes.noteTitle' }), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'notes.save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'notes.noteTitle' })).toBeNull());
    expect(await notesDatabase.notes.get(id)).toMatchObject({ title: 'Updated' });
  });

  it('offers only pin and confirmed deletion, preserves a note when deletion is cancelled', async () => {
    const id = await savedNote();
    render(<NotesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.actions' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'notes.pin' }));
    await waitFor(() => expect(useNotesStore.getState().notes[0].pinned).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'notes.actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'notes.delete' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'notes.cancel' }));
    expect(await notesDatabase.notes.get(id)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'notes.actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'notes.delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'notes.delete' }));
    await waitFor(() => expect(useNotesStore.getState().notes).toHaveLength(0));
    expect(await notesDatabase.notes.get(id)).toBeUndefined();
  });

  it('keeps in-progress text when Notes is unmounted and opened again', async () => {
    const id = await savedNote();
    const first = render(<NotesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'notes.noteTitle' }), { target: { value: 'Unfinished' } });
    first.unmount();
    await act(() => useNotesStore.getState().flush());
    render(<NotesPage />);
    expect(screen.getByRole('textbox', { name: 'notes.noteTitle' })).toHaveValue('Unfinished');
    expect(await notesDatabase.notes.get(id)).toMatchObject({ title: 'Ideas' });
  });
});
