const DRAG_SURFACES = [
  '.crm-kanban-card', '.notes-card', '[data-ws-tab-id]',
  '.scope-tab[draggable="true"]', '.scope-project-heading > span[draggable="true"]',
  '[data-tree-node][draggable="true"]', '[data-action-row][draggable="true"]',
].join(', ');

const DRAG_SCALE = 0.96;
const PREVIEW_STYLES = [
  'display', 'box-sizing', 'position', 'inset', 'width', 'height', 'min-width', 'min-height',
  'max-width', 'max-height', 'padding', 'margin', 'gap', 'flex', 'flex-direction', 'flex-wrap',
  'align-items', 'align-self', 'justify-content', 'grid-template-columns', 'grid-template-rows',
  'grid-template-areas', 'grid-area', 'align-content', 'overflow', 'border', 'border-radius',
  'background-color', 'color', 'font', 'line-height', 'letter-spacing', 'text-align',
  'text-transform', 'text-overflow', 'white-space', 'word-break', 'overflow-wrap',
  'opacity', 'transform', 'transform-origin', 'fill', 'stroke', 'stroke-width',
  '-webkit-line-clamp', '-webkit-box-orient', 'vertical-align',
];

/** One native snapshot per drag; no pointer tracking or React/store updates. */
export function installDragMotion(document: Document): () => void {
  const window = document.defaultView;
  if (!window) return () => undefined;
  let source: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let frame: number | null = null;

  const clear = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    source?.removeAttribute('data-tabs-dragging');
    source = null;
    preview?.remove();
    preview = null;
  };

  const start = (event: DragEvent) => {
    if (event.defaultPrevented || !event.dataTransfer?.setDragImage || !(event.target instanceof Element)) return;
    const surface = event.target.closest<HTMLElement>(DRAG_SURFACES);
    if (!surface?.draggable || surface.closest('[contenteditable="true"]')) return;
    const control = event.target.closest('button, input, select, textarea, a, [contenteditable="true"]');
    if (control && control !== surface && !control.matches('.notes-drag-handle, .notes-card-hitarea')) return;
    if (event.target.closest('[draggable="false"]')) return;

    // Expanded folders must preview only their own row, never their descendants.
    const visual = surface.matches('[data-tree-node]')
      ? surface.querySelector<HTMLElement>(':scope > .row-xs') ?? surface
      : surface;
    const bounds = visual.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    clear();
    const clone = visual.cloneNode(true) as HTMLElement;
    const visualStyle = window.getComputedStyle(visual);
    const originals = [visual, ...visual.querySelectorAll<HTMLElement | SVGElement>('*')];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement | SVGElement>('*')];
    originals.forEach((original, index) => {
      const copy = copies[index];
      const computed = window.getComputedStyle(original);
      for (const property of PREVIEW_STYLES) copy.style.setProperty(property, computed.getPropertyValue(property));
      copy.removeAttribute('id');
      copy.removeAttribute('draggable');
      copy.removeAttribute('data-tabs-dragging');
      copy.style.setProperty('animation', 'none');
      copy.style.setProperty('transition', 'none');
      copy.style.boxShadow = 'none';
      copy.style.textShadow = 'none';
    });
    clone.classList.remove('crm-kanban-card--dragging', 'notes-card--dragging', 'ws-tab--dragging', 'is-dragging');
    clone.classList.add('tabs-drag-preview');
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    Object.assign(clone.style, {
      position: 'fixed', left: '-10000px', top: '0', right: 'auto', bottom: 'auto',
      margin: '0', width: `${bounds.width}px`, height: `${bounds.height}px`,
      minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: '420px',
      boxSizing: 'border-box', overflow: 'hidden', pointerEvents: 'none',
      transform: `scale(${DRAG_SCALE})`, transformOrigin: 'top left', opacity: '0.82',
      backgroundColor: visualStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        ? 'var(--c-background-2)' : visualStyle.backgroundColor,
      borderRadius: 'var(--radius-sm)',

    });
    document.body.append(clone);
    try {
      const x = Math.round(Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)) * DRAG_SCALE);
      const y = Math.round(Math.max(0, Math.min(420, bounds.height, event.clientY - bounds.top)) * DRAG_SCALE);
      event.dataTransfer.setDragImage(clone, x, y);
    } catch {
      clone.remove();
      return; // Leave unsupported native runtimes on their default drag image.
    }
    source = visual;
    preview = clone;
    // Let the WebView capture the image before fading its original in place.
    frame = window.requestAnimationFrame(() => {
      frame = null;
      preview?.remove();
      preview = null;
      if (event.defaultPrevented || !source?.isConnected) clear();
      else source.setAttribute('data-tabs-dragging', 'true');
    });
  };

  // Capture also sees file-tree/client/handle drags that stop propagation.
  document.addEventListener('dragstart', start, true);
  document.addEventListener('dragend', clear, true);
  document.addEventListener('drop', clear, true);
  window.addEventListener('blur', clear);
  window.addEventListener('pagehide', clear);
  return () => {
    clear();
    document.removeEventListener('dragstart', start, true);
    document.removeEventListener('dragend', clear, true);
    document.removeEventListener('drop', clear, true);
    window.removeEventListener('blur', clear);
    window.removeEventListener('pagehide', clear);
  };
}
