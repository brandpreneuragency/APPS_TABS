import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2 } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useAIStore } from '../../stores/aiStore';
import type { Agent } from '../../types';

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

export function AgentEditor() {
  const { activeModal, editingAgentId, setActiveModal, setEditingAgentId } = useUIStore();
  const { t } = useTranslation();
  const { agents, saveAgent, deleteAgent, setActiveAgent } = useAIStore();

  const isOpen = activeModal === 'agentEditor' || activeModal === 'editAgent';
  const editingAgent = editingAgentId ? agents.find((a) => a.id === editingAgentId) : null;

  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    if (editingAgent) {
      setName(editingAgent.name); // eslint-disable-line react-hooks/set-state-in-effect -- hydrate form when editor opens / agent changes
      setAvatarUrl(editingAgent.avatarUrl);
      setSystemPrompt(editingAgent.systemPrompt);
    } else {
      setName('');
      setAvatarUrl('');
      setSystemPrompt('You are a helpful assistant.');
    }
  }, [editingAgent, isOpen]);

  if (!isOpen) return null;

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
    setActiveModal(null);
    setEditingAgentId(null);
  };

  const handleDelete = async () => {
    if (!editingAgent || editingAgent.isDefault) return;
    await deleteAgent(editingAgent.id);
    setActiveModal(null);
    setEditingAgentId(null);
  };

  const close = () => {
    setActiveModal(null);
    setEditingAgentId(null);
  };

  return (
    <div className="overlay" id="agent-editor-overlay">
      <div className="modal modal--sm" id="agent-editor-modal">
        <div className="modal-head">
          <h2>
            {editingAgent ? 'Edit Agent' : 'New Agent'}
          </h2>
          <button
            id="agent-editor-close-btn"
            onClick={close}
            className="modal-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body col">
          <div>
            <label className="semibold" style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--c-text-2)', marginBottom: 6 }}>Agent Name</label>
            <input
              id="agent-name-input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('sidebar.agentNamePlaceholder')}
              className="ctrl w-full"
              style={{ fontSize: 'var(--fs-sm)' }}
            />
          </div>

          <div>
            <label className="semibold" style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--c-text-2)', marginBottom: 6 }}>Avatar URL (optional)</label>
            <input
              id="agent-avatar-input"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className="ctrl w-full"
              style={{ fontSize: 'var(--fs-sm)' }}
            />
          </div>

          <div>
            <label className="semibold" style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--c-text-2)', marginBottom: 6 }}>System Prompt</label>
            <textarea
              id="agent-prompt-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              placeholder="Describe how this agent should behave..."
              className="ctrl w-full"
              style={{ fontSize: 'var(--fs-sm)', resize: 'none', lineHeight: 1.625 }}
            />
          </div>

          <div className="row gap-2" style={{ paddingTop: 4 }}>
            <button
              id="agent-editor-save-btn"
              onClick={handleSave}
              disabled={!name.trim()}
              className="btn-brand flex-1"
              style={{ fontSize: 'var(--fs-sm)', padding: '8px 12px', opacity: !name.trim() ? 0.4 : 1 }}
            >
              {editingAgent ? 'Save Changes' : 'Create Agent'}
            </button>
            {editingAgent && !editingAgent.isDefault && (
              <button
                id="agent-editor-delete-btn"
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
            <button
              onClick={close}
              className="btn"
              style={{ fontSize: 'var(--fs-sm)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
