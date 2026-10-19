import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CRMDeal, PipelineStage } from '../../../types/crm';
import { KanbanBoard } from './KanbanBoard';

const stages: PipelineStage[] = ['new', 'contacted'].map((key, order) => ({
  id: key, key: key as PipelineStage['key'], label: key, order, isWon: false, isLost: false, isSpam: false,
}));
const deals: CRMDeal[] = ['a', 'b', 'c'].map((id, order) => ({
  id, title: id, stage: 'new', tags: [], createdAt: '', updatedAt: '', order,
}));

describe('CRM kanban drop placement', () => {
  it('shows the insertion line and passes the next card to the move callback', () => {
    const onMoveDeal = vi.fn();
    render(<KanbanBoard stages={stages} deals={deals} contacts={[]} companies={[]} onMoveDeal={onMoveDeal} />);
    const source = screen.getByText('a').closest<HTMLElement>('.crm-kanban-card')!;
    const target = screen.getByText('c').closest<HTMLElement>('.crm-kanban-card')!;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 200, height: 60, bottom: 260 } as DOMRect);
    const dataTransfer = { types: ['application/x-crm-deal'], setData: vi.fn(), getData: () => 'a', dropEffect: '' };
    fireEvent.dragStart(source, { dataTransfer });
    const hover = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 210 });
    Object.defineProperty(hover, 'dataTransfer', { value: dataTransfer });
    fireEvent(target, hover);
    expect(target.parentElement?.querySelector('.kanban-drop-indicator')).toBeInTheDocument();
    const drop = new MouseEvent('drop', { bubbles: true, clientY: 210 });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    fireEvent(target, drop);
    expect(onMoveDeal).toHaveBeenCalledWith('a', 'new', 'c');
    expect(document.querySelector('.kanban-drop-indicator')).toBeNull();
  });
});
