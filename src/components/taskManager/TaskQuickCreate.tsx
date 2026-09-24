import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../types';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { TASK_TITLE_MAX_LENGTH } from '../../types';
import './TaskQuickCreate.css';

interface TaskQuickCreateProps {
  date?: string | null;
  onSuccess?: (task: Task) => void;
  onClose?: () => void;
}

interface TaskQuickCreateSelectOption {
  value: string;
  label: string;
}

interface TaskQuickCreateSelectProps {
  value: string;
  options: TaskQuickCreateSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-label': string;
}

function TaskQuickCreateSelect({
  value,
  options,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: TaskQuickCreateSelectProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const selected = options.find((option) => option.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!triggerRef.current || !menuRef.current) return;
      const anchor = triggerRef.current.getBoundingClientRect();
      const width = Math.max(anchor.width, 130);
      menuRef.current.style.width = `${width}px`;
      const bounds = menuRef.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
      const gap = 6;
      const top = anchor.top - bounds.height - gap >= 8
        ? anchor.top - bounds.height - gap
        : Math.min(anchor.bottom + gap, Math.max(8, window.innerHeight - bounds.height - 8));
      setPosition({ top, left, width });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (disabled && open) setOpen(false);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="task-quick-create-select"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="task-quick-create-select-label">{selected?.label ?? ''}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="drop task-quick-create-menu"
          role="menu"
          aria-label={ariaLabel}
          style={position}
        >
          {options.map((option) => (
            <button
              key={option.value || '__empty__'}
              type="button"
              role="menuitem"
              className={`drop-item${option.value === value ? ' header-dropdown-item--active' : ''}`}
              onClick={() => pick(option.value)}
            >
              <span className="trunc med">{option.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function TaskQuickCreate({ date, onSuccess, onClose }: TaskQuickCreateProps) {
  const { t } = useTranslation();
  const clients = useClientStore((s) => s.clients);
  const projects = useProjectStore((s) => s.projects);
  const createTask = useTaskStore((s) => s.createTask);
  const showToast = useUIStore((s) => s.showToast);

  const [title, setTitle] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>(clients[0]?.id ?? '');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const filteredProjects = projects.filter((p) => p.clientId === selectedClientId);

  if (clients.length && !selectedClientId) setSelectedClientId(clients[0].id);
  if (filteredProjects.length && !selectedProjectId) setSelectedProjectId(filteredProjects[0].id);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('.task-quick-create-menu')) return;
      onCloseRef.current?.();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const created = await createTask(trimmed, {
        projectId: selectedProjectId,
        date: date ?? undefined,
      });
      if (created) {
        onSuccess?.(created);
        onClose?.();
      }
    } catch {
      showToast(t('tasks.createTaskFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const chooseClient = (clientId: string) => {
    setSelectedClientId(clientId);
    const nextProject = projects.find((project) => project.clientId === clientId);
    setSelectedProjectId(nextProject?.id ?? '');
  };

  return (
    <div className="task-quick-create" ref={rootRef}>
      <div className="task-quick-create-first-row">
        <input
          ref={titleRef}
          type="text"
          className="task-quick-create-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('tasks.taskTitlePlaceholder')}
          aria-label={t('tasks.taskTitlePlaceholder')}
          maxLength={TASK_TITLE_MAX_LENGTH}
          disabled={submitting}
        />
        <button
          type="button"
          className="task-quick-create-btn"
          onClick={submit}
          disabled={submitting || !title.trim() || !selectedProjectId}
          aria-label={t('tasks.createTask')}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="task-quick-create-selects">
        <TaskQuickCreateSelect
          aria-label={t('tasks.selectClient')}
          value={selectedClientId}
          onChange={chooseClient}
          disabled={submitting}
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
        />
        <TaskQuickCreateSelect
          aria-label={t('tasks.selectProject')}
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          disabled={submitting || filteredProjects.length === 0}
          options={filteredProjects.map((project) => ({ value: project.id, label: project.name }))}
        />
      </div>
    </div>
  );
}
