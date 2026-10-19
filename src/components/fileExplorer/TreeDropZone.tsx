import { useEffect, useState, type CSSProperties, type DragEvent } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import './treeDropZone.css';

interface TreeDropZoneProps {
  targetDirFullPath: string;
  depth: number;
  end?: boolean;
}

/** A gap moves into this list's directory; it does not change alphabetical order. */
export function TreeDropZone({ targetDirFullPath, depth, end = false }: TreeDropZoneProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const clear = () => setActive(false);
    document.addEventListener('dragend', clear, true);
    document.addEventListener('drop', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('dragend', clear, true);
      document.removeEventListener('drop', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, [active]);

  const isTreeDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes('application/x-tabs-tree-node');

  const handleDrop = async (event: DragEvent) => {
    event.stopPropagation();
    setActive(false);
    if (!isTreeDrag(event)) return;
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData('text/plain');
    const { activeWorkspaceId, moveInWorkspace } = useWorkspaceStore.getState();
    if (!sourcePath || !activeWorkspaceId) return;
    // The store also guards self/descendant moves, collisions, and same-parent drops.
    await moveInWorkspace(activeWorkspaceId, sourcePath, targetDirFullPath);
  };

  return (
    <li
      aria-hidden="true"
      className={`tree-drop-zone${end ? ' tree-drop-zone--end' : ''}`}
      style={{ '--tree-drop-indent': `${6 + depth * 12}px` } as CSSProperties}
    >
      <div
        className="tree-drop-zone-hitarea"
        data-tree-drop-directory={targetDirFullPath}
        data-active={active || undefined}
        draggable={false}
        onDragOver={(event) => {
          event.stopPropagation();
          if (!isTreeDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
        }}
        onDrop={handleDrop}
      />
    </li>
  );
}
