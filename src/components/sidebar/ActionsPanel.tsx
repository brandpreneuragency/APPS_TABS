import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Zap, ChevronDown, ChevronRight, Play } from 'lucide-react';
import { db } from '../../services/db';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { QuickPrompt } from '../../types';

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

interface PromptItem extends QuickPrompt {
  builtin?: boolean;
}

interface ActionsPanelProps {
  scope: 'writer' | 'task';
}

const TASK_BUILT_INS: PromptItem[] = [
  {
    id: 'builtin_task_summarize',
    title: 'Summarize Task',
    prompt: 'Summarize this task with status, blockers, and next steps.',
    scope: 'task',
    createdAt: 0,
    builtin: true,
  },
  {
    id: 'builtin_task_next_steps',
    title: 'Next Steps',
    prompt: 'List the next concrete steps in priority order.',
    scope: 'task',
    createdAt: 0,
    builtin: true,
  },
  {
    id: 'builtin_task_update_details',
    title: 'Update Details',
    prompt: 'Propose updates for title, notes, dates, and status based on this context.',
    scope: 'task',
    createdAt: 0,
    builtin: true,
  },
  {
    id: 'builtin_task_split',
    title: 'Split Into Tasks',
    prompt: 'Split this work into smaller tasks and subtasks with clear ownership.',
    scope: 'task',
    createdAt: 0,
    builtin: true,
  },
];

function ActionForm({
  title,
  prompt,
  onTitleChange,
  onPromptChange,
  onSave,
  onCancel,
  saveLabel,
}: {
  title: string;
  prompt: string;
  onTitleChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <div className="col" style={{ gap: 8, padding: 12 }}>
      <div>
        <label
          className="semibold"
          style={{
            display: 'block',
            fontSize: 'var(--fs-xs)',
            color: 'var(--c-text-2)',
            marginBottom: 6,
          }}
        >
          Action Title
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. Summarize Task"
          className="ctrl w-full"
          style={{ fontSize: 'var(--fs-sm)' }}
        />
      </div>

      <div>
        <label
          className="semibold"
          style={{
            display: 'block',
            fontSize: 'var(--fs-xs)',
            color: 'var(--c-text-2)',
            marginBottom: 6,
          }}
        >
          Prompt Text
        </label>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Prompt text..."
          rows={4}
          className="ctrl w-full"
          style={{ fontSize: 'var(--fs-sm)', resize: 'none', lineHeight: 1.625 }}
        />
      </div>

      <div className="row gap-2" style={{ paddingTop: 4 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={!title.trim() || !prompt.trim()}
          className="btn-brand flex-1"
          style={{ justifyContent: 'center', padding: '6px 0' }}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn subtle"
          style={{ fontSize: 'var(--fs-xs)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface ActionAccordionItemProps {
  item: PromptItem;
  expanded: boolean;
  onToggleExpand: () => void;
  onRun: () => void;
  onDelete: () => void;
}

function ActionAccordionItem({
  item,
  expanded,
  onToggleExpand,
  onRun,
  onDelete,
}: ActionAccordionItemProps) {
  const promptRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(false);
  const originalPromptRef = useRef(item.prompt);

  const handlePromptFocus = () => {
    isEditingRef.current = true;
    originalPromptRef.current = item.prompt;
  };

  const handlePromptBlur = () => {
    // Use setTimeout to allow click handlers on other elements to fire first
    setTimeout(() => {
      if (!isEditingRef.current) return;
      // Check if focus moved to another element within the same panel
      const activeEl = document.activeElement;
      const panel = promptRef.current?.closest('.agent-accordion-panel');
      if (panel && panel.contains(activeEl)) {
        // Focus moved within the panel, keep editing
        isEditingRef.current = true;
        return;
      }
      isEditingRef.current = false;
      const newPrompt = promptRef.current?.textContent?.trim() ?? '';
      if (newPrompt !== item.prompt && !item.builtin) {
        // Update the prompt in the database
        db.quickPrompts.update(item.id, { prompt: newPrompt }).catch(() => undefined);
      }
    }, 0);
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Explicitly save before blurring
      const newPrompt = promptRef.current?.textContent?.trim() ?? '';
      if (newPrompt !== item.prompt && !item.builtin) {
        db.quickPrompts.update(item.id, { prompt: newPrompt }).catch(() => undefined);
      }
      isEditingRef.current = false;
      promptRef.current?.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (promptRef.current) {
        promptRef.current.textContent = originalPromptRef.current;
        promptRef.current.blur();
      }
    }
  };

  const handlePromptInput = () => {
    // Trigger autosave on input for immediate feedback
    // Debounced by blur handler for actual save
  };

  return (
    <div className="agent-accordion-item">
      {/* Header row */}
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded ? 'true' : 'false'}
        className="row w-full agent-accordion-trigger"
        style={{
          padding: '10px 12px',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
          justifyContent: 'space-between',
          textAlign: 'left',
        }}
      >
        <div className="row gap-3 min-w-0">
          {expanded ? (
            <ChevronDown size={15} className="subtle shrink-0" />
          ) : (
            <ChevronRight size={15} className="subtle shrink-0" />
          )}
          <div
            className="shrink-0"
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(139, 92, 246, 0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Zap size={12} style={{ color: 'var(--c-accent-center-panel)' }} />
          </div>
          <span
            className="semibold trunc"
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)' }}
          >
            {item.title}
          </span>
        </div>
        <div className="row gap-2 shrink-0">
          {item.builtin && (
            <span
              className="agent-scope-badge"
              style={{
                color: 'var(--c-text-2)',
                background: 'var(--c-background-4)',
                border: '1px solid var(--c-border-1)',
              }}
            >
              built-in
            </span>
          )}
        </div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div
          className="agent-accordion-panel"
          style={{ borderTop: '1px solid var(--c-border-1)' }}
        >
          {/* Prompt preview - editable inline */}
          <div
            ref={promptRef}
            className="subtle"
            contentEditable={!item.builtin}
            suppressContentEditableWarning
            style={{
              padding: '10px 12px',
              fontSize: 'var(--fs-xs)',
              lineHeight: 1.5,
              background: 'var(--c-background-1)',
              width: '100%',
              minHeight: '3.5em',
              outline: 'none',
              transition: 'background-color 0.15s',
              cursor: item.builtin ? 'default' : 'text',
            }}
            onFocus={handlePromptFocus}
            onBlur={handlePromptBlur}
            onKeyDown={handlePromptKeyDown}
            onInput={handlePromptInput}
            onMouseEnter={(e) => {
              if (!item.builtin && !isEditingRef.current) {
                e.currentTarget.style.background = 'var(--c-background-2)';
              }
            }}
            onMouseLeave={(e) => {
              if (!item.builtin && !isEditingRef.current) {
                e.currentTarget.style.background = 'var(--c-background-1)';
              }
            }}
            title={item.builtin ? 'Built-in actions cannot be edited' : 'Click to edit prompt'}
          >
            {item.prompt}
          </div>

          {/* Action row */}
          <div
            className="row gap-2"
            style={{
              padding: '8px 12px',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--c-background-1)',
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRun();
              }}
              className="row-xs"
              style={{
                width: 'fit-content',
                fontSize: 'var(--fs-xs)',
                color: 'var(--c-accent-center-panel)',
                fontWeight: 500,
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid var(--c-border-1)',
                background: 'transparent',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--c-background-2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Play size={12} /> Run
            </button>

            {!item.builtin && (
              <div className="row gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="btn-icon"
                  style={{ padding: 4 }}
                  title="Delete action"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ActionsPanel({ scope }: ActionsPanelProps) {
  const [customPrompts, setCustomPrompts] = useState<QuickPrompt[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    db.quickPrompts
      .where('scope')
      .equals(scope)
      .reverse()
      .sortBy('createdAt')
      .then(setCustomPrompts);
  }, [scope]);

  const promptItems = useMemo<PromptItem[]>(() => {
    if (scope === 'task') {
      return [...TASK_BUILT_INS, ...customPrompts];
    }
    return customPrompts;
  }, [customPrompts, scope]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !newPrompt.trim()) return;
    const prompt: QuickPrompt = {
      id: shortId(),
      title: newTitle.trim(),
      prompt: newPrompt.trim(),
      scope,
      createdAt: Date.now(), // eslint-disable-line react-hooks/purity
    };
    await db.quickPrompts.put(prompt);
    setCustomPrompts((previous) => [prompt, ...previous]);
    resetForm();
  };

  const handleSaveEdit = async () => {
    if (!editingId || !newTitle.trim() || !newPrompt.trim()) return;
    const existing = customPrompts.find((prompt) => prompt.id === editingId);
    if (!existing) return;
    const updated = { ...existing, title: newTitle.trim(), prompt: newPrompt.trim() };
    await db.quickPrompts.put(updated);
    setCustomPrompts((previous) =>
      previous.map((prompt) => (prompt.id === editingId ? updated : prompt))
    );
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await db.quickPrompts.delete(id);
    setCustomPrompts((previous) => previous.filter((prompt) => prompt.id !== id));
    setConfirmDeleteId(null);
    setExpandedId(null);
  };

  const resetForm = () => {
    setAdding(false);
    setEditingId(null);
    setNewTitle('');
    setNewPrompt('');
  };

  const handleRun = (prompt: string) => {
    window.dispatchEvent(new CustomEvent('quickPromptSelected', { detail: prompt }));
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setNewTitle('');
    setNewPrompt('');
    setExpandedId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-h">
      {confirmDeleteId && (
        <ConfirmDialog
          message="Delete this action? This cannot be undone."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      <div
        className="model-provider-body flex-1 col gap-2"
        style={{ padding: '0px 0px 16px 0px', overflowY: 'auto' }}
      >
        {/* Accordion list */}
        {promptItems.length > 0 && (
          <div className="agent-accordion-list">
            {promptItems.map((item) => {
              const isExpanded = expandedId === item.id;
              const isEditing = editingId === item.id && isExpanded;

              return (
                <div key={item.id}>
                  {isEditing ? (
                    /* Inline edit form replaces the accordion item */
                    <div className="agent-accordion-item">
                      <ActionForm
                        title={newTitle}
                        prompt={newPrompt}
                        onTitleChange={setNewTitle}
                        onPromptChange={setNewPrompt}
                        onSave={handleSaveEdit}
                        onCancel={resetForm}
                        saveLabel="Save"
                      />
                    </div>
                  ) : (
                    <ActionAccordionItem
                      item={item}
                      expanded={isExpanded}
                      onToggleExpand={() => toggleExpand(item.id)}
                      onRun={() => handleRun(item.prompt)}
                      onDelete={() => setConfirmDeleteId(item.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {promptItems.length === 0 && !adding && (
          <div
            className="col"
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 16px',
              textAlign: 'center',
              border: '1px solid var(--c-border-1)',
              borderRadius: 14,
              background: 'var(--c-background-1)',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--c-background-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <Zap size={18} style={{ color: 'var(--c-accent-center-panel)' }} />
            </div>
            <p
              className="med"
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--c-text-1)',
                marginBottom: 4,
              }}
            >
              No actions yet
            </p>
            <p className="subtle" style={{ fontSize: 'var(--fs-xs)', marginBottom: 16 }}>
              Create reusable prompts to speed up your workflow.
            </p>
          </div>
        )}

        {/* Inline add form */}
        {adding && (
          <div className="agent-accordion-list" style={{ overflow: 'visible' }}>
            <div className="agent-accordion-item">
              <ActionForm
                title={newTitle}
                prompt={newPrompt}
                onTitleChange={setNewTitle}
                onPromptChange={setNewPrompt}
                onSave={handleAdd}
                onCancel={resetForm}
                saveLabel="Add Action"
              />
            </div>
          </div>
        )}

        {/* New Action button (mirrors .connect-provider-btn) */}
        {!adding && (
          <button type="button" onClick={startAdd} className="new-agent-btn">
            <Plus size={16} />
            New Action
          </button>
        )}
      </div>
    </div>
  );
}
