import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import '../styles/kanbanDropIndicator.css';

function dropPosition(target: HTMLElement, clientY: number) {
  const body = target.matches('.crm-kanban-column-body')
    ? target : target.querySelector<HTMLElement>('.crm-kanban-column-body');
  if (!body) return { beforeId: null, top: 2 };
  const cards = Array.from(body.querySelectorAll<HTMLElement>(':scope > [data-kanban-card-id]'))
    .filter((card) => !card.classList.contains('crm-kanban-card--dragging'));
  const next = cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  const gap = parseFloat(getComputedStyle(body).rowGap) || 6;
  const last = cards.at(-1);
  const edge = next ? next.getBoundingClientRect().top - gap / 2
    : last ? last.getBoundingClientRect().bottom + gap / 2 : null;
  return {
    beforeId: next?.dataset.kanbanCardId ?? null,
    top: edge === null ? 2 : Math.max(1, edge - body.getBoundingClientRect().top + body.scrollTop - body.clientTop),
  };
}

export function useKanbanDropIndicator(mimeType: string) {
  const [target, setTarget] = useState<{ columnId: string; top: number } | null>(null);

  useEffect(() => {
    const clear = () => setTarget(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  return {
    targetColumn: target?.columnId,
    handlers: (columnId: string, onDrop: (id: string, beforeId: string | null) => void) => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(mimeType)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const { top } = dropPosition(event.currentTarget, event.clientY);
        setTarget((current) => current?.columnId === columnId && current.top === top ? current : { columnId, top });
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setTarget((current) => current?.columnId === columnId ? null : current);
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const id = event.dataTransfer.getData(mimeType);
        setTarget(null);
        if (!id) return;
        event.preventDefault();
        onDrop(id, dropPosition(event.currentTarget, event.clientY).beforeId);
      },
    }),
    indicator: (columnId: string) => target?.columnId === columnId
      ? <div className="kanban-drop-indicator" aria-hidden="true" style={{ top: target.top }} /> : null,
  };
}
