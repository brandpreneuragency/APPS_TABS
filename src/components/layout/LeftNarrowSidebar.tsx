import { Folder, Layers, Users, UserRoundMinus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { useClientStore } from '../../stores/clientStore';
import { isNoClient } from '../../stores/clientOverview';
import { TabBar } from '../header/TabBar';
import { SETTINGS_HEADER_TABS } from '../header/moduleNav';
import { AddNewClientButton } from '../taskManager/AddNewClientButton';

export function LeftNarrowSidebar() {
  const { t } = useTranslation();
  const taskMode = useUIStore((state) => state.taskMode);
  const crmMode = useUIStore((state) => state.crmMode);
  const activeView = useUIStore((state) => state.activeView);
  const settingsTab = useUIStore((state) => state.activeSettingsSubTab);
  const crmPage = useUIStore((state) => state.activeCRMPage);
  const formsPage = useUIStore((state) => state.activeFormsPage);
  const clients = useClientStore((state) => state.clients);
  const selectedClientId = useTaskStore((state) => state.selectedClientId);
  const setSelection = useTaskStore((state) => state.setSelection);
  const noClient = clients.find(isNoClient);
  const settings = !taskMode && !crmMode && activeView === 'settings';
  const clientsPage = crmMode && crmPage === 'clients';
  const scopes = [
    ...(!clientsPage ? [
      { id: null, name: t('navigation.everything'), icon: Layers },
      { id: noClient?.id ?? '__no-client__', name: t('navigation.noClient'), icon: UserRoundMinus },
    ] : []),
    ...clients.filter((client) => !isNoClient(client)).sort((left, right) => left.order - right.order)
      .map((client) => ({ id: client.id, name: client.name, icon: Users })),
  ];
  const focusableScopeId = scopes.find((scope) => scope.id === selectedClientId)?.id ?? scopes[0]?.id;

  const selectScope = async (id: string | null) => {
    if (id === '__no-client__') {
      const created = await useClientStore.getState().createClient('No Client');
      if (created) setSelection(created.id, null);
    } else setSelection(id, null);
  };

  return (
    <nav id="nav-bar" className="nav-bar scope-navigation" aria-label={t('navigation.scope')}>
      {!taskMode && !crmMode && !settings ? <TabBar /> : settings ? (
        <div className="scope-tabs">
          {SETTINGS_HEADER_TABS.map(({ key, icon: Icon }) => (
            <button key={key} type="button" className="scope-tab" aria-current={settingsTab === key ? 'page' : undefined}
              onClick={() => useUIStore.getState().setActiveSettingsSubTab(key)}><Icon size={14} /><span>{t(`navigation.${key}`)}</span></button>
          ))}
        </div>
      ) : (
        <>
          <div className="scope-tabs" role="tablist" aria-orientation="vertical" aria-label={t('navigation.clients')}
            onKeyDown={(event) => {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
                : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              buttons[next]?.focus();
              buttons[next]?.click();
            }}>
            {scopes.map(({ id, name, icon: Icon }) => (
              <button key={id ?? 'everything'} type="button" role="tab" className="scope-tab"
                aria-selected={selectedClientId === id} tabIndex={focusableScopeId === id ? 0 : -1}
                title={name} onClick={() => void selectScope(id)}><Icon size={14} /><span>{name}</span></button>
            ))}
          </div>
          <div className="scope-navigation-footer"><AddNewClientButton showLabel /></div>
          {crmMode && (
            <details className="scope-more">
              <summary>{t('navigation.more')}</summary>
              {(['leads', 'pipeline', 'forms', 'submissions'] as const).map((page) => (
                <button type="button" className="scope-tab" key={page}
                  aria-current={(page === 'submissions' ? crmPage === 'forms' && formsPage === 'submissions' : crmPage === page && (page !== 'forms' || formsPage !== 'submissions')) ? 'page' : undefined}
                  onClick={() => {
                    const ui = useUIStore.getState();
                    ui.setActiveCRMPage(page === 'submissions' ? 'forms' : page);
                    if (page === 'forms' || page === 'submissions') ui.setActiveFormsPage(page === 'forms' ? 'list' : 'submissions');
                  }}><Folder size={13} /><span>{t(`navigation.${page === 'leads' ? 'crm' : page}`)}</span></button>
              ))}
            </details>
          )}
        </>
      )}
    </nav>
  );
}
