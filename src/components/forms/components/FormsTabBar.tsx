import type { LucideIcon } from 'lucide-react';
import '../forms.css';

export interface FormsTab {
  key: string;
  label: string;
  icon?: LucideIcon;
}

interface FormsTabBarProps {
  tabs: FormsTab[];
  active: string;
  onChange: (key: string) => void;
}

export function FormsTabBar({ tabs, active, onChange }: FormsTabBarProps) {
  return (
    <div className="forms-tab-bar" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-active={isActive}
            title={tab.label}
            onClick={() => onChange(tab.key)}
            className={"ui-button " + (`forms-tab${isActive ? ' forms-tab--active' : ''}`)}
          >
            {Icon ? <Icon /> : null}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
