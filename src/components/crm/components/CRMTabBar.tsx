interface CRMTabBarProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}

export function CRMTabBar({ tabs, active, onChange }: CRMTabBarProps) {
  return (
    <div className="crm-tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-active={isActive}
            onClick={() => onChange(tab.id)}
            className={"ui-button " + (`crm-tab${isActive ? ' crm-tab--active' : ''}`)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
