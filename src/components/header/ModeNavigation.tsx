import { CalendarDays, FileText, Folder, GitBranch, List, PanelLeftClose, PanelLeftOpen, Settings, StickyNote, TerminalSquare, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { enterClients } from '../../services/clients/navigation';
import { useUIStore } from '../../stores/uiStore';

export function ModeNavigation() {
  const { t } = useTranslation();
  const taskMode = useUIStore((state) => state.taskMode);
  const githubMode = useUIStore((state) => state.githubMode);
  const crmMode = useUIStore((state) => state.crmMode);
  const activeView = useUIStore((state) => state.activeView);
  const taskPage = useUIStore((state) => state.activeTaskPage);
  const clientPage = useUIStore((state) => state.activeCRMPage);
  const terminalOpen = useUIStore((state) => state.terminalPanelOpen);
  const navigationCollapsed = useUIStore((state) => state.navigationCollapsed);
  const setNavigationCollapsed = useUIStore((state) => state.setNavigationCollapsed);
  const settingsActive = !githubMode && !taskMode && !crmMode && activeView === 'settings';
  const docsActive = !githubMode && !taskMode && !crmMode && activeView === 'document';
  const notesActive = !githubMode && !taskMode && !crmMode && activeView === 'notes';

  return (
    <nav className="mode-navigation" aria-label={t('navigation.modes')}>
      <button className="ui-icon-button" id="nav-btn-left-navbar" type="button"
        title={navigationCollapsed ? t('navigation.openNavbar') : t('navigation.collapseNavbar')}
        aria-label={navigationCollapsed ? t('navigation.openNavbar') : t('navigation.collapseNavbar')}
        aria-pressed={!navigationCollapsed} onClick={() => setNavigationCollapsed(!navigationCollapsed)}>
        {navigationCollapsed ? <PanelLeftOpen className="ui-icon"  /> : <PanelLeftClose className="ui-icon"  />}
      </button>
      <div className="header-utilities">
        <button className="ui-icon-button" id="nav-btn-settings" type="button" title={t('menu.settings')} aria-label={t('menu.settings')}
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
          }}><Settings className="ui-icon"  /></button>
        <button className="ui-icon-button" id="nav-btn-terminal" type="button" title={t('navigation.terminal')} aria-label={t('navigation.terminal')}
          aria-pressed={terminalOpen} onClick={() => useUIStore.getState().setTerminalPanelOpen(!terminalOpen)}><TerminalSquare className="ui-icon"  /></button>
      </div>
      <span className="mode-navigation-separator" aria-hidden="true">|</span>
      <button id="nav-btn-documents" type="button" className="header-mode" aria-pressed={docsActive}
        onClick={() => {
          const ui = useUIStore.getState();
          ui.setTaskMode(false);
          ui.setContextPanelOpen('documents', true);
        }}>
        <FileText className="ui-icon"  /><span>{t('navigation.docs')}</span>
      </button>
      <span className="mode-navigation-separator" aria-hidden="true">|</span>
      <button id="nav-btn-github" type="button" className="header-mode" aria-pressed={githubMode}
        onClick={() => useUIStore.getState().setGithubMode(!githubMode)}>
        <GitBranch className="ui-icon"  /><span>{t('navigation.github')}</span>
      </button>
      <span className="mode-navigation-separator" aria-hidden="true">|</span>
        <button id="nav-btn-tasks" type="button" className="header-mode" aria-pressed={taskMode && taskPage === 'list'}
          onClick={() => {
            const ui = useUIStore.getState();
            ui.setActiveTaskPage('list');
            ui.setTaskMode(true);
            ui.setContextPanelOpen('tasks', true);
          }}>
          <List className="ui-icon"  /><span>{t('navigation.taskList')}</span>
        </button>
        <button id="nav-btn-calendar" type="button" className="header-mode" aria-pressed={taskMode && taskPage === 'calendar'}
          onClick={() => {
            const ui = useUIStore.getState();
            ui.setActiveTaskPage('calendar');
            ui.setTaskMode(true);
            ui.setContextPanelOpen('tasks', true);
          }}>
          <CalendarDays className="ui-icon"  /><span>{t('navigation.calendar')}</span>
        </button>
        <button id="nav-btn-projects" type="button" className="header-mode" aria-pressed={crmMode && clientPage === 'projects'}
          onClick={() => {
            const ui = useUIStore.getState();
            ui.setActiveCRMPage('projects');
            ui.setCrmMode(true);
            ui.setContextPanelOpen('crm', true);
          }}>
          <Folder className="ui-icon"  /><span>{t('navigation.projects')}</span>
        </button>
        <span className="mode-navigation-separator" aria-hidden="true">|</span>
        <button id="nav-btn-notes" type="button" className="header-mode" aria-pressed={notesActive}
          onClick={() => useUIStore.getState().setActiveView('notes')}>
          <StickyNote className="ui-icon"  /><span>{t('navigation.notes')}</span>
        </button>
        <button id="nav-btn-clients" type="button" className="header-mode" aria-pressed={crmMode && clientPage === 'clients'}
          onClick={enterClients}>
          <Users className="ui-icon"  /><span>{t('navigation.clients')}</span>
        </button>
    </nav>
  );
}
