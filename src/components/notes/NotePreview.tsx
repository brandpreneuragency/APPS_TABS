import type { JSONContent } from '@tiptap/react';
import type { ReactNode } from 'react';

function renderNode(node: JSONContent, key: number): ReactNode {
  const children = node.content?.map(renderNode);
  if (node.type === 'text') {
    let value: ReactNode = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') value = <strong>{value}</strong>;
      if (mark.type === 'italic') value = <em>{value}</em>;
      if (mark.type === 'underline') value = <u>{value}</u>;
      if (mark.type === 'strike') value = <s>{value}</s>;
      if (mark.type === 'code') value = <code>{value}</code>;
    }
    return <span key={key}>{value}</span>;
  }
  switch (node.type) {
    case 'paragraph': return <p key={key}>{children ?? <br />}</p>;
    case 'bulletList': return <ul key={key}>{children}</ul>;
    case 'orderedList': return <ol key={key} start={typeof node.attrs?.start === 'number' ? node.attrs.start : 1}>{children}</ol>;
    case 'listItem': return <li key={key}>{children}</li>;
    case 'hardBreak': return <br key={key} />;
    default: return <span key={key}>{children}</span>;
  }
}

/** Render the supported rich-text nodes as React, never raw imported HTML. */
export function NotePreview({ content }: { content: JSONContent }) {
  return <div className="notes-rich-text notes-preview">{content.content?.map(renderNode)}</div>;
}
