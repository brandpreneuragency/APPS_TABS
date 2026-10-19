// Non-modal agent editor form extracted from AgentEditor.tsx, for use as the
// center (detail) panel of Settings → Agents. The modal version is retained for
// quick edits launched from CharactersPanel in the sidebar / page mode.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useAIStore } from '../../stores/aiStore';
import type { Agent } from '../../types';

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

interface AgentEditorFormProps {
  /** Agent to edit, or null to create a new one. */
  agentId: string | null;
  /** Called after a successful save or delete (e.g. to clear selection). */
  onDone?: (savedAgentId?: string) => void;
}

export function AgentEditorForm({ agentId, onDone }: AgentEditorFormProps) {
  const { t } = useTranslation();
  const { agents, saveAgent, deleteAgent, setActiveAgent } = useAIStore();
  const editingAgent = agentId ? agents.find((a) => a.id === agentId) ?? null : null;

  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    if (editingAgent) {
      setName(editingAgent.name); // eslint-disable-line react-hooks/set-state-in-effect -- hydrate form when selected agent changes
      setAvatarUrl(editingAgent.avatarUrl);
      setSystemPrompt(editingAgent.systemPrompt);
    } else {
      setName('');
      setAvatarUrl('');
      setSystemPrompt('You are a helpful assistant.');
    }
  }, [editingAgent, agentId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    const agent: Agent = {
      id: editingAgent?.id ?? shortId(),
      name: name.trim(),
      avatarUrl: avatarUrl.trim(),
      systemPrompt: systemPrompt.trim(),
      isDefault: editingAgent?.isDefault ?? false,
    };
    await saveAgent(agent);
    setActiveAgent(agent.id);
    onDone?.(agent.id);
  };

  const handleDelete = async () => {
    if (!editingAgent || editingAgent.isDefault) return;
    await deleteAgent(editingAgent.id);
    onDone?.();
  };

  return (
    <div className="settings-agent-editor flex-col h-full w-full" style={{ display: 'flex', overflow: 'hidden' }}>
      <div className="settings-detail-body ui-page-body">
        <div className="settings-field ui-field">
          <label htmlFor="settings-agent-name">Agent Name</label>
          <input
            id="settings-agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sidebar.agentNamePlaceholder')}
            className="ui-input w-full"
            style={{ fontSize: 'var(--fs-sm)' }}
          />
        </div>

        <div className="settings-field ui-field">
          <label htmlFor="settings-agent-avatar">Avatar URL (optional)</label>
          <input
            id="settings-agent-avatar"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="ui-input w-full"
            style={{ fontSize: 'var(--fs-sm)' }}
          />
        </div>

        <div className="settings-field ui-field">
          <label htmlFor="settings-agent-prompt">System Prompt</label>
          <textarea
            id="settings-agent-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            placeholder="Describe how this agent should behave..."
            className="ui-input w-full"
          />
        </div>

        <div className="settings-form-actions">
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="ui-button ui-button--primary"
          >
            {editingAgent ? 'Save Changes' : 'Create Agent'}
          </button>
          {editingAgent && !editingAgent.isDefault && (
            <button
              onClick={handleDelete}
              className="ui-icon-button settings-delete-btn"
              title="Delete"
            >
              <Trash2 size="var(--c-icon-1)" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
