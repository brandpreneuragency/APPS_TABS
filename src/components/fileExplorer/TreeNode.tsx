import type React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, File,
  MoreHorizontal, SquarePlus, SquareSlash, Pencil, Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, type TreeNode as TreeNodeType } from '../../stores/workspaceStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface TreeNodeProps {
  node: TreeNodeType;
  depth: number;
  searchActive?: boolean;
}

interface ContextMenu {
  x: number;
  y: number;
}

interface InlineInput {
  mode: 'rename' | 'new-file' | 'new-folder';
}

export function TreeNode({ node, depth, searchActive = false }: TreeNodeProps) {
  const { t } = useTranslation();
  const {
    workspaces,
    activeWorkspaceId,
    toggleExpandedPath,
    setExpandedPaths,
    setSelectedTreePath,
    ensureChildrenLoaded,
    createFileInWorkspace,
    createDirectoryInWorkspace,
    renameInWorkspace,
    removeInWorkspace,
    moveInWorkspace,
    swapFileInWorkspace,
    saveCurrentFile,
    createWorkspace,
    connectFolderInWorkspace,
    renameWorkspace,
  } = useWorkspaceStore();

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const expandedPaths = activeWs?.expandedPaths ?? [];
  const selectedTreePath = activeWs?.selectedTreePath ?? null;

  const expanded = (searchActive && node.kind === 'directory') || expandedPaths.includes(node.path);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [inlineInput, setInlineInput] = useState<InlineInput | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showKebab, setShowKebab] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [confirmSwap, setConfirmSwap] = useState<{ fileName: string; targetNode: TreeNodeType } | null>(null);

  const contextRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (contextRef.current?.contains(target)) return;
      if (kebabRef.current?.contains(target)) return;
      closeContextMenu();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown);
    }, 0);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  useEffect(() => {
    if (inlineInput && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [inlineInput]);


  const handleClick = async () => {
    if (inlineInput?.mode === 'rename') return;
    if (node.kind === 'directory') {
      if (!expanded && node.children === undefined) {
        await ensureChildrenLoaded(activeWorkspaceId!, node.fullPath);
      }
      toggleExpandedPath(activeWorkspaceId!, node.path);
    }
    setSelectedTreePath(activeWorkspaceId!, node.path);
    if (node.kind === 'file') {
      await handleFileSwap(node);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (inlineInput) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      await handleClick();
    } else if (e.key === 'F2') {
      e.preventDefault();
      startRename();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      setConfirmDelete(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const allNodes = Array.from(
        document.querySelectorAll<HTMLLIElement>('[data-tree-node]')
      );
      const idx = allNodes.indexOf(e.currentTarget);
      const next = e.key === 'ArrowDown' ? allNodes[idx + 1] : allNodes[idx - 1];
      next?.focus();
    } else if (e.key === 'ArrowRight' && node.kind === 'directory' && !expanded) {
      e.preventDefault();
      if (node.children === undefined) await ensureChildrenLoaded(activeWorkspaceId!, node.fullPath);
      toggleExpandedPath(activeWorkspaceId!, node.path);
    } else if (e.key === 'ArrowLeft' && node.kind === 'directory' && expanded) {
      e.preventDefault();
      toggleExpandedPath(activeWorkspaceId!, node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const startRename = () => {
    setContextMenu(null);
    setInlineInput({ mode: 'rename' });
    setInputValue(node.name);
  };

  const startNewFile = () => {
    setContextMenu(null);
    // expand directory first if not expanded
    if (!expanded) toggleExpandedPath(activeWorkspaceId!, node.path);
    setInlineInput({ mode: 'new-file' });
    setInputValue('');
  };

  const startNewFolder = () => {
    setContextMenu(null);
    if (!expanded) toggleExpandedPath(activeWorkspaceId!, node.path);
    setInlineInput({ mode: 'new-folder' });
    setInputValue('');
  };

  const commitInput = async () => {
    if (!inlineInput) return;
    const val = inputValue.trim();
    setInlineInput(null);

    if (!val) return;

    if (inlineInput.mode === 'rename') {
      if (val === node.name) return;
      const oldDisplayPath = node.path;
      const result = await renameInWorkspace(activeWorkspaceId!, node.fullPath, val);
      if (result) {
        // update expanded paths if it was a directory
        if (result.kind === 'directory') {
          const parentDisplay = oldDisplayPath.includes('/')
            ? oldDisplayPath.substring(0, oldDisplayPath.lastIndexOf('/'))
            : '';
          const newDisplayPath = parentDisplay
            ? `${parentDisplay}/${val}`
            : val;
          const updated = expandedPaths
            .filter((p) => p !== oldDisplayPath && !p.startsWith(oldDisplayPath + '/'))
            .concat(expanded ? [newDisplayPath] : []);
          setExpandedPaths(activeWorkspaceId!, updated);
        }
      }
    } else if (inlineInput.mode === 'new-file') {
      await createFileInWorkspace(activeWorkspaceId!, node.fullPath, val);
    } else if (inlineInput.mode === 'new-folder') {
      await createDirectoryInWorkspace(activeWorkspaceId!, node.fullPath, val);
    }
  };

  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitInput();
    else if (e.key === 'Escape') setInlineInput(null);
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    await removeInWorkspace(activeWorkspaceId!, node.fullPath);
    // clean up expanded paths (expandedPaths uses display paths)
    const ownDisplayPath = node.path;
    setExpandedPaths(activeWorkspaceId!, expandedPaths.filter(
      (p) => p !== ownDisplayPath && !p.startsWith(ownDisplayPath + '/')
    ));
  };

  // ── File swap with unsaved-changes prompt ──
  const handleFileSwap = async (targetNode: TreeNodeType) => {
    if (!activeWs || !activeWorkspaceId) return;

    const currentFile = activeWs.currentFile;

    // No current file or not dirty → swap immediately
    if (!currentFile || !currentFile.isDirty) {
      await swapFileInWorkspace(activeWorkspaceId, targetNode, { skipPrompt: true });
      return;
    }

    // Dirty file → show confirm dialog
    setConfirmSwap({ fileName: currentFile.name, targetNode });
  };

  const onSwapSave = async () => {
    if (!confirmSwap || !activeWorkspaceId) return;
    await saveCurrentFile(activeWorkspaceId);
    await swapFileInWorkspace(activeWorkspaceId, confirmSwap.targetNode, { skipPrompt: true });
    setConfirmSwap(null);
  };

  const onSwapDiscard = async () => {
    if (!confirmSwap || !activeWorkspaceId) return;
    await swapFileInWorkspace(activeWorkspaceId, confirmSwap.targetNode, { skipPrompt: true });
    setConfirmSwap(null);
  };

  const onSwapCancel = () => {
    setConfirmSwap(null);
  };

  // ── Middle-click: open new workspace ──
  const handleAuxClick = async (e: React.MouseEvent) => {
    if (node.kind !== 'file') return;
    e.preventDefault();
    // Create new workspace, connect parent folder, load file
    const parentPath = node.fullPath.substring(0, node.fullPath.lastIndexOf('/'));
    const newWs = await createWorkspace();
    if (parentPath) {
      await connectFolderInWorkspace(newWs.id, parentPath);
    }
    await swapFileInWorkspace(newWs.id, node, { skipPrompt: true });
    const folderName = parentPath.split('/').pop() || 'Workspace';
    renameWorkspace(newWs.id, folderName);
  };

  // ── Drag-and-drop handlers ──────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    // 'copy' as well as 'move' so the chat composer can accept the drop as a
    // context attachment without triggering the tree's move-drop semantics.
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', node.fullPath);
    // App-specific payload the composer reads to attach the file/folder as
    // AI context (carries kind + display path so no tree lookup is needed).
    e.dataTransfer.setData(
      'application/x-tabs-tree-node',
      JSON.stringify({ fullPath: node.fullPath, kind: node.kind, path: node.path })
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (node.kind !== 'directory') return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (node.kind !== 'directory') return;
    const srcPath = e.dataTransfer.getData('text/plain');
    if (!srcPath || srcPath === node.fullPath) return;
    const result = await moveInWorkspace(activeWorkspaceId!, srcPath, node.fullPath);
    if (result) {
      // Auto-expand target folder (expandedPaths uses display paths)
      if (!expandedPaths.includes(node.path)) toggleExpandedPath(activeWorkspaceId!, node.path);
    }
  };

  return (
    <>
      <li
        data-tree-node
        tabIndex={0}
        className={`tree-node group relative select-none${isDragOver ? '' : ''}`}
        style={{
          '--tree-depth': depth,
          ...(depth === 0 && node.kind === 'directory' ? {} : { minHeight: 32 }),
          borderRadius: 'var(--radius-sm)',
          padding: 0,
          backgroundColor: selectedTreePath === node.path
            ? 'var(--c-background-3)'
            : 'transparent',
          fontSize: 'var(--fs-xs)',
          color: 'var(--c-text-1)',
          cursor: 'default',
          ...(isDragOver ? { outline: '2px solid var(--c-accent-center-panel)', outlineOffset: -2 } : {}),
        } as unknown as React.CSSProperties}
        draggable
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Row content */}
        <div className="row-xs" style={{
          height: 32,
          paddingLeft: 6 + depth * 12,
          paddingRight: 6,
        }}
          onMouseEnter={() => setShowKebab(true)}
          onMouseLeave={() => setShowKebab(false)}
          onClick={handleClick}
          onAuxClick={handleAuxClick}
        >
          {node.kind === 'directory' ? (
            <>
              <span className="shrink-0 subtle" style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </span>
              {expanded
                ? <FolderOpen size={13} className="shrink-0" style={{ color: selectedTreePath === node.path ? 'var(--c-accent-1)' : 'var(--c-text-2)' }} />
                : <Folder size={13} className="shrink-0" style={{ color: selectedTreePath === node.path ? 'var(--c-accent-1)' : 'var(--c-text-2)' }} />
              }
            </>
          ) : (
            <>
              <span className="shrink-0" style={{ width: 14 }} />
              <File size={13} className="shrink-0" style={{ color: selectedTreePath === node.path ? 'var(--c-accent-1)' : 'var(--c-text-2)' }} />
            </>
          )}

          {inlineInput?.mode === 'rename' ? (
            <input
              ref={inputRef}
              title={t('explorer.rename')}
              placeholder={node.name}
              className="ctrl-xs flex-1 min-w-0"
              style={{ marginLeft: 4, borderColor: 'var(--c-accent-center-panel)' }}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKey}
              onBlur={commitInput}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="trunc flex-1 min-w-0" style={{
              marginLeft: 4,
              fontWeight: 500,
              color: selectedTreePath === node.path ? 'var(--c-accent-1)' : 'var(--c-text-2)'
            }}>{node.name}</span>
          )}

          {/* Kebab button on hover */}
          {showKebab && !inlineInput && (
            <>
              <button
                ref={kebabRef}
                type="button"
                className="btn-icon"
                style={{ width: 24, height: 24, minWidth: 24, minHeight: 24, marginRight: 4 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (contextMenu) {
                    closeContextMenu();
                  } else {
                    setContextMenu({ x: e.clientX, y: e.clientY });
                  }
                }}
                title="Options"
                aria-label="Options"
              >
                <MoreHorizontal size={11} />
              </button>
            </>
          )}
        </div>

        {/* Nested children container */}
        {node.kind === 'directory' && expanded && (
          <ul className="tree-children" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {/* Inline new-file / new-folder input */}
            {inlineInput && inlineInput.mode !== 'rename' && (
              <li
                className="tree-node row-xs"
                style={{
                  '--tree-depth': depth + 1, height: 32, paddingLeft: 6 + (depth + 1) * 12, paddingRight: 6,
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--c-text-1)',
                } as React.CSSProperties}
              >
                <span className="shrink-0" style={{ width: 14 }} />
                {inlineInput.mode === 'new-file'
                  ? <File size={13} className="shrink-0 subtle" />
                  : <Folder size={13} className="shrink-0" style={{ color: 'var(--c-text-2)' }} />
                }
                <input
                  ref={inputRef}
                  title={inlineInput.mode === 'new-file' ? t('explorer.newFileName') : t('explorer.newFolderName')}
                  placeholder={inlineInput.mode === 'new-file' ? t('explorer.filenamePlaceholder') : t('explorer.folderPlaceholder')}
                  className="ctrl-xs flex-1 min-w-0"
                  style={{ marginLeft: 4, marginRight: 12, borderColor: 'var(--c-accent-center-panel)' }}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleInputKey}
                  onBlur={commitInput}
                />
              </li>
            )}
            {node.children && node.children.map((child) => (
              <TreeNode key={child.fullPath} node={child} depth={depth + 1} searchActive={searchActive} />
            ))}
          </ul>
        )}
      </li>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="drop"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, minWidth: 160 }}
          onClick={(e) => e.stopPropagation()}
        >
          {node.kind === 'directory' && (
            <>
              <button type="button" onClick={startNewFile} className="drop-item">
                <SquarePlus size={12} /> {t('explorer.newFile')}
              </button>
              <button type="button" onClick={startNewFolder} className="drop-item">
                <SquareSlash size={12} /> {t('explorer.newFolder')}
              </button>
            </>
          )}
          <button type="button" onClick={startRename}
            className="drop-item">
            <Pencil size={12} /> {t('explorer.rename')}
          </button>
          <button type="button" onClick={() => { setContextMenu(null); setConfirmDelete(true); }}
            className="drop-item" style={{ color: '#EF4444' }}>
            <Trash2 size={12} /> {t('explorer.delete')}
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t('explorer.delete')} "${node.name}"${node.kind === 'directory' ? ' and all its contents' : ''}?`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {confirmSwap && (
        <ConfirmDialog
          message={`Save changes to "${confirmSwap.fileName}" before switching files?`}
          onConfirm={onSwapDiscard}
          onCancel={onSwapCancel}
          onSave={onSwapSave}
        />
      )}
    </>
  );
}
