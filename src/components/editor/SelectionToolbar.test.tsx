import { createRef } from 'react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { SelectionToolbar } from './SelectionToolbar';

let editor: Editor;

afterEach(() => {
  cleanup();
  editor.destroy();
});

function setup() {
  editor = new Editor({ extensions: [StarterKit], content: '<p>Text</p>' });
  const editorScrollRef = createRef<HTMLDivElement>();
  const { getByText } = render(
    <I18nextProvider i18n={i18n}>
      <div ref={editorScrollRef}><p>Text</p></div>
      <SelectionToolbar editor={editor} editorScrollRef={editorScrollRef} />
    </I18nextProvider>,
  );
  return getByText('Text');
}

describe('SelectionToolbar activation', () => {
  it('opens on right-click and prevents the native context menu', () => {
    expect(fireEvent.contextMenu(setup(), { button: 2 })).toBe(false);
    expect(document.querySelector('.selection-toolbar')).not.toBeNull();
  });

  it.each([0, 1])('does not open for mouse button %s', (button) => {
    const target = setup();
    fireEvent.mouseUp(target, { button });
    fireEvent.click(target, { button, detail: 1 });
    fireEvent.contextMenu(target, { button });
    expect(document.querySelector('.selection-toolbar')).toBeNull();
  });

  it('does not open on mouse release or keyboard activation', () => {
    const target = setup();
    fireEvent.mouseUp(target, { button: 0 });
    fireEvent.click(target, { button: 0, detail: 0 });
    fireEvent.contextMenu(target, { button: 0 });
    expect(document.querySelector('.selection-toolbar')).toBeNull();
  });

  it('keeps the toolbar open on a subsequent right-click', () => {
    const target = setup();
    fireEvent.contextMenu(target, { button: 2 });
    fireEvent.contextMenu(target, { button: 2 });
    expect(document.querySelector('.selection-toolbar')).not.toBeNull();
  });

  it('preserves the native context menu outside the editor', () => {
    setup();
    expect(fireEvent.contextMenu(document.body, { button: 2 })).toBe(true);
    expect(document.querySelector('.selection-toolbar')).toBeNull();
  });

  it('does not open for a read-only editor', () => {
    const target = setup();
    editor.setEditable(false);
    expect(fireEvent.contextMenu(target, { button: 2 })).toBe(true);
    expect(document.querySelector('.selection-toolbar')).toBeNull();
  });

  it('renders selection actions below the formatting controls', () => {
    const target = setup();
    fireEvent.contextMenu(target, { button: 2 });

    const actionButtons = Array.from(document.querySelectorAll('.selection-toolbar-action-btn'));
    expect(actionButtons).toHaveLength(4);
    expect(actionButtons.map((button) => button.textContent)).toEqual([
      'Select All',
      'Cut',
      'Copy',
      'Paste',
    ]);
  });
});
