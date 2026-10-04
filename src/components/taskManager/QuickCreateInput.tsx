import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ComposerCard,
  ComposerTextarea,
  ComposerRoot,
  ComposerRow,
  ComposerSendButton,
} from '../ui/Composer';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { usePlaceholder } from '../../utils/placeholders';
import { useProjectStore } from '../../stores/projectStore';
import { projectsForClient, resolveQuickCreateProjectId } from '../../stores/taskSelection';
import { parseTaskInput } from '../../services/nlpParser';
import { getTodayIso, getTomorrowIso } from '../../services/taskFormat';
import { TASK_TITLE_MAX_LENGTH } from '../../types';

import type { Project } from '../../types';

function ProjectDropdown({ show, projects, onPick }: { show: boolean; projects: Project[]; onPick: (name: string) => void }) {
  if (!show) return null;
  return (
    <div
      id="tqc-project-dropdown"
      className="drop"
      onMouseDown={(event) => event.stopPropagation()}
      style={{ left: 0, bottom: '100%', minWidth: 120, marginBottom: 2 }}
    >
      {projects.map((p) => (
        <button key={p.id} type="button" className="drop-item" onClick={() => onPick(p.name)} style={{ fontSize: 'var(--fs-base)' }}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

function DateDropdown({ show, dateInputRef, onPick, onClose }: { show: boolean; dateInputRef: React.RefObject<HTMLInputElement | null>; onPick: (date: string) => void; onClose: () => void }) {
  if (!show) return null;
  return (
    <div
      id="tqc-date-dropdown"
      className="drop"
      onMouseDown={(event) => event.stopPropagation()}
      style={{ left: 0, bottom: '100%', minWidth: 140, marginBottom: 2 }}
    >
      <button type="button" className="drop-item" onClick={() => onPick('')} style={{ fontSize: 'var(--fs-base)' }}>
        No date
      </button>
      {['Today', 'Tomorrow', 'Next week', 'Next month'].map((label) => (
        <button
          key={label}
          type="button"
          className="drop-item"
          onClick={() => {
            const d = new Date();
            if (label === 'Tomorrow') d.setDate(d.getDate() + 1);
            else if (label === 'Next week') d.setDate(d.getDate() + 7);
            else if (label === 'Next month') d.setMonth(d.getMonth() + 1);
            onPick(d.toISOString().slice(0, 10));
            onClose();
          }}
          style={{ fontSize: 'var(--fs-base)' }}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="drop-item"
        onClick={() => {
          if (dateInputRef.current?.showPicker) {
            dateInputRef.current.showPicker();
          } else {
            dateInputRef.current?.click();
          }
          onClose();
        }}
        style={{ fontSize: 'var(--fs-base)' }}
      >
        Custom...
      </button>
    </div>
  );
}

interface QuickCreateInputProps {
  prefillText?: string | null;
  onClearPrefillText?: () => void;
  assignedDate?: string | null;
  onSetDate?: (date: string | null) => void;
  assignedProject?: string | null;
  onSetProject?: (project: string | null) => void;
}

export function QuickCreateInput({
  prefillText,
  onClearPrefillText,
  assignedDate: assignedDateProp,
  onSetDate,
  assignedProject: assignedProjectProp,
  onSetProject,
}: QuickCreateInputProps) {
  const [value, setValue] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [assignedDate, setAssignedDate] = useState<string | null>(assignedDateProp ?? null);
  const [assignedProject, setAssignedProject] = useState<string | null>(assignedProjectProp ?? null);

  // Sync with props when they change externally
  useEffect(() => {
    if (assignedDateProp !== assignedDate) {
      setAssignedDate(assignedDateProp ?? null); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [assignedDateProp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (assignedProjectProp !== assignedProject) {
      setAssignedProject(assignedProjectProp ?? null); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [assignedProjectProp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrapper setters that also call the prop callbacks
  const handleSetDate = (date: string | null) => {
    setAssignedDate(date);
    onSetDate?.(date);
  };

  const handleSetProject = (project: string | null) => {
    setAssignedProject(project);
    onSetProject?.(project);
  };
  const { createTask } = useTaskStore();
  const selectedClientId = useTaskStore((s) => s.selectedClientId);
  const selectedProjectId = useTaskStore((s) => s.selectedProjectId);
  const showToast = useUIStore((s) => s.showToast);
  const { projects } = useProjectStore();
  const { t } = useTranslation();
  const clientProjects = projectsForClient(projects, selectedClientId);
  const fallbackProjectId = resolveQuickCreateProjectId(
    selectedClientId,
    selectedProjectId,
    projects,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const addTaskPlaceholder = usePlaceholder('addTask');
  const parsed = value.trim() ? parseTaskInput(value) : null;

  // Track which NLP tokens have already been transferred to dropdown state
  // so we don't re-transfer on every keystroke.
  const [transferredProject, setTransferredProject] = useState<string | null>(null);
  const [transferredDate, setTransferredDate] = useState<string | null>(null);

  // Handle input change - transfer NLP-detected project/date to dropdown state
  // and strip tokens from the input field.
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newParsed = newValue.trim() ? parseTaskInput(newValue) : null;
    let cleaned = newValue;
    let changed = false;

    if (newParsed?.projectName && transferredProject !== newParsed.projectName) {
      setTransferredProject(newParsed.projectName);
      handleSetProject(newParsed.projectName);
      cleaned = cleaned.replace(/#\w+/, '');
      changed = true;
    }
    if (newParsed?.date && transferredDate !== newParsed.date) {
      setTransferredDate(newParsed.date);
      handleSetDate(newParsed.date);
      if (/\btoday\b/i.test(cleaned)) cleaned = cleaned.replace(/\btoday\b/i, '');
      else if (/\btomorrow\b/i.test(cleaned)) cleaned = cleaned.replace(/\btomorrow\b/i, '');
      else if (/\d{4}-\d{2}-\d{2}/.test(cleaned)) cleaned = cleaned.replace(/\d{4}-\d{2}-\d{2}/, '');
      changed = true;
    }
    if (changed) {
      setValue(cleaned.replace(/\s+/g, ' ').trim());
    } else {
      setValue(newValue);
    }
  };

  const effectiveDate = assignedDate ?? null;
  const effectiveProject = assignedProject ?? null;
  const pickedProjectId = clientProjects.find(
    (p) => p.name.toLowerCase() === effectiveProject?.toLowerCase(),
  )?.id ?? null;
  const resolvedProjectId = pickedProjectId ?? fallbackProjectId;
  const hasProjectValue = !!effectiveProject?.trim();
  const hasDateValue = !!effectiveDate?.trim();
  const projectButtonLabel = effectiveProject?.trim() || 'No Project';
  const dateButtonLabel = (() => {
    if (!effectiveDate) return 'No Due Date';
    if (effectiveDate === getTodayIso()) return 'Today';
    if (effectiveDate === getTomorrowIso()) return 'Tomorrow';
    const parsedDate = new Date(effectiveDate);
    if (Number.isNaN(parsedDate.getTime())) return effectiveDate;
    return parsedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  })();

  const handleSend = async () => {
    const title = parsed?.title?.trim();
    if (!title && !effectiveDate && !effectiveProject) return;
    if (!title) return;
    if (!resolvedProjectId) {
      showToast(t('tasks.pickAProject'), 'info');
      return;
    }
    await createTask(title, {
      date: effectiveDate ?? new Date().toISOString().slice(0, 10),
      importance: parsed?.importance ?? 'medium',
      projectId: resolvedProjectId,
    });
    setValue('');
    handleSetDate(null);
    handleSetProject(null);
    setTransferredProject(null);
    setTransferredDate(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (prefillText) {
      setValue((prev) => { // eslint-disable-line react-hooks/set-state-in-effect
        if (!prev.trim()) return prefillText;
        return prev;
      });
      inputRef.current?.focus();
      if (onClearPrefillText) onClearPrefillText();
    }
  }, [prefillText, onClearPrefillText]);

  useEffect(() => {
    if (!showProjectPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showProjectPicker]);

  useEffect(() => {
    if (!showDatePicker) return;
    const handleClick = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDatePicker]);

  const handleDatePick = (dateStr: string) => {
    handleSetDate(dateStr || null);
    setShowDatePicker(false);
    inputRef.current?.focus();
  };

  const handleProjectPick = (name: string) => {
    handleSetProject(name);
    setShowProjectPicker(false);
    inputRef.current?.focus();
  };

  return (
    <div id="task-quick-create-wrapper" style={{ height: 'fit-content', width: '100%', padding: '0px', flexShrink: 0 }}>
      <ComposerRoot id="task-quick-create" className="composer-root--clear">
        <ComposerCard>
          {/* Row 1: Text field */}
          <ComposerRow>
            <ComposerTextarea
              id="tqc-text-input"
              ref={inputRef}
              data-task-quick-create
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={addTaskPlaceholder}
              rows={1}
              maxLength={TASK_TITLE_MAX_LENGTH}
            />
          </ComposerRow>

          {/* Row 2: Left dropups + right send button */}
          <ComposerRow className="task-quick-create-bottom-row">
            <div ref={projectRef} className="task-quick-create-actions">
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowProjectPicker(!showProjectPicker)}
                  className="btn-icon task-quick-create-dropup-btn"
                  data-kind="project"
                  data-active={hasProjectValue ? 'true' : 'false'}
                  title={hasProjectValue ? `Project: ${projectButtonLabel}` : 'No Project'}
                  aria-label={hasProjectValue ? `Project: ${projectButtonLabel}` : 'No Project'}
                  aria-haspopup="menu"
                  aria-expanded={showProjectPicker}
                >
                  {hasProjectValue && (
                    <Folder size={12} className="task-quick-create-dropup-icon" aria-hidden="true" />
                  )}
                  <span className="trunc med task-quick-create-dropup-label">{projectButtonLabel}</span>
                  <ChevronDown size={12} className="task-quick-create-dropup-chevron" aria-hidden="true" />
                </button>
                <ProjectDropdown show={showProjectPicker} projects={clientProjects} onPick={handleProjectPick} />
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }} ref={datePickerRef}>
                <button
                  type="button"
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="btn-icon task-quick-create-dropup-btn"
                  data-kind="date"
                  data-active={hasDateValue ? 'true' : 'false'}
                  title={hasDateValue ? `Due: ${dateButtonLabel}` : 'No Due Date'}
                  aria-label={hasDateValue ? `Due: ${dateButtonLabel}` : 'No Due Date'}
                  aria-haspopup="menu"
                  aria-expanded={showDatePicker}
                >
                  {hasDateValue && (
                    <Calendar size={12} className="task-quick-create-dropup-icon" aria-hidden="true" />
                  )}
                  <span className="trunc med task-quick-create-dropup-label">{dateButtonLabel}</span>
                  <ChevronDown size={12} className="task-quick-create-dropup-chevron" aria-hidden="true" />
                </button>
                <DateDropdown show={showDatePicker} dateInputRef={dateInputRef} onPick={handleDatePick} onClose={() => setShowDatePicker(false)} />
                <input
                  ref={dateInputRef}
                  type="date"
                  onChange={(e) => { handleDatePick(e.target.value); setShowDatePicker(false); }}
                  style={{ position: 'absolute', left: 0, bottom: 0, width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
                />
              </div>
            </div>
            <div className="task-quick-create-send">
              <ComposerSendButton
                onClick={handleSend}
                disabled={!parsed?.title || !resolvedProjectId}
                title={resolvedProjectId ? 'Add task' : t('tasks.pickAProject')}
              />
            </div>
          </ComposerRow>
        </ComposerCard>
      </ComposerRoot>
    </div>
  );
}
