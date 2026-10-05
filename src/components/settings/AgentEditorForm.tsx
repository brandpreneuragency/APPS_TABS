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
      <div className="settings-detail-body">
        <div>
          <label className="semibold" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)', marginBottom: 6 }}>Agent Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sidebar.agentNamePlaceholder')}
            className="ctrl w-full"
            style={{ fontSize: 'var(--fs-sm)' }}
          />
        </div>

        <div>
          <label className="semibold" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)', marginBottom: 6 }}>Avatar URL (optional)</label>
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="ctrl w-full"
            style={{ fontSize: 'var(--fs-sm)' }}
          />
        </div>

        <div>
          <label className="semibold" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)', marginBottom: 6 }}>System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            placeholder="Describe how this agent should behave..."
            className="ctrl w-full"
            style={{ fontSize: 'var(--fs-sm)', resize: 'vertical', lineHeight: 1.625, minHeight: 160 }}
          />
        </div>

        <div className="row gap-2" style={{ paddingTop: 4 }}>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="btn-brand flex-1"
            style={{ fontSize: 'var(--fs-sm)', padding: '8px 12px', opacity: !name.trim() ? 0.4 : 1 }}
          >
            {editingAgent ? 'Save Changes' : 'Create Agent'}
          </button>
          {editingAgent && !editingAgent.isDefault && (
            <button
              onClick={handleDelete}
              className="btn-icon"
              style={{
                width: 40,
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--c-danger)',
                transition: 'background-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--c-danger)'; }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
