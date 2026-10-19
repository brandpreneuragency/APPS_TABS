import {
  useFormsSettingsSection,
  setFormsSettingsSection,
  FORMS_SETTINGS_SECTIONS,
} from '../components/settingsSectionState';
import {
  Settings2,
  ShieldCheck,
  Bell,
  Webhook,
  Upload,
  Lock,
  Download,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '../forms.css';

const SECTION_ICONS: Record<string, LucideIcon> = {
  defaults: Settings2,
  spam: ShieldCheck,
  notifications: Bell,
  webhooks: Webhook,
  file_uploads: Upload,
  embed_security: Lock,
  export: Download,
};

export function SettingsNav() {
  const active = useFormsSettingsSection();

  return (
    <>
      <div className="forms-list-section-label">Settings</div>
      {FORMS_SETTINGS_SECTIONS.map((section) => {
        const Icon = SECTION_ICONS[section.key] ?? Settings2;
        const isActive = section.key === active;
        return (
          <button data-active={isActive}
            key={section.key}
            type="button"
            onClick={() => setFormsSettingsSection(section.key)}
            className={"ui-list-row " + (`forms-list-item${isActive ? ' forms-list-item--active' : ''}`)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <span className="forms-list-item-title" style={{ fontWeight: 500 }}>
              <Icon />
              <span>{section.label}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}
