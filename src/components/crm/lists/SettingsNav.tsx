import {
  Bell,
  Boxes,
  Download,
  Copy,
  FileInput,
  Settings,
  Tag,
  type LucideIcon,
} from 'lucide-react';

export type SettingsSectionId =
  | 'leadFields'
  | 'stages'
  | 'tags'
  | 'notifications'
  | 'duplicate'
  | 'export'
  | 'futureApi';

interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'leadFields', label: 'Lead Fields', icon: FileInput },
  { id: 'stages', label: 'Stages', icon: Boxes },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'duplicate', label: 'Duplicate Handling', icon: Copy },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'futureApi', label: 'Future API', icon: Settings },
];

interface SettingsNavProps {
  active: SettingsSectionId;
  onChange: (id: SettingsSectionId) => void;
}

export function SettingsNav({ active, onChange }: SettingsNavProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="crm-list-section-label">Sections</div>
      <div className="crm-saved-views">
        {SETTINGS_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <button data-active={isActive}
              key={item.id}
              type="button"
              className={"ui-list-row " + (`crm-saved-view-item${isActive ? ' crm-saved-view-item--active' : ''}`)}
              onClick={() => onChange(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { SETTINGS_NAV };
