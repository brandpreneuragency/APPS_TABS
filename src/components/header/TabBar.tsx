import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { WorkspaceTab } from './WorkspaceTab';

export function TabBar() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: 'before' | 'after' } | null>(null);
  const didDrag = useRef(false);

  return (
    <div className="scope-tabs document-scope-tabs" role="tablist" aria-orientation="vertical" aria-label={t('tabs.openTabs')}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input, button')) return;
        const index = workspaces.findIndex((workspace) => workspace.id === activeId);
        const next = event.key === 'ArrowDown' ? (index + 1) % workspaces.length
          : event.key === 'ArrowUp' ? (index - 1 + workspaces.length) % workspaces.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? workspaces.length - 1 : null;
        if (next === null || !workspaces[next]) return;
        event.preventDefault();
        useWorkspaceStore.getState().setActiveWorkspace(workspaces[next].id);
        event.currentTarget.querySelectorAll<HTMLElement>('[data-ws-tab-id]')[next]?.focus();
      }}>
      {workspaces.map((workspace, index) => (
        <WorkspaceTab key={workspace.id} workspace={workspace} index={index} isActive={workspace.id === activeId}
          onSelect={() => { if (!didDrag.current) useWorkspaceStore.getState().setActiveWorkspace(workspace.id); }}
          onClose={() => useWorkspaceStore.getState().deleteWorkspace(workspace.id)}
          onRename={(name) => useWorkspaceStore.getState().renameWorkspace(workspace.id, name)}
          charLimit={80} isDragging={dragId === workspace.id}
          dragOverSide={dropTarget?.id === workspace.id ? dropTarget.side : null}
          onDragStart={(event) => {
            didDrag.current = true;
            setDragId(workspace.id);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', workspace.id);
          }}
          onDragOver={(event) => {
            if (!dragId || dragId === workspace.id) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setDropTarget({ id: workspace.id, side: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragId && dropTarget && dragId !== workspace.id) {
              const ids = workspaces.map((item) => item.id).filter((id) => id !== dragId);
              const index = ids.indexOf(workspace.id) + (dropTarget.side === 'after' ? 1 : 0);
              ids.splice(index, 0, dragId);
              useWorkspaceStore.getState().reorderWorkspaces(ids);
            }
            setDragId(null);
            setDropTarget(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropTarget(null);
            window.setTimeout(() => { didDrag.current = false; }, 0);
          }}
        />
      ))}
    </div>
  );
}
