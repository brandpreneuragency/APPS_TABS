import { X, ExternalLink } from 'lucide-react';
import type { FileViewerItem } from '../../types';
import { canOpenInTipTap } from '../../utils/fileType';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

interface FileViewerHeaderProps {
  file: FileViewerItem;
}

export function FileViewerHeader({ file }: FileViewerHeaderProps) {
  const closeFileViewer = useUIStore((s) => s.closeFileViewer);
  const showToast = useUIStore((s) => s.showToast);
  const openFileFromViewer = useWorkspaceStore((s) => s.openFileFromViewer);
  const setTaskMode = useUIStore((s) => s.setTaskMode);

  const canOpen = canOpenInTipTap(file.name);

  const handleOpenInTipTap = async () => {
    try {
      await openFileFromViewer(file);
      // Switch to document mode so the editor is visible
      setTaskMode(false);
      closeFileViewer();
    } catch {
      showToast('Could not open file in editor.', 'error');
    }
  };

  return (
    <div className="file-viewer-header">
      <div className="file-viewer-header-left">
        {canOpen ? (
          <button
            type="button"
            className="file-viewer-tip-btn"
            onClick={handleOpenInTipTap}
            title="Open file in editor"
          >
            <ExternalLink className="ui-icon"  />
            Open in TipTap
          </button>
        ) : (
          <span className="file-viewer-tip-btn file-viewer-tip-btn--disabled" title="This file type cannot be opened in the editor">
            <ExternalLink className="ui-icon"  />
            Open in TipTap
          </span>
        )}
      </div>

      <div className="file-viewer-header-center">
        <span className="file-viewer-filename trunc">{file.name}</span>
      </div>

      <div className="file-viewer-header-right">
        <button
          type="button"
          className="ui-icon-button file-viewer-close-btn"
          onClick={closeFileViewer}
          title="Close (Esc)"
        >
          <X className="ui-icon"  />
        </button>
      </div>
    </div>
  );
}
