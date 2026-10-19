import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDragMotion } from './dragMotion';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function dragStart(target: HTMLElement) {
  const transfer = { setDragImage: vi.fn(), setData: vi.fn(), effectAllowed: 'move' };
  const event = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer }, clientX: { value: 60 }, clientY: { value: 45 },
  });
  target.dispatchEvent(event);
  return { event, transfer };
}

function card() {
  const source = document.createElement('div');
  source.className = 'crm-kanban-card';
  source.draggable = true;
  source.innerHTML = '<span id="task-title">A task</span><div class="crm-kanban-card-drag" draggable="true">Handle</div>';
  document.body.append(source);
  vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 240, 100));
  return source;
}

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('shared native drag motion', () => {
  it('keeps the snapshot flat without changing source styling or the drag payload', () => {
    const source = card();
    source.style.boxShadow = '0 4px 12px black';
    source.querySelector('span')!.style.textShadow = '1px 1px black';
    dispose = installDragMotion(document);
    const { transfer } = dragStart(source);
    const [preview] = transfer.setDragImage.mock.calls[0] as [HTMLElement];
    for (const element of [preview, ...preview.querySelectorAll<HTMLElement>('*')]) {
      expect(element.style.boxShadow).toBe('none');
      expect(element.style.textShadow).toBe('none');
    }
    expect(source.style.boxShadow).toBe('0 4px 12px black');
    expect(transfer.setData).not.toHaveBeenCalled();
  });

  it.each([
    '<article class="notes-card" draggable="true"><span>Note</span></article>',
    '<div data-ws-tab-id="doc" draggable="true"><span>Document</span></div>',
    '<button class="scope-tab" draggable="true"><span>Project</span></button>',
    '<div class="scope-project-heading"><span draggable="true">Client</span></div>',
    '<div data-action-row="action" draggable="true"><span>Action</span></div>',
  ])('shares the same snapshot across supported surfaces: %s', (html) => {
    document.body.innerHTML = html;
    const source = document.querySelector<HTMLElement>('[draggable="true"]')!;
    source.style.backgroundColor = 'rgb(34, 34, 34)';
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 240, 100));
    dispose = installDragMotion(document);
    const { transfer } = dragStart(source.querySelector<HTMLElement>('span') ?? source);
    const [preview] = transfer.setDragImage.mock.calls[0] as [HTMLElement];
    expect(preview.textContent).toBe(source.textContent);
    expect(preview.style.opacity).toBe('0.82');
    expect(preview.style.transform).toBe('scale(0.96)');
    expect(preview.style.backgroundColor).toBe('rgb(34, 34, 34)');
  });

  it('previews only the parent folder row, not its expanded files', () => {
    const source = document.createElement('li');
    source.dataset.treeNode = '';
    source.draggable = true;
    source.innerHTML = '<div class="row-xs">Folder</div><ul><li>Private child file</li></ul>';
    document.body.append(source);
    const row = source.querySelector<HTMLElement>('.row-xs')!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 240, 32));
    dispose = installDragMotion(document);
    const { transfer } = dragStart(source);
    const [preview] = transfer.setDragImage.mock.calls[0] as [HTMLElement];
    expect(preview.textContent).toBe('Folder');
    dispose();
    expect(preview.isConnected).toBe(false);
  });

  it.each(['drop', 'dragend', 'blur'])('cleans up after %s, even when propagation is stopped', async (type) => {
    const source = card();
    source.addEventListener('dragstart', (event) => event.stopPropagation());
    dispose = installDragMotion(document);
    dragStart(source);
    await nextFrame();
    expect(source.getAttribute('data-tabs-dragging')).toBe('true');
    const target = type === 'blur' ? window : source;
    target.dispatchEvent(new Event(type, { bubbles: true }));
    expect(source.hasAttribute('data-tabs-dragging')).toBe(false);
    expect(document.querySelector('.tabs-drag-preview')).toBeNull();
  });

  it('does not decorate a cancelled drag, editable content or an unrelated native drag', async () => {
    const source = card();
    const cancel = (event: Event) => event.preventDefault();
    source.addEventListener('dragstart', cancel);
    dispose = installDragMotion(document);
    dragStart(source);
    await nextFrame();
    expect(source.hasAttribute('data-tabs-dragging')).toBe(false);
    expect(document.querySelector('.tabs-drag-preview')).toBeNull();
    source.removeEventListener('dragstart', cancel);
    source.setAttribute('contenteditable', 'true');
    expect(dragStart(source).transfer.setDragImage).not.toHaveBeenCalled();
    const link = document.createElement('a');
    link.draggable = true;
    document.body.append(link);
    expect(dragStart(link).transfer.setDragImage).not.toHaveBeenCalled();
  });

  it('ignores form controls and disposes a pending snapshot without leaving styles', async () => {
    const source = card();
    const input = document.createElement('input');
    source.append(input);
    dispose = installDragMotion(document);
    expect(dragStart(input).transfer.setDragImage).not.toHaveBeenCalled();
    dragStart(source);
    dispose();
    await nextFrame();
    expect(source.hasAttribute('data-tabs-dragging')).toBe(false);
    expect(document.querySelector('.tabs-drag-preview')).toBeNull();
    expect(dragStart(source).transfer.setDragImage).not.toHaveBeenCalled();
  });

  it('falls back cleanly when the runtime rejects a custom image', () => {
    const source = card();
    dispose = installDragMotion(document);
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: {
      setDragImage: () => { throw new Error('Unsupported'); },
    } });
    expect(() => source.dispatchEvent(event)).not.toThrow();
    expect(source.hasAttribute('data-tabs-dragging')).toBe(false);
    expect(document.querySelector('.tabs-drag-preview')).toBeNull();
  });

  it('uses the whole card for a handle drag without changing the drag payload', async () => {
    const source = card();
    dispose = installDragMotion(document);
    const { transfer } = dragStart(source.querySelector<HTMLElement>('.crm-kanban-card-drag')!);
    expect(transfer.setDragImage).toHaveBeenCalledOnce();
    const [preview, x, y] = transfer.setDragImage.mock.calls[0] as [HTMLElement, number, number];
    expect(preview.textContent).toContain('A task');
    expect(preview).not.toBe(source);
    expect(preview.isConnected).toBe(true);
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    expect(preview.querySelector('[id], [draggable="true"]')).toBeNull();
    expect([x, y]).toEqual([38, 14]);
    expect(transfer.setData).not.toHaveBeenCalled();
    expect(transfer.effectAllowed).toBe('move');
    await nextFrame();
    expect(preview.isConnected).toBe(false);
    expect(source.getAttribute('data-tabs-dragging')).toBe('true');
    source.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(source.hasAttribute('data-tabs-dragging')).toBe(false);
  });
});
