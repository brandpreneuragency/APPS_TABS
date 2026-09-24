import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Check, User, ChevronDown, ChevronRight } from 'lucide-react';
import { useAIStore } from '../../stores/aiStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { Agent } from '../../types';

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

const EMPTY_AGENT: Omit<Agent, 'id' | 'isDefault'> = {
  name: '',
  avatarUrl: '',
  systemPrompt: '',
};

function AgentForm({
  form,
  onSave,
  onCancel,
  onChange,
}: {
  form: typeof EMPTY_AGENT;
  onSave: () => void;
  onCancel: () => void;
  onChange: (field: keyof typeof EMPTY_AGENT, value: string) => void;
}) {
  const { t } = useTranslation();
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
          Agent Name
        </label>
        <input
          autoFocus
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder={t('sidebar.agentNamePlaceholder')}
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
          System Prompt
        </label>
        <textarea
          value={form.systemPrompt}
          onChange={(e) => onChange('systemPrompt', e.target.value)}
          placeholder="Describe how this agent should behave..."
          rows={4}
          className="ctrl w-full"
          style={{ fontSize: 'var(--fs-sm)', resize: 'none', lineHeight: 1.625 }}
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
          Avatar URL (optional)
        </label>
        <input
          value={form.avatarUrl}
          onChange={(e) => onChange('avatarUrl', e.target.value)}
          placeholder="https://..."
          className="ctrl w-full"
          style={{ fontSize: 'var(--fs-sm)' }}
        />
      </div>

      <div className="row gap-2" style={{ paddingTop: 4 }}>
        <button
          onClick={onSave}
          disabled={!form.name.trim()}
          className="btn-brand flex-1"
          style={{ justifyContent: 'center', padding: '6px 0' }}
        >
          Save
        </button>
        <button
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

interface AgentAccordionItemProps {
  agent: Agent;
  active: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onDelete: () => void;
}

function AgentAccordionItem({
  agent,
  active,
  expanded,
  onToggleExpand,
  onSelect,
  onDelete,
}: AgentAccordionItemProps) {
  const { saveAgent } = useAIStore();
  const promptRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(false);
  const originalPromptRef = useRef(agent.systemPrompt);

  const handlePromptFocus = () => {
    isEditingRef.current = true;
    originalPromptRef.current = agent.systemPrompt;
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
      if (newPrompt !== agent.systemPrompt) {
        saveAgent({ ...agent, systemPrompt: newPrompt });
      }
    }, 0);
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Explicitly save before blurring
      const newPrompt = promptRef.current?.textContent?.trim() ?? '';
      if (newPrompt !== agent.systemPrompt) {
        saveAgent({ ...agent, systemPrompt: newPrompt });
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
            className="shrink-0 overflow-h"
            style={{
              width: 24,
              height: 24,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(139, 92, 246, 0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {agent.avatarUrl ? (
              <img
                src={agent.avatarUrl}
                alt={agent.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <User size={12} style={{ color: 'var(--c-accent-center-panel)' }} />
            )}
          </div>
          <span
            className="semibold trunc"
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-1)' }}
          >
            {agent.name}
          </span>
          {active && (
            <Check
              size={12}
              className="shrink-0"
              style={{ color: 'var(--c-accent-center-panel)' }}
            />
          )}
        </div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div
          className="agent-accordion-panel"
          style={{ borderTop: '1px solid var(--c-border-1)' }}
        >
          {/* Preview / system prompt - editable inline */}
          {agent.systemPrompt !== undefined && (
            <div
              ref={promptRef}
              className="subtle"
              contentEditable
              suppressContentEditableWarning
              style={{
                padding: '10px 12px',
                fontSize: 'var(--fs-xs)',
                lineHeight: 1.5,
                background: 'var(--c-background-2)',
                minHeight: '3.5em',
                outline: 'none',
                border: '1px solid transparent',
                transition: 'background-color 0.15s, border-color 0.15s',
              }}
              onFocus={handlePromptFocus}
              onBlur={handlePromptBlur}
              onKeyDown={handlePromptKeyDown}
              onInput={handlePromptInput}
              onMouseEnter={(e) => {
                if (!isEditingRef.current) {
                  e.currentTarget.style.background = 'var(--c-background-3)';
                  e.currentTarget.style.borderColor = 'var(--c-border-1)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isEditingRef.current) {
                  e.currentTarget.style.background = 'var(--c-background-2)';
                  e.currentTarget.style.borderColor = 'transparent';
                }
              }}
              title="Click to edit system prompt"
            >
              {agent.systemPrompt}
            </div>
          )}

          {/* Action row */}
          <div
            className="row gap-2"
            style={{
              padding: '8px 12px',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="row-xs"
              style={{
                fontSize: 'var(--fs-xs)',
                color: active ? 'var(--c-text-2)' : 'var(--c-accent-center-panel)',
                fontWeight: 500,
                padding: '0px 8px',
                width: 'fit-content',
                height: 32,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--c-border-1)',
                background: 'transparent',
                cursor: active ? 'default' : 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'var(--c-background-2)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
              disabled={active}
            >
              {active ? (
                <>
                  <Check size={12} /> Active
                </>
              ) : (
                'Set Active'
              )}
            </button>

            <div className="row gap-1">
              {!agent.isDefault && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="btn-icon"
                  style={{ padding: 4 }}
                  title="Delete agent"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CharactersPanel() {
  const {
    agents,
    activeAgentId,
    setActiveAgent,
    saveAgent,
    deleteAgent,
  } = useAIStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_AGENT });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const startAdd = useCallback(() => {
    setForm({ ...EMPTY_AGENT });
    setAdding(true);
    setEditingId(null);
    setExpandedId(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    if (adding) {
      await saveAgent({
        id: shortId(),
        name: form.name.trim(),
        avatarUrl: form.avatarUrl.trim(),
        systemPrompt: form.systemPrompt.trim(),
        isDefault: false,
      });
    } else if (editingId) {
      const existing = agents.find((agent) => agent.id === editingId);
      if (existing) {
        await saveAgent({
          ...existing,
          name: form.name.trim(),
          avatarUrl: form.avatarUrl.trim(),
          systemPrompt: form.systemPrompt.trim(),
        });
      }
    }
    setAdding(false);
    setEditingId(null);
  }, [adding, editingId, form, saveAgent, agents]);

  const handleCancel = useCallback(() => {
    setAdding(false);
    setEditingId(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteAgent(id);
      setConfirmDeleteId(null);
      setExpandedId(null);
    },
    [deleteAgent]
  );

  const handleFormChange = useCallback(
    (field: keyof typeof EMPTY_AGENT, value: string) => {
      setForm((previous) => ({ ...previous, [field]: value }));
    },
    []
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-h">
      {confirmDeleteId && (
        <ConfirmDialog
          message="Delete this profile? This cannot be undone."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      <div
        className="model-provider-body flex-1 col gap-2"
        style={{ padding: '0px 0px 16px 0px', overflowY: 'auto' }}
      >
        {/* Accordion list */}
        {agents.length > 0 && (
          <div className="agent-accordion-list">
            {agents.map((agent) => {
              const isExpanded = expandedId === agent.id;
              const isEditing = editingId === agent.id && isExpanded;

              return (
                <div key={agent.id}>
                  {isEditing ? (
                    /* Inline edit form replaces the accordion item */
                    <div className="agent-accordion-item">
                      <AgentForm
                        form={form}
                        onSave={handleSave}
                        onCancel={handleCancel}
                        onChange={handleFormChange}
                      />
                    </div>
                  ) : (
                    <AgentAccordionItem
                      agent={agent}
                      active={agent.id === activeAgentId}
                      expanded={isExpanded}
                      onToggleExpand={() => toggleExpand(agent.id)}
                      onSelect={() => setActiveAgent(agent.id)}
                      onDelete={() => setConfirmDeleteId(agent.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {agents.length === 0 && !adding && (
          <div
            className="col"
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 16px',
              textAlign: 'center',
              border: '1px solid var(--c-border-1)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--c-background-1)',
            }}
          >
            <p
              className="med"
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--c-text-1)',
                marginBottom: 4,
              }}
            >
              No agents yet
            </p>
            <p className="subtle" style={{ fontSize: 'var(--fs-xs)', marginBottom: 16 }}>
              Create a new agent to get started.
            </p>
          </div>
        )}

        {/* Inline add form */}
        {adding && (
          <div
            className="agent-accordion-list"
            style={{ overflow: 'visible' }}
          >
            <div className="agent-accordion-item">
              <AgentForm
                form={form}
                onSave={handleSave}
                onCancel={handleCancel}
                onChange={handleFormChange}
              />
            </div>
          </div>
        )}

        {/* New Agent button (mirrors .connect-provider-btn) */}
        {!adding && (
          <button
            type="button"
            onClick={startAdd}
            className="new-agent-btn"
          >
            <Plus size={16} />
            New Agent
          </button>
        )}
      </div>
    </div>
  );
}
