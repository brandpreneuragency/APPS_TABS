import { useMemo } from 'react';
import { FileType, Download } from 'lucide-react';
import type { FileViewerItem } from '../../types';
import { getFileCategory } from '../../utils/fileType';
import type { FileCategory } from '../../utils/fileType';
import { decodeDataUrlText } from '../../utils/fileData';

interface FileViewerContentProps {
  file: FileViewerItem;
}

function FileViewerImage({ src, name }: { src: string; name: string }) {
  return (
    <div className="file-viewer-content-inner file-viewer-content-image">
      <img src={src} alt={name} />
    </div>
  );
}

function FileViewerVideo({ src, name }: { src: string; name: string }) {
  return (
    <div className="file-viewer-content-inner file-viewer-content-video">
      <div className="file-viewer-video-thumbnail">
        <video 
          src={src} 
          preload="metadata" 
          muted 
          className="file-viewer-video-preview"
        />
      </div>
      <div className="file-viewer-video-info">
        <span className="file-viewer-video-name">{name}</span>
      </div>
    </div>
  );
}

function FileViewerPdf({ src, name }: { src: string; name: string }) {
  return (
    <div className="file-viewer-content-inner file-viewer-content-pdf">
      <iframe
        src={src}
        title={name}
        className="file-viewer-pdf-iframe"
      />
    </div>
  );
}

function FileViewerText({ dataUrl }: { dataUrl: string }) {
  const text = useMemo(() => {
    try {
      return decodeDataUrlText(dataUrl);
    } catch {
      return 'Could not decode file content.';
    }
  }, [dataUrl]);

  return (
    <div className="file-viewer-content-inner file-viewer-content-text">
      <pre className="file-viewer-pre">{text}</pre>
    </div>
  );
}

function FileViewerOther({ file }: { file: FileViewerItem }) {
  const href = file.dataUrl || file.path || '#';

  return (
    <div className="file-viewer-content-inner file-viewer-content-other">
      <div className="file-viewer-other-card">
        <FileType className="ui-icon" strokeWidth={1.5} />
        <span className="file-viewer-other-name">{file.name}</span>
        {file.size && <span className="file-viewer-other-size">{file.size}</span>}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="file-viewer-download-btn"
          download={file.name}
        >
          <Download className="ui-icon" />
          Download file
        </a>
      </div>
    </div>
  );
}

function FileViewerDownloadAction({ file }: { file: FileViewerItem }) {
  const href = file.dataUrl || file.path || '#';
  if (href === '#') return null;

  return (
    <div className="file-viewer-actions">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="file-viewer-download-btn"
        download={file.name}
      >
        <Download className="ui-icon" />
        Download file
      </a>
    </div>
  );
}

export function FileViewerContent({ file }: FileViewerContentProps) {
  const category: FileCategory = getFileCategory(file.name, file.mimeType);

  // Build a usable src for media types
  const src = file.dataUrl || file.path || '';
  const previewable =
    (category === 'image' || category === 'video' || category === 'pdf') ? Boolean(src) :
    (category === 'text' || category === 'code') ? Boolean(file.dataUrl) :
    false;

  if (!previewable) {
    return <FileViewerOther file={file} />;
  }

  return (
    <div className="file-viewer-preview-shell">
      <div className="file-viewer-preview-body">
        {category === 'image' && <FileViewerImage src={src} name={file.name} />}
        {category === 'video' && <FileViewerVideo src={src} name={file.name} />}
        {category === 'pdf' && <FileViewerPdf src={src} name={file.name} />}
        {(category === 'text' || category === 'code') && file.dataUrl && <FileViewerText dataUrl={file.dataUrl} />}
      </div>
      <FileViewerDownloadAction file={file} />
    </div>
  );
}
