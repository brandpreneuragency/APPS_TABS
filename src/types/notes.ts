import type { JSONContent } from '@tiptap/react';

export const NOTE_COLORS = ['accent', 'blue', 'green', 'amber', 'red', 'neutral'] as const;
export type NoteColor = typeof NOTE_COLORS[number];

export interface NoteCategory {
  id: string;
  name: string;
  color: NoteColor;
}

export interface NoteValue {
  title: string;
  content: JSONContent;
  categoryId: string | null;
}

export interface NoteRecord extends NoteValue {
  id: string;
  pinned: boolean;
  order: number;
  revision: number;
}

/** Drafts are local recovery, not published notes. Save is always explicit. */
export interface NoteDraft extends NoteValue {
  id: string;
  order: number;
  baseRevision: number | null;
}

export function emptyNoteContent(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function noteText(content: JSONContent): string {
  if (content.type === 'text') return content.text ?? '';
  const separator = content.type === 'paragraph' ? '' : ' ';
  return (content.content ?? []).map(noteText).join(separator);
}
