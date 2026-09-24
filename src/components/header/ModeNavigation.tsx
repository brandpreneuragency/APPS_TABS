import { CalendarDays, FileText, Folder, List, PanelLeftClose, PanelLeftOpen, Settings, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';

export function ModeNavigation() {
  const { t } = useTranslation();
  const taskMode = useUIStore((state) => state.taskMode);
  const crmMode = useUIStore((state) => state.crmMode);
  const activeView = useUIStore((state) => state.activeView);
  const taskPage = useUIStore((state) => state.activeTaskPage);
  const clientPage = useUIStore((state) => state.activeCRMPage);
  const terminalOpen = useUIStore((state) => state.terminalPanelOpen);
  const navigationCollapsed = useUIStore((state) => state.navigationCollapsed);
  const setNavigationCollapsed = useUIStore((state) => state.setNavigationCollapsed);
  const settingsActive = !taskMode && !crmMode && activeView === 'settings';
  const docsActive = !taskMode && !crmMode && !settingsActive;

  return (
    <nav className="mode-navigation" aria-label={t('navigation.modes')}>
      <button id="nav-btn-left-navbar" type="button"
        title={navigationCollapsed ? t('navigation.openNavbar') : t('navigation.collapseNavbar')}
        aria-label={navigationCollapsed ? t('navigation.openNavbar') : t('navigation.collapseNavbar')}
        aria-pressed={!navigationCollapsed} onClick={() => setNavigationCollapsed(!navigationCollapsed)}>
        {navigationCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      <div className="header-utilities">
        <button id="nav-btn-settings" type="button" title={t('menu.settings')} aria-label={t('menu.settings')}
          aria-pressed={settingsActive} onClick={() => {
            const ui = useUIStore.getState();
            if (settingsActive) {
              // Close settings and return to documents
              ui.setActiveView('document');
              ui.setTaskMode(false);
              ui.setCrmMode(false);
            } else {
              ui.openSettings();
            }
          }}><Settings size={15} /></button>
        <button id="nav-btn-terminal" type="button" title={t('navigation.terminal')} aria-label={t('navigation.terminal')}
          aria-pressed={terminalOpen} onClick={() => useUIStore.getState().setTerminalPanelOpen(!terminalOpen)}><TerminalSquare size={15} /></button>
      </div>
      <button id="nav-btn-documents" type="button" className="header-mode" aria-pressed={docsActive}
        onClick={() => {
          const ui = useUIStore.getState();
          ui.setTaskMode(false);
          ui.setContextPanelOpen('documents', true);
        }}>
        <FileText size={15} /><span>{t('navigation.docs')}</span>
      </button>
        <button id="nav-btn-tasks" type="button" className="header-mode" aria-pressed={taskMode && taskPage === 'list'}
          onClick={() => {
            const ui = useUIStore.getState();
            ui.setActiveTaskPage('list');
            ui.setTaskMode(true);
            ui.setContextPanelOpen('tasks', true);
          }}>
          <List size={15} /><span>{t('navigation.taskList')}</span>
        </button>
        <button id="nav-btn-calendar" type="button" className="header-mode" aria-pressed={taskMode && taskPage === 'calendar'}
          onClick={() => {
            const ui = useUIStore.getState();
            ui.setActiveTaskPage('calendar');
            ui.setTaskMode(true);
            ui.setContextPanelOpen('tasks', true);
          }}>
          <CalendarDays size={15} /><span>{t('navigation.calendar')}</span>
        </button>
        <button id="nav-btn-projects" type="button" className="header-mode" aria-pressed={crmMode && clientPage === 'projects'}
          onClick={() => {
            const ui = useUIStore.getState();
            ui.setActiveCRMPage('projects');
            ui.setCrmMode(true);
            ui.setContextPanelOpen('crm', true);
          }}>
          <Folder size={15} /><span>{t('navigation.projects')}</span>
        </button>
    </nav>
  );
}
