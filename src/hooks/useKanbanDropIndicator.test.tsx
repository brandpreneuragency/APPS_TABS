import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKanbanDropIndicator } from './useKanbanDropIndicator';

const mimeType = 'application/x-task-card';

function Board({ onDrop = vi.fn() }: { onDrop?: (id: string, beforeId: string | null) => void }) {
  const drop = useKanbanDropIndicator(mimeType);
  return <div>
    {['first', 'empty'].map((column) => <div key={column} data-testid={column}
      className="crm-kanban-column-body" {...drop.handlers(column, onDrop)}>
      {column === 'first' && ['a', 'b', 'c'].map((id) => <div key={id}
        className={`crm-kanban-card${id === 'a' ? ' crm-kanban-card--dragging' : ''}`}
        data-kanban-card-id={id}>{id}</div>)}
      {drop.indicator(column)}
    </div>)}
  </div>;
}

function setup(onDrop = vi.fn()) {
  render(<Board onDrop={onDrop} />);
  const body = screen.getByTestId('first');
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
  body.style.rowGap = '6px';
  body.querySelectorAll<HTMLElement>('[data-kanban-card-id]').forEach((card, index) => {
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 100 + index * 66, bottom: 160 + index * 66, height: 60 } as DOMRect);
  });
  return { body, onDrop };
}

function drag(element: HTMLElement, type: 'dragover' | 'drop', clientY: number, types = [mimeType]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: { value: { types, getData: (type: string) => type === mimeType ? 'a' : '', dropEffect: '' } },
  });
  fireEvent(element, event);
  return event;
}

describe('kanban drop indicator', () => {
  it('tracks before, between and after cards and drops at the indicated position', () => {
    const { body, onDrop } = setup();
    drag(body, 'dragover', 180);
    expect(body.querySelector('.kanban-drop-indicator')).toHaveStyle({ top: '63px' });
    drag(body, 'dragover', 220);
    expect(body.querySelector('.kanban-drop-indicator')).toHaveStyle({ top: '129px' });
    drag(body, 'drop', 220);
    expect(onDrop).toHaveBeenCalledWith('a', 'c');
    expect(body.querySelector('.kanban-drop-indicator')).toBeNull();
    drag(body, 'dragover', 300);
    expect(body.querySelector('.kanban-drop-indicator')).toHaveStyle({ top: '195px' });
    drag(body, 'drop', 300);
    expect(onDrop).toHaveBeenLastCalledWith('a', null);
  });

  it('supports empty columns, scroll offsets and cancellation outside the board', () => {
    const { body } = setup();
    body.scrollTop = 80;
    drag(body, 'dragover', 220);
    expect(body.querySelector('.kanban-drop-indicator')).toHaveStyle({ top: '209px' });
    drag(screen.getByTestId('empty'), 'dragover', 100);
    expect(body.querySelector('.kanban-drop-indicator')).toBeNull();
    expect(screen.getByTestId('empty').querySelector('.kanban-drop-indicator')).toBeInTheDocument();
    fireEvent.dragEnd(window);
    expect(document.querySelector('.kanban-drop-indicator')).toBeNull();
  });

  it('ignores unrelated drags and keeps the marker when crossing card children', () => {
    const { body } = setup();
    expect(drag(body, 'dragover', 180, ['Files']).defaultPrevented).toBe(false);
    expect(body.querySelector('.kanban-drop-indicator')).toBeNull();
    drag(body, 'dragover', 180);
    fireEvent(body, new MouseEvent('dragleave', { bubbles: true, relatedTarget: screen.getByText('b') }));
    expect(body.querySelector('.kanban-drop-indicator')).toBeInTheDocument();
    fireEvent(body, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }));
    expect(body.querySelector('.kanban-drop-indicator')).toBeNull();
  });
});
