import { useState, useRef, useEffect } from 'react';
import { X, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isGeneratedWorkspaceName } from '../../stores/defaultWorkspaceFolder';
import { basename } from '../../services/fs-adapter';

const BROWSER_ROOT_PREFIX = '__BROWSER_ROOT__:';

function tabLabel(workspace: Workspace, index: number): string {
  const name = workspace.name ?? '';
  if (workspace.nameIsCustom === true) return name;
  const label = name.startsWith(BROWSER_ROOT_PREFIX)
    ? name.slice(BROWSER_ROOT_PREFIX.length)
    : name;
  // Legacy records have no intent flag; retain their name heuristic.
  const isAutomatic = workspace.nameIsCustom === false
    || !label.trim()
    || isGeneratedWorkspaceName(label)
    || name.startsWith(BROWSER_ROOT_PREFIX)
    || workspace.connectedFolders.some(({ path }) => label === (basename(path) || path));
  if (!isAutomatic) return label;

  const fileName = workspace.currentFile?.name;
  if (fileName) {
    // Strip the extension for a cleaner tab label.
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
  }
  return !label.trim() || /^Workspace \d+$/.test(label) ? `Doc ${index + 1}` : label;
}

interface WorkspaceTabProps {
  workspace: Workspace;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (newName: string) => void;
  charLimit: number;
  index: number;
  colorIndex?: number;
  /** Drag-to-reorder (optional; wired by TabBar). */
  isDragging?: boolean;
  dragOverSide?: 'before' | 'after' | null;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

export function WorkspaceTab({
  workspace,
  isActive,
  onSelect,
  onClose,
  onRename,
  charLimit,
  index,
  isDragging = false,
  dragOverSide = null,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: WorkspaceTabProps) {
  const { t } = useTranslation();
  const label = tabLabel(workspace, index);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);
  const [confirmClose, setConfirmClose] = useState(false);
  const saveCurrentFile = useWorkspaceStore((s) => s.saveCurrentFile);

  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (isActive) {
      setEditValue(label);
      setIsEditing(true);
    }
  };

  const commitEdit = () => {
    if (editValue.trim() && (editValue !== label || workspace.nameIsCustom !== true)) {
      onRename(editValue.trim());
    }
    setIsEditing(false);
  };

  const hasDirtyFile = !!workspace.currentFile?.isDirty;

  const handleSaveBeforeClose = async () => {
    if (workspace.currentFile?.isDirty) {
      await saveCurrentFile(workspace.id);
    }
    setConfirmClose(false);
    onClose();
  };

  const dragClass = [
    isDragging ? 'ws-tab--dragging' : '',
    dragOverSide ? `ws-tab--drag-over ws-tab--drag-over-${dragOverSide}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={tabRef}
      id={`tab-ws-${isActive ? 'active' : 'passive'}-${workspace.id}`}
      data-ws-tab-id={workspace.id}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      draggable={!isEditing}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onDragStart={(e) => {
        if (isEditing) {
          e.preventDefault();
          return;
        }
        // Don't start a drag from the close button or rename input.
        const target = e.target as HTMLElement;
        if (target.closest('button, input')) {
          e.preventDefault();
          return;
        }
        onDragStart?.(e);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.button === 1) {
          e.preventDefault();
          if (hasDirtyFile) { setConfirmClose(true); } else { onClose(); }
        }
      }}
      className={`group relative justify-start min-w-0 pl-3 pr-1 ${isActive ? 'tab-active' : 'tab-passive'}${dragClass ? ` ${dragClass}` : ''}`}
      title={label}
    >
      <>
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') { setIsEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            title={t('tabs.renameTab') ?? 'Rename'}
            placeholder={t('tabs.tabNamePlaceholder') ?? 'Name'}
            className="txt-xs med bg-transparent outline-none w-24"
            style={{ borderBottom: '1px solid var(--c-accent-center-panel)' }}
          />
        ) : (
          <>
            <FileText size={12} className="mr-1 flex-shrink-0" />
            <span className="txt-xs med trunc">
              {label.slice(0, charLimit)}{label.length > charLimit ? '…' : ''}
            </span>
            {hasDirtyFile && (
              <span
                className="tab-dirty-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--c-accent-center-panel)',
                  marginLeft: 4,
                  flexShrink: 0,
                }}
                title="Unsaved changes"
              />
            )}
          </>
        )}

        <button
          type="button"
          title={t('tabs.closeTab') ?? 'Close'}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            if (hasDirtyFile) { setConfirmClose(true); } else { onClose(); }
          }}
          className="tab-close"
        >
          <X size={12} />
        </button>
      </>

      {confirmClose && (
        <ConfirmDialog
          anchorRef={tabRef}
          message={t('tabs.closeConfirm') ?? 'Close this workspace? Unsaved changes will be lost.'}
          onConfirm={() => {
            setConfirmClose(false);
            onClose();
          }}
          onCancel={() => setConfirmClose(false)}
          onSave={handleSaveBeforeClose}
        />
      )}
    </div>
  );
}
