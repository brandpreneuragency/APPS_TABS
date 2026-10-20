import { Folder, Layers, ListX, Plus, Users, UserRoundMinus, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type DragEvent, type Ref } from 'react';
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
import { NotesNavigation } from '../notes/NotesNavigation';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export function LeftNarrowSidebar({ githubNavigationRef }: { githubNavigationRef?: Ref<HTMLDivElement> }) {
  const { t } = useTranslation();
  const githubMode = useUIStore((state) => state.githubMode);
  const taskMode = useUIStore((state) => state.taskMode);
  const crmMode = useUIStore((state) => state.crmMode);
  const activeView = useUIStore((state) => state.activeView);
  const settingsTab = useUIStore((state) => state.activeSettingsSubTab);
  const crmPage = useUIStore((state) => state.activeCRMPage);
  const formsPage = useUIStore((state) => state.activeFormsPage);
  const clients = useClientStore((state) => state.clients);
  const deleteClient = useClientStore((state) => state.deleteClient);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const clientPositions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = navigationRef.current?.querySelectorAll<HTMLElement>('[data-client-id]');
    if (!rows) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rows.forEach((row) => {
      const previousTop = clientPositions.current.get(row.dataset.clientId!);
      const offset = previousTop === undefined ? 0 : previousTop - row.getBoundingClientRect().top;
      if (offset && !reducedMotion && row.animate) {
        row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    });
    clientPositions.current.clear();
  }, [clients]);
  const reorderClient = useClientStore((state) => state.reorderClient);
  const [draggedClientId, setDraggedClientId] = useState<string | null>(null);
  const [clientDropTarget, setClientDropTarget] = useState<{ id: string; after: boolean } | null>(null);
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

  const startClientDrag = (event: DragEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    setDraggedProject(null);
    setDropTarget(null);
    setDraggedClientId(id);
  };
  const endClientDrag = () => {
    setDraggedClientId(null);
    setClientDropTarget(null);
  };
  const clientDropHandlers = (id: string) => ({
    'data-client-id': id,
    'data-client-dragging': draggedClientId === id ? 'true' : undefined,
    'data-client-drop-position': clientDropTarget?.id === id ? (clientDropTarget.after ? 'after' : 'before') : undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!draggedClientId || draggedClientId === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const bounds = event.currentTarget.getBoundingClientRect();
      setClientDropTarget({ id, after: event.clientY > bounds.top + bounds.height / 2 });
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setClientDropTarget(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!draggedClientId || draggedClientId === id) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      navigationRef.current?.querySelectorAll<HTMLElement>('[data-client-id]').forEach((row) => {
        clientPositions.current.set(row.dataset.clientId!, row.getBoundingClientRect().top);
      });
      void reorderClient(draggedClientId, id, event.clientY > bounds.top + bounds.height / 2);
      endClientDrag();
    },
  });

  if (githubMode) {
    return <nav id="nav-bar" className="nav-bar scope-navigation" aria-label={t('github.repositories')}>
      <div ref={githubNavigationRef} className="github-navigation-slot" />
    </nav>;
  }

  if (!taskMode && !crmMode && activeView === 'notes') {
    return <nav id="nav-bar" className="nav-bar scope-navigation" aria-label={t('navigation.notes')}><NotesNavigation /></nav>;
  }

  if (!taskMode && !crmMode && activeView === 'providerAccounts') {
    return <nav id="nav-bar" className="nav-bar scope-navigation" aria-label={t('navigation.providerAccounts')}>
      <div className="scope-tabs"><button type="button" className="scope-tab" aria-current="page">
        <Layers /><span>{t('providerAccounts.dashboard')}</span>
      </button></div>
    </nav>;
  }

  return (
    <nav ref={navigationRef} id="nav-bar" className="nav-bar scope-navigation" aria-label={t('navigation.scope')}>
      <div className="nav-bar-header">
        <div className="nav-bar-toolbar">
          {taskMode || crmMode || settings ? <AddNewClientButton showLabel /> : (
            <button
              id="nav-btn-close-unedited-tabs"
              type="button"
              title={t('tabs.closeUneditedTabs')}
              aria-label={t('tabs.closeUneditedTabs')}
              onClick={() => { void useWorkspaceStore.getState().closeUneditedWorkspaces(); }}
            >
              <ListX size={14} strokeWidth={2.25} aria-hidden="true" />
              <span>{t('tabs.clearTabs')}</span>
            </button>
          )}
        </div>
      </div>
      {!taskMode && !crmMode && !settings ? (
        <div className="scope-tabs document-navigation">
          <TabBar />
          <div className="nav-bar-toolbar">
            <button id="tab-plus-button" type="button" title={t('tabs.newDocument')}
              aria-label={t('tabs.newDocument')}
              onClick={() => void useWorkspaceStore.getState().createWorkspace()}><Plus size={14} /><span>{t('tabs.newDocumentShort')}</span></button>
          </div>
        </div>
      ) : settings ? (
        <div className="scope-tabs settings-navigation">
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
              <section key={client.id} className="scope-project-group" aria-label={client.name}
                {...clientDropHandlers(client.id)}>
                <AddNewProjectButton clientId={client.id} inlineGroupLabel={client.name}
                  inlineGroupLabelProps={{ draggable: true,
                    onDragStart: (event) => startClientDrag(event, client.id), onDragEnd: endClientDrag }}
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
                        endClientDrag();
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
              if (index < 0) return;
              const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
                : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              buttons[next]?.focus();
              buttons[next]?.click();
            }}>
            {scopes.map(({ id, name, icon: Icon }) => (
              <div key={id ?? 'everything'} className="scope-client-row" role="presentation">
              <button type="button" role="tab" className={`scope-tab${id && id !== noClient?.id && id !== '__no-client__' ? ' scope-tab--removable' : ''}`}
                {...(id && id !== noClient?.id && id !== '__no-client__' ? {
                  ...clientDropHandlers(id), draggable: true,
                  onDragStart: (event: DragEvent<HTMLButtonElement>) => startClientDrag(event, id),
                  onDragEnd: endClientDrag,
                } : {})}
                aria-selected={selectedClientId === id} tabIndex={focusableScopeId === id ? 0 : -1}
                title={name} onClick={() => void selectScope(id)}><Icon size={14} /><span>{name}</span></button>
              {id && id !== noClient?.id && id !== '__no-client__' && (
                <button type="button" className="ui-icon-button scope-client-remove"
                  title={`${t('explorer.delete')}: ${name}`} aria-label={`${t('explorer.delete')}: ${name}`}
                  onClick={() => setPendingDelete({ id, name })}><X size={14} /></button>
              )}
              </div>
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
      {pendingDelete && (
        <ConfirmDialog message={t('tasks.deleteClientConfirm', { name: pendingDelete.name })}
          confirmLabel={t('explorer.delete')}
          onConfirm={() => { void deleteClient(pendingDelete.id); setPendingDelete(null); }}
          onCancel={() => setPendingDelete(null)} />
      )}
    </nav>
  );
}
