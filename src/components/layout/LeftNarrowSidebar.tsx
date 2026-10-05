import { Folder, Layers, Plus, Trash2, Users, UserRoundMinus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useTaskStore } from '../../stores/taskStore';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { isNoClient } from '../../stores/clientOverview';
import { TabBar } from '../header/TabBar';
import { SETTINGS_HEADER_TABS } from '../header/moduleNav';
import { AddNewClientButton } from '../taskManager/AddNewClientButton';
import { AddNewProjectButton } from '../taskManager/AddNewProjectButton';

export function LeftNarrowSidebar() {
  const { t } = useTranslation();
  const taskMode = useUIStore((state) => state.taskMode);
  const crmMode = useUIStore((state) => state.crmMode);
  const activeView = useUIStore((state) => state.activeView);
  const settingsTab = useUIStore((state) => state.activeSettingsSubTab);
  const crmPage = useUIStore((state) => state.activeCRMPage);
  const formsPage = useUIStore((state) => state.activeFormsPage);
  const clients = useClientStore((state) => state.clients);
  const projects = useProjectStore((state) => state.projects);
  const reorderProject = useProjectStore((state) => state.reorderProject);
  const [draggedProject, setDraggedProject] = useState<{ id: string; clientId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const selectedProjectId = useTaskStore((state) => state.selectedProjectId);
  const selectedClientId = useTaskStore((state) => state.selectedClientId);
  const setSelection = useTaskStore((state) => state.setSelection);
  const noClient = clients.find(isNoClient);
  const settings = !taskMode && !crmMode && activeView === 'settings';
  const clientsPage = crmMode && crmPage === 'clients';
  const scopes = [
    { id: null, name: t('navigation.everything'), icon: Layers },
    { id: noClient?.id ?? '__no-client__', name: t(clientsPage ? 'clients.noClientScope' : 'navigation.noClient'), icon: UserRoundMinus },
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
      ) : taskMode ? (
        <>
          <div className="scope-tabs scope-projects" aria-label={t('navigation.projectsList')}>
            <button type="button" className="scope-tab"
              aria-current={!selectedClientId && !selectedProjectId ? 'page' : undefined}
              onClick={() => setSelection(null, null)}><Layers size={14} /><span>{t('navigation.everything')}</span></button>
            {[...clients].sort((left, right) => left.order - right.order).map((client) => (
              <section key={client.id} className="scope-project-group" aria-label={client.name}>
                <AddNewProjectButton clientId={client.id} inlineGroupLabel={client.name}
                  onCreated={(project) => setSelection(client.id, project.id)}>
                <button type="button" className="scope-tab scope-project-all"
                  aria-current={selectedClientId === client.id && !selectedProjectId ? 'page' : undefined}
                  onClick={() => setSelection(client.id, null)}>
                  <Layers size={14} /><span>{t('navigation.all')}</span>
                </button>
                {projects.filter((project) => project.clientId === client.id)
                  .sort((left, right) => left.order - right.order).map((project) => (
                    <button key={project.id} type="button" className="scope-tab"
                      draggable
                      data-drop-position={dropTarget?.id === project.id ? (dropTarget.after ? 'after' : 'before') : undefined}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', project.id);
                        setDraggedProject({ id: project.id, clientId: client.id });
                      }}
                      onDragOver={(event) => {
                        if (!draggedProject || draggedProject.clientId !== client.id || draggedProject.id === project.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setDropTarget({ id: project.id, after: event.clientY > bounds.top + bounds.height / 2 });
                      }}
                      onDragLeave={() => setDropTarget(null)}
                      onDragEnd={() => { setDraggedProject(null); setDropTarget(null); }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedProject?.clientId === client.id && dropTarget?.id === project.id) {
                          void reorderProject(draggedProject.id, project.id, dropTarget.after);
                        }
                        setDraggedProject(null);
                        setDropTarget(null);
                      }}
                      title={project.name} aria-current={selectedProjectId === project.id ? 'page' : undefined}
                      onClick={() => setSelection(client.id, project.id)}>
                      <Folder size={14} /><span>{project.name}</span>
                    </button>
                  ))}
                </AddNewProjectButton>
              </section>
            ))}
          </div>
        </>
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
          {crmMode && !clientsPage && (
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
      <div className="nav-bar-header nav-bar-footer">
        <div className="nav-bar-toolbar">
          {!taskMode && !crmMode && !settings && (
            <button id="nav-btn-close-unedited-tabs" type="button"
              title={t('tabs.closeUneditedTabs')} aria-label={t('tabs.closeUneditedTabs')}
              onClick={() => void useWorkspaceStore.getState().closeUneditedWorkspaces()}><Trash2 size={14} /><span>{t('tabs.clearTabs')}</span></button>
          )}
          {!taskMode && !crmMode && !settings ? (
            <button id="tab-plus-button" type="button" title={t('tabs.newDocument')}
              aria-label={t('tabs.newDocument')}
              onClick={() => void useWorkspaceStore.getState().createWorkspace()}><Plus size={14} /><span>{t('tabs.newDocumentShort')}</span></button>
          ) : <AddNewClientButton showLabel />}
        </div>
      </div>
    </nav>
  );
}
