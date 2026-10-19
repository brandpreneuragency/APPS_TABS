import './composer.css';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { File, Folder, Play, X } from 'lucide-react';
import { getFileCategory } from '../../utils/fileType';

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export type AttachmentPreviewKind = 'image' | 'file' | 'folder' | 'video';

/** Normalized attachment shape for consistent composer/thread previews. */
export interface AttachmentPreviewData {
  name: string;
  /** Explicit kind; when omitted, inferred from mime/name/preview. */
  kind?: AttachmentPreviewKind;
  /** Image/binary data URL (or any displayable src for images). */
  dataUrl?: string;
  /** Optional alternate thumbnail (e.g. video poster). */
  previewUrl?: string;
  mimeType?: string;
  /** Preferred label (workspace-relative path). Falls back to name. */
  displayPath?: string;
  /** Optional size text shown on file chips. */
  sizeLabel?: string;
}

function resolveKind(item: AttachmentPreviewData): AttachmentPreviewKind {
  if (item.kind === 'folder' || item.kind === 'file' || item.kind === 'image' || item.kind === 'video') {
    return item.kind;
  }
  const category = getFileCategory(item.name, item.mimeType);
  if (category === 'image') return 'image';
  if (category === 'video') return 'video';
  // Legacy chat images often omit kind but include an image data URL.
  if (item.dataUrl?.startsWith('data:image/')) return 'image';
  if (item.previewUrl && item.mimeType?.startsWith('image/')) return 'image';
  return 'file';
}

function imageSrcFor(item: AttachmentPreviewData, kind: AttachmentPreviewKind): string | undefined {
  if (kind === 'image') return item.previewUrl || item.dataUrl;
  if (kind === 'video') return item.previewUrl;
  return undefined;
}

export function AttachmentPreviewList({
  children,
  className,
  footer,
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <div className={cx('composer-attachments', className)}>
      {children}
      {footer}
    </div>
  );
}

export function AttachmentPreviewItem({
  item,
  onRemove,
  removeTitle = 'Remove attachment',
  onClick,
  className,
}: {
  item: AttachmentPreviewData;
  onRemove?: () => void;
  removeTitle?: string;
  onClick?: () => void;
  className?: string;
}) {
  const kind = resolveKind(item);
  const label = item.displayPath || item.name;
  const title =
    kind === 'folder' ? `Folder: ${label}` : kind === 'file' || kind === 'video' ? `File: ${label}` : label;
  const thumbSrc = imageSrcFor(item, kind);

  const handleRemove = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove?.();
  };

  // Compact image / video thumbnail — matches AI sidebar composer.
  if ((kind === 'image' || kind === 'video') && thumbSrc) {
    const media = (
      <>
        <img src={thumbSrc} alt={item.name} className="composer-attachment-thumb-img" />
        {kind === 'video' && (
          <span className="composer-attachment-thumb-play" aria-hidden>
            <Play className="ui-icon"  fill="currentColor" />
          </span>
        )}
      </>
    );

    return (
      <div className={cx('composer-attachment-thumb', className)} title={title}>
        {onClick ? (
          <button type="button" className="composer-attachment-thumb-hit" onClick={onClick} title={title}>
            {media}
          </button>
        ) : (
          media
        )}
        {onRemove && (
          <button
            type="button"
            onClick={handleRemove}
            title={removeTitle}
            className="ui-icon-button composer-attachment-thumb-remove"
            aria-label={removeTitle}
          >
            <X className="ui-icon"  />
          </button>
        )}
      </div>
    );
  }

  // File / folder chip (also used for video without a poster).
  // Use a div (not a nested <button>) so remove controls stay valid HTML.
  return (
    <div
      className={cx('composer-chip', onClick && 'composer-chip--button', className)}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {kind === 'folder' ? (
        <Folder  className="ui-icon composer-chip-icon" />
      ) : (
        <File  className="ui-icon composer-chip-icon" />
      )}
      <span className="composer-chip-name">{label}</span>
      {item.sizeLabel ? <span className="composer-chip-size">{item.sizeLabel}</span> : null}
      {onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          title={removeTitle}
          className="ui-icon-button composer-chip-remove"
          aria-label={removeTitle}
        >
          <X className="ui-icon"  />
        </button>
      )}
    </div>
  );
}
