import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAIStore } from '../../stores/aiStore';
import { SettingsPanels } from './SettingsPanels';
import { AgentEditorForm } from './AgentEditorForm';

export function AgentsSection() {
  const { t } = useTranslation();
  const agents = useAIStore((s) => s.agents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = selectedId ? agents.find((a) => a.id === selectedId) ?? null : null;

  const startNew = () => { setSelectedId(null); setAdding(true); };
  const pick = (id: string) => { setSelectedId(id); setAdding(false); };
  const onDone = (savedAgentId?: string) => {
    if (savedAgentId) {
      setSelectedId(savedAgentId);
      setAdding(false);
    } else {
      setSelectedId(null);
      setAdding(false);
    }
  };

  const agentList = (
    <div style={{ marginBottom: 8 }}>
      {agents.map((a) => (
        <button
          key={a.id}
          className={`settings-list-item${selectedId === a.id ? ' settings-list-item--active' : ''}`}
          onClick={() => pick(a.id)}
        >
          {a.avatarUrl ? (
            <img src={a.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: 'var(--radius-full)', flexShrink: 0 }} />
          ) : (
            <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-full)', background: 'var(--c-background-4)', flexShrink: 0 }} />
          )}
          <span className="settings-list-item-title">{a.name}</span>
          {a.isDefault && <span className="settings-list-item-meta">default</span>}
        </button>
      ))}
      <button className="settings-add-btn" onClick={startNew}><Plus size={14} /> {t('sidebar.newAgent')}</button>
    </div>
  );

  const leftMain = (
    <div className="settings-list-body">
      {agentList}
      {agents.length === 0 && <div className="settings-empty">No agents yet. Create one with +.</div>}
    </div>
  );

  const centerMain = selected
    ? <AgentEditorForm agentId={selected.id} onDone={onDone} />
    : adding
    ? <AgentEditorForm agentId={null} onDone={onDone} />
    : <div className="settings-empty">Select an agent to edit, or create a new one.</div>;

  return (
    <SettingsPanels
      leftMain={leftMain}
      centerMain={centerMain}
    />
  );
}
