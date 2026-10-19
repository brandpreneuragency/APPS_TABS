// General appearance settings (text size, app font family, language, default folder) extracted
// from the (now removed) SettingsModal so both PageTemplatePage (page mode) and
// the new Settings → Appearance sub-tab can reuse it without a modal wrapper.

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isNativeFsAvailable, openFolderDialog } from '../../services/fs-adapter';
import { canStepEditorFontSize, stepEditorFontSize } from '../../stores/editorFontSize';

const FONT_FAMILIES = ['Inter', 'Georgia', 'Arial', 'Verdana', 'Trebuchet MS', 'Times New Roman', 'Courier New'];

export function SettingsContent() {
  const { t } = useTranslation();
  const {
    editorFontFamily, setEditorFontFamily,
    editorFontSize, setEditorFontSize,
    language, setLanguage,
  } = useUIStore();
  const defaultFolderPath = useWorkspaceStore((s) => s.defaultFolderPath);
  const setDefaultFolderPath = useWorkspaceStore((s) => s.setDefaultFolderPath);

  const [fontOpen, setFontOpen] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const fontRef = useRef<HTMLDivElement>(null);
  const canPickFolder = isNativeFsAvailable();

  const handleChooseDefaultFolder = async () => {
    if (!canPickFolder || pickingFolder) return;
    setPickingFolder(true);
    try {
      const picked = await openFolderDialog();
      if (picked) await setDefaultFolderPath(picked);
    } finally {
      setPickingFolder(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) setFontOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const canDecreaseFont = canStepEditorFontSize(editorFontSize, -1);
  const canIncreaseFont = canStepEditorFontSize(editorFontSize, 1);

  return (
    <div className="settings-general-content">
      <div className="settings-general-content__body">
        <div className="settings-general-fields">
          <div className="settings-setting-row">
            <div className="settings-setting-row__content">
              <span className="subtle">{t('settings.textSize')}</span>
              <div className="settings-stepper">
                <button
                  type="button"
                  disabled={!canDecreaseFont}
                  onClick={() => setEditorFontSize(stepEditorFontSize(editorFontSize, -1))}
                  className="ui-icon-button"
                  aria-label={`${t('settings.textSize')} −`}
                >
                  −
                </button>
                <span className="settings-stepper__value">{editorFontSize}px</span>
                <button
                  type="button"
                  disabled={!canIncreaseFont}
                  onClick={() => setEditorFontSize(stepEditorFontSize(editorFontSize, 1))}
                  className="ui-icon-button"
                  aria-label={`${t('settings.textSize')} +`}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Font Family — full width */}
          <div className="settings-field ui-field">
            <label id="settings-font-label">{t('settings.fontFamily')}</label>
            <div ref={fontRef} className="relative">
              <button
                type="button"
                onClick={() => setFontOpen((v) => !v)}
                className="ui-button settings-font-picker"
                aria-labelledby="settings-font-label"
                aria-expanded={fontOpen}
              >
                <span style={{ fontFamily: editorFontFamily }}>{editorFontFamily}</span>
                <ChevronDown size="var(--c-icon-1)" className="subtle" style={{ transform: fontOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
              </button>
              {fontOpen && (
                <div className="drop" style={{ left: 0, right: 0 }}>
                  {FONT_FAMILIES.map((font) => (
                    <button
                      type="button"
                      key={font}
                      onClick={() => { setEditorFontFamily(font); setFontOpen(false); }}
                      className="drop-item"
                      style={{
                        fontFamily: font,
                        fontSize: 'var(--fs-sm)',
                        background: editorFontFamily === font ? 'var(--c-background-4)' : undefined,
                        color: editorFontFamily === font ? 'var(--c-accent-1)' : undefined,
                      }}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Default workspace folder */}
          <div className="settings-field ui-field">
            <label>
              {t('settings.defaultFolder')}
            </label>
            <p className="settings-hint">
              {t('settings.defaultFolderHint')}
            </p>
            <div className="settings-folder-controls">
              <span
                className={`ui-input settings-folder-path${defaultFolderPath ? '' : ' subtle'}`}
                title={defaultFolderPath ?? undefined}
              >
                {defaultFolderPath ?? t('settings.defaultFolderNone')}
              </span>
              <button
                type="button"
                className="ui-button"
                onClick={() => void handleChooseDefaultFolder()}
                disabled={!canPickFolder || pickingFolder}
              >
                {defaultFolderPath ? t('settings.defaultFolderChange') : t('settings.defaultFolderChoose')}
              </button>
              {defaultFolderPath && (
                <button
                  type="button"
                  className="ui-button"
                  onClick={() => void setDefaultFolderPath(null)}
                  disabled={pickingFolder}
                >
                  {t('settings.defaultFolderClear')}
                </button>
              )}
            </div>
            {!canPickFolder && (
              <p className="settings-hint">
                {t('settings.defaultFolderUnavailable')}
              </p>
            )}
          </div>

          {/* Language */}
          <div className="settings-setting-row__content">
            <span className="subtle">{t('settings.language')}</span>
            <div className="settings-scope-toggle">
              {(['en', 'tr'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className={`ui-button${language === lang ? ' is-active' : ''}`}
                  aria-pressed={language === lang}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
