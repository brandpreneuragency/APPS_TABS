import { SettingsContent } from './GeneralSettingsContent';
import { SettingsPanels } from './SettingsPanels';
import { ThemePicker } from './ThemePicker';

export function AppearanceSection() {
  return (
    <SettingsPanels
      leftMain={null}
      centerMain={(
        <div className="settings-detail-body ui-page-body">
          <SettingsContent />
          <ThemePicker />
        </div>
      )}
    />
  );
}