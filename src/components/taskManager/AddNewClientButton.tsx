import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClientStore } from '../../stores/clientStore';
import { useUIStore } from '../../stores/uiStore';
import { NAME_MAX } from '../../stores/taskTreeNames';
import { resolveCreateProjectName } from './createProjectName';

export function AddNewClientButton() {
  const { t } = useTranslation();
  const createClient = useClientStore((s) => s.createClient);
  const clients = useClientStore((s) => s.clients);
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
    const result = resolveCreateProjectName(name, clients.map((c) => c.name));
    if (result.status === 'empty') return;
    if (result.status === 'duplicate') {
      showToast(t('tasks.clientExists', { name: name.trim() }), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createClient(result.name);
      if (created) {
        showToast(t('tasks.clientCreated', { name: created.name }), 'info');
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
        title={t('tasks.addNewClient')}
        aria-label={t('tasks.addNewClient')}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
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
          aria-label={t('tasks.addNewClient')}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="text"
            className="task-list-add-project-input"
            value={name}
            maxLength={NAME_MAX}
            placeholder={t('tasks.clientNamePlaceholder')}
            aria-label={t('tasks.clientNamePlaceholder')}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="task-list-add-project-submit"
            disabled={submitting || !name.trim()}
          >
            {t('tasks.addClient')}
          </button>
        </form>
      )}
    </div>
  );
}
