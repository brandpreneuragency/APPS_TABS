import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';

export function ThemePicker() {
  const { t } = useTranslation();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="settings-field ui-field">
      <label htmlFor="settings-theme">{t('themePicker.label')}</label>
      <select id="settings-theme" className="ui-input" value={theme} disabled={saving}
        onChange={async (event) => {
          const next = event.target.value === 'purple-neon' ? 'purple-neon' : 'default';
          setSaving(true);
          setFailed(false);
          try { await setTheme(next); }
          catch { setFailed(true); }
          finally { setSaving(false); }
        }}>
        <option value="default">{t('themePicker.default')}</option>
        <option value="purple-neon">{t('themePicker.purpleNeon')}</option>
      </select>
      {failed && <p role="alert">{t('themePicker.saveFailed')}</p>}
    </div>
  );
}
