import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Folder, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { NAME_MAX } from '../../stores/taskTreeNames';
import { resolveCreateProjectName } from './createProjectName';
import type { Project } from '../../types';

interface AddNewProjectButtonProps {
  clientId: string;
  label?: string;
  onCreated?: (project: Project) => void;
  inlineGroupLabel?: string;
  children?: ReactNode;
}

export function AddNewProjectButton({ clientId, label, onCreated, inlineGroupLabel, children }: AddNewProjectButtonProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('tasks.addNewProject');
  const createProject = useProjectStore((s) => s.createProject);
  const projects = useProjectStore((s) => s.projects);
  const showToast = useUIStore((s) => s.showToast);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!formRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setName('');
  };

  const submit = async () => {
    if (submitting) return;
    const existing = projects.filter((p) => p.clientId === clientId).map((p) => p.name);
    const result = resolveCreateProjectName(name, existing);
    if (result.status === 'empty') return;
    if (result.status === 'duplicate') {
      showToast(t('tasks.projectExists', { name: name.trim() }), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createProject(result.name, clientId);
      if (created) {
        onCreated?.(created);
        showToast(t('tasks.projectCreated', { name: created.name }), 'info');
        close();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={inlineGroupLabel !== undefined ? 'scope-project-content' : 'task-list-add-project'} ref={rootRef}>
      <div className={inlineGroupLabel !== undefined ? 'scope-project-heading' : undefined}>
      {inlineGroupLabel !== undefined && <span title={inlineGroupLabel}>{inlineGroupLabel}</span>}
      <button
        ref={triggerRef}
        type="button"
        className="task-list-add-project-btn"
        title={resolvedLabel}
        aria-label={resolvedLabel}
        aria-expanded={open}
        aria-haspopup={inlineGroupLabel !== undefined ? undefined : 'dialog'}
        aria-controls={open ? dialogId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => {
            const next = !prev;
            if (next) setName('');
            return next;
          });
        }}
      >
        <Plus size={14} strokeWidth={2.25} />
      </button>
      </div>
      {children}
      {open && (
        <form
          ref={formRef}
          id={dialogId}
          className={inlineGroupLabel !== undefined ? 'scope-project-create' : 'drop task-list-add-project-popover'}
          role={inlineGroupLabel !== undefined ? undefined : 'dialog'}
          aria-label={resolvedLabel}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {inlineGroupLabel !== undefined && <Folder size={14} />}
          <input
            ref={inputRef}
            type="text"
            className="task-list-add-project-input"
            value={name}
            maxLength={NAME_MAX}
            placeholder={t('tasks.projectNamePlaceholder')}
            aria-label={t('tasks.projectNamePlaceholder')}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="task-list-add-project-submit"
            aria-label={t('tasks.addProject')}
            title={t('tasks.addProject')}
            disabled={submitting || !name.trim()}
          >
            {inlineGroupLabel !== undefined ? <Check size={14} /> : t('tasks.addProject')}
          </button>
        </form>
      )}
    </div>
  );
}
