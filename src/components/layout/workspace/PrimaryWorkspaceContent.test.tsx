import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrimaryWorkspaceContent } from './PrimaryWorkspaceContent';

vi.mock('./ContextResizeHandle', () => ({ ContextResizeHandle: () => <div /> }));

describe('PrimaryWorkspaceContent calendar layout', () => {
  const props = {
    mode: 'tasks' as const,
    contextPanel: <input aria-label="Task draft" defaultValue="Keep this draft" />,
    centerPanel: <input aria-label="Task editor" defaultValue="Keep this edit" />,
    contextPanelAvailable: true,
    contextPanelOpen: true,
    contextPanelWidthVw: 30,
  };

  it('keeps the composer and editor mounted when expanding and restoring the calendar', () => {
    const view = render(<PrimaryWorkspaceContent {...props} />);
    const draft = screen.getByLabelText('Task draft');
    const editor = screen.getByLabelText('Task editor');
    view.rerender(<PrimaryWorkspaceContent {...props} contextOnly />);
    expect(view.container.firstChild).toHaveAttribute('data-context-only', 'true');
    expect(screen.getByLabelText('Task draft')).toBe(draft);
    expect(screen.getByLabelText('Task editor')).toBe(editor);
    view.rerender(<PrimaryWorkspaceContent {...props} />);
    expect(screen.getByLabelText('Task draft')).toBe(draft);
    expect(screen.getByLabelText('Task editor')).toBe(editor);
  });

  it('shows the calendar even if the contextual panel was closed', () => {
    render(<PrimaryWorkspaceContent {...props} contextPanelOpen={false} contextOnly />);
    expect(screen.getByLabelText('Task draft')).toBeInTheDocument();
  });
});
