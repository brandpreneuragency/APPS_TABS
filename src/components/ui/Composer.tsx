import './composer.css';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, DragEvent as ReactDragEvent, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { ArrowUp } from 'lucide-react';

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function ComposerRoot({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div id={id} className={cx('composer-root', className)}>
      {children}
    </div>
  );
}

export function ComposerCard({
  children,
  id,
  className,
  onDragOver,
  onDragLeave,
  onDrop,
  'data-drag-over': dataDragOver,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void;
  'data-drag-over'?: boolean;
}) {
  return (
    <div
      id={id}
      className={cx('composer-card card flex flex-col', className)}
      style={{ height: 'fit-content', paddingTop: 0 }}
      data-drag-over={dataDragOver ? 'true' : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

export function ComposerAttachments({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('composer-attachments', className)}>
      {children}
    </div>
  );
}

export function ComposerRow({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('composer-row relative flex items-center', className)} style={{ display: 'flex', flexWrap: 'nowrap', minHeight: '0px', ...style }}>
      {children}
    </div>
  );
}

export function ComposerLeft({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('composer-left flex items-center', className)} style={{ height: 'fit-content', ...style }}>
      {children}
    </div>
  );
}

export const ComposerIconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={"ui-icon-button " + (cx('btn-icon composer-tool-button', className))}
      {...props}
    />
  )
);

export const ComposerInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cx('composer-input', className)}
      {...props}
    />
  )
);

export const ComposerTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cx('composer-input composer-textarea', className)}
      {...props}
    />
  )
);

export function ComposerSendButton({
  onClick,
  disabled,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ui-icon-button ui-button--primary ui-button--round btn-send"
      title={title}
    >
      <ArrowUp className="ui-icon"  />
    </button>
  );
}
