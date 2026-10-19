import { MessageSquare, Star, Users, Layers } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import type { SidebarTab } from '../../stores/uiStore';

const TABS: { id: SidebarTab; label: string; Icon: React.ElementType }[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'actions', label: 'Actions', Icon: Star },
  { id: 'characters', label: 'Characters', Icon: Users },
  { id: 'models', label: 'Models', Icon: Layers },
];

export function SidebarNav() {
  const { sidebarTab, setSidebarTab } = useUIStore();

  return (
    <div className="shrink-0 bg-panel" style={{ borderTop: 0, borderColor: 'transparent', borderImage: 'none', paddingTop: 10, marginBottom: 10 }}>
      <div className="flex" style={{ height: 30, alignItems: 'stretch', background: 'var(--c-background-4)', width: '100%', border: 0, borderColor: 'transparent', borderImage: 'none' }}>
        {TABS.map(({ id, label, Icon }) => {
          const isActive = sidebarTab === id;
          return (
            <button
              key={id}
              onClick={() => setSidebarTab(id)}
              className={isActive ? 'side-nav-tab side-nav-tab--on' : 'side-nav-tab'}
            >
              <Icon className="ui-icon"  />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
