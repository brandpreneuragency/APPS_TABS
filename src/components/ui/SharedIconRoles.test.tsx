import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Plus } from 'lucide-react';
import { ComposerIconButton, ComposerSendButton } from './Composer';
import { AttachmentPreviewItem } from './AttachmentPreview';
import { ContextWindowRing } from '../contextWindow/ContextWindowRing';
const composerCss = readFileSync('src/components/ui/composer.css', 'utf8');
const sidebarCss = readFileSync('src/components/sidebar/aiSidebar.css', 'utf8');
const modelCss = readFileSync('src/components/sidebar/ChatModelControls.css', 'utf8');

vi.mock('../contextWindow/useContextWindowData', () => ({
  useContextWindowData: () => ({ usagePercent: 25 }),
}));

describe('shared icon roles', () => {
  it('keeps composer actions on the shared square role and preserves disabled behavior', () => {
    const send = vi.fn();
    render(<><ComposerIconButton title="Attach"><Plus /></ComposerIconButton>
      <ComposerSendButton title="Send" onClick={send} disabled /></>);
    expect(screen.getByTitle('Attach')).toHaveClass('ui-icon-button');
    expect(screen.getByTitle('Send')).toHaveClass('ui-icon-button');
    fireEvent.click(screen.getByTitle('Send'));
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['image', 'file'] as const)('uses a shared remove control for %s without opening its attachment', (kind) => {
    const remove = vi.fn();
    const open = vi.fn();
    render(<AttachmentPreviewItem item={{ name: 'fixture.png', kind, previewUrl: 'data:image/png;base64,AA==' }}
      onRemove={remove} onClick={open} />);
    const button = screen.getByRole('button', { name: 'Remove attachment' });
    expect(button).toHaveClass('ui-icon-button');
    expect(button.querySelector('svg')).toHaveClass('ui-icon');
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('scales the custom ring with CSS without changing its coordinate system', () => {
    const { container } = render(<ContextWindowRing size={18} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveClass('ui-icon');
    expect(svg).toHaveAttribute('viewBox', '0 0 18 18');
    expect(svg).not.toHaveAttribute('width');
    expect(svg.querySelector('circle')).toHaveAttribute('r', '8');
  });

  it('leaves icon geometry to the role and reserves attachment overflow room', () => {
    const removal = composerCss.match(/\.composer-attachment-thumb-remove\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(removal).not.toMatch(/(?:width|height|padding)\s*:/);
    expect(composerCss).toContain('margin-top: var(--c-space-0)');
    expect(composerCss).toContain('margin-right: var(--c-space-0)');
    expect(sidebarCss).not.toMatch(/\.composer-(?:tool|attach)-button\s*\{/);
    expect(modelCss).not.toMatch(/\.chat-reasoning-trigger,\s*:root #chat-input-card \.chat-options-trigger\s*\{/);
  });
});
