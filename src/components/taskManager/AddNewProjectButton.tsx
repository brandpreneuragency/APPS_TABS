import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
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
}

export function AddNewProjectButton({ clientId, label, onCreated }: AddNewProjectButtonProps) {
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
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) {
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
    <div className="task-list-add-project" ref={rootRef}>
      <button
        type="button"
        className="task-list-add-project-btn"
        title={resolvedLabel}
        aria-label={resolvedLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
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
      {open && (
        <form
          id={dialogId}
          className="drop task-list-add-project-popover"
          role="dialog"
          aria-label={resolvedLabel}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
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
            disabled={submitting || !name.trim()}
          >
            {t('tasks.addProject')}
          </button>
        </form>
      )}
    </div>
  );
}
