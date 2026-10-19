import { useEffect } from 'react';
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useTranslation } from 'react-i18next';
import type { NoteDraft } from '../../types/notes';
import { useNotesStore } from '../../stores/notesStore';

export function NoteRichEditor({ draft, disabled }: { draft: NoteDraft; disabled: boolean }) {
  const { t } = useTranslation();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false, blockquote: false, link: false }),
      Placeholder.configure({ placeholder: t('notes.bodyPlaceholder') }),
    ],
    content: draft.content,
    editable: !disabled,
    editorProps: { attributes: { class: 'notes-rich-text', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('notes.noteBody') } },
    onUpdate: ({ editor: current }) => useNotesStore.getState().updateDraft(draft.id, { content: current.getJSON() }),
  }, [draft.id]);
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  if (!editor) return null;
  const tools = [
    { name: 'bold', icon: Bold, active: editor.isActive('bold'), action: () => editor.chain().focus().toggleBold().run() },
    { name: 'italic', icon: Italic, active: editor.isActive('italic'), action: () => editor.chain().focus().toggleItalic().run() },
    { name: 'underline', icon: Underline, active: editor.isActive('underline'), action: () => editor.chain().focus().toggleUnderline().run() },
    { name: 'bullets', icon: List, active: editor.isActive('bulletList'), action: () => editor.chain().focus().toggleBulletList().run() },
    { name: 'numbered', icon: ListOrdered, active: editor.isActive('orderedList'), action: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return <>
    <div className="ui-toolbar notes-formatting" role="toolbar" aria-label={t('notes.formatting')}>
      {tools.map(({ name, icon: Icon, active, action }) => <button className="ui-icon-button" key={name} type="button" disabled={disabled}
        aria-label={t(`notes.${name}`)} title={t(`notes.${name}`)} aria-pressed={active}
        onMouseDown={(event) => event.preventDefault()} onClick={action}><Icon /></button>)}
    </div>
    <EditorContent editor={editor} className="notes-editor-body" />
  </>;
}
