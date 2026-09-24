import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';

/**
 * Workspace folder control for the file tree.
 *
 * Each workspace tab has at most one attached folder (the AI agent root).
 * Empty: full-width "CONNECT FOLDER" opens the native/browser picker.
 * Selected: shows the folder path with a separate change-folder control.
 */
export function FileTreeTabs({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const loading = useWorkspaceStore((s) => s.loading);
  const connectFolderInWorkspace = useWorkspaceStore((s) => s.connectFolderInWorkspace);
  const getActiveConnectedFolders = useWorkspaceStore((s) => s.getActiveConnectedFolders);
  const getActiveFolderId = useWorkspaceStore((s) => s.getActiveFolderId);

  const connectedFolders = getActiveConnectedFolders();
  const activeFolderId = getActiveFolderId();
  const activeFolder =
    connectedFolders.find((f) => f.id === activeFolderId) ?? connectedFolders[0] ?? null;
  // Prefer absolute path so the user sees the full route, not only the basename.
  const folderPath = activeFolder?.path ?? activeFolder?.rootNode?.fullPath ?? null;
  const hasFolder = Boolean(folderPath);
  const canSelect = Boolean(activeWorkspaceId) && !hasFolder && !loading;

  const label = hasFolder
    ? folderPath!
    : loading
      ? t('explorer.opening')
      : t('explorer.selectFolder');

  const ariaLabel = hasFolder
    ? t('explorer.workspaceFolderAria', { name: folderPath })
    : t('explorer.selectFolder');

  const handleNativeClick = () => {
    if (!canSelect || !activeWorkspaceId) return;
    void connectFolderInWorkspace(activeWorkspaceId);
  };

  return (
    <div
      id="filetree-root-row"
      className={hasFolder ? 'filetree-folder-control has-folder' : 'filetree-folder-control'}
    >
      {hasFolder && (
        <button
          type="button"
          className="filetree-change-folder-btn"
          disabled={!activeWorkspaceId || loading}
          aria-label={t('explorer.changeFolder')}
          title={t('explorer.changeFolder')}
          onClick={() => {
            if (!activeWorkspaceId || loading) return;
            void connectFolderInWorkspace(activeWorkspaceId, undefined, { replaceExisting: true });
          }}
        >
          <FolderOpen size={16} aria-hidden="true" />
        </button>
      )}
      {hasFolder ? (
        <span className="filetree-select-folder-label" aria-label={ariaLabel} title={folderPath!}>
          {label}
        </span>
      ) : (
        <button
          type="button"
          className="filetree-select-folder-btn"
          onClick={handleNativeClick}
          disabled={!canSelect}
          aria-label={ariaLabel}
          title={t('explorer.selectFolder')}
        >
          <span className="filetree-select-folder-label">{label}</span>
        </button>
      )}
      {hasFolder && children}
    </div>
  );
}
