import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import { AppLayout } from './components/layout/AppLayout';
import { AppTitlebar } from './components/header/AppTitlebar';
import { Header } from './components/header/Header';
import { TaskTitleBar } from './components/header/TaskTitleBar';
import { EditorWorkspace } from './components/editor/EditorWorkspace';
import { TaskDetailPanel } from './components/taskManager/TaskDetailPanel';
import { TaskProjectsKanban } from './components/taskManager/TaskProjectsKanban';
import { AISidebar } from './components/sidebar/AISidebar';
import { FileExplorerPanel } from './components/fileExplorer/FileExplorerPanel';
import { TaskListPanel } from './components/taskManager/TaskListPanel';
import { AgentEditor } from './components/modals/AgentEditor';
import { QuickPrompts } from './components/modals/QuickPrompts';
import { TrashModal } from './components/modals/TrashModal';
import { ToastContainer } from './components/ui/Toast';
import { CRMWorkspace } from './components/layout/CRMWorkspace';
import { CRMListPanel } from './components/crm/CRMListPanel';
import { FormsListPanel } from './components/forms/FormsListPanel';
import { ClientsCategoryPanel } from './components/clients/ClientsCategoryPanel';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useUIStore } from './stores/uiStore';
import { useAIStore } from './stores/aiStore';
import { useTaskStore } from './stores/taskStore';
import { useProjectStore } from './stores/projectStore';
import { useClientStore } from './stores/clientStore';
import { useCrmStore } from './stores/crmStore';
import { useFormsStore } from './stores/formsStore';
import { resolveTaskAssistantBinding } from './stores/taskAssistantBinding';
import { useThemeStore } from './stores/themeStore';
import { runStartupUpdateCheck } from './services/updater';
import { subscribeToDesktopFileOpen } from './services/desktopFileOpen';
import { codexSessionService } from './services/codex/sessionService';
import { startTaskAuthority } from './services/taskAuthority/service';

export default function App() {
  useEffect(() => { void codexSessionService.start(); }, []);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [uiSettingsLoaded, setUISettingsLoaded] = useState(false);
  const { loadWorkspaces, activeWorkspaceId, isLoaded: docsLoaded, setActiveWorkspace } = useWorkspaceStore();
  const {
    loadUISettings,
    taskMode,
    githubMode,
    activeTaskId,
    activeTaskPage,
    setTaskMode,
    crmMode,
    activeCRMPage,
    activeView,
    activeSettingsSubTab,
    navigationWidth,
    navigationCollapsed,
  } = useUIStore();
  const { loadAISettings } = useAIStore();
  const { loadThemeTokens } = useThemeStore();
  const {
    loadTasks,
    isLoaded: tasksLoaded,
    activeTaskId: storeActiveTaskId,
    setActiveTask,
    tasks,
    selectedClientId,
    selectedProjectId,
  } = useTaskStore();
  const { loadProjects, isLoaded: projectsLoaded } = useProjectStore();
  const { loadClients, isLoaded: clientsLoaded } = useClientStore();

  const isLoaded = uiSettingsLoaded && docsLoaded && tasksLoaded && projectsLoaded && clientsLoaded;
  useEffect(() => {
    if (tasksLoaded && projectsLoaded && clientsLoaded) return startTaskAuthority();
  }, [tasksLoaded, projectsLoaded, clientsLoaded]);

  useEffect(() => {
    void Promise.all([
      loadWorkspaces(),
      loadUISettings().then(() => setUISettingsLoaded(true)),
      loadAISettings(),
      useClientStore.getState().loadClients()
        .then(() => loadProjects())
        .then(() => loadTasks()),
      useCrmStore.getState().loadCrm(),
      useFormsStore.getState().loadForms(),
      loadThemeTokens(),
    ]);
    // Check for app updates in the background (no-op in the browser).
    void runStartupUpdateCheck();
  }, [
    loadWorkspaces,
    loadUISettings,
    loadAISettings,
    loadClients,
    loadTasks,
    loadProjects,
    loadThemeTokens,
  ]);

  // Listen for "Open with TABS" / argv file events from the Tauri shell.
  // Restore both workspaces and UI settings before opening the requested file:
  // a late settings restore must not switch back to the previous Tasks/CRM page.
  useEffect(() => {
    if (!docsLoaded || !uiSettingsLoaded) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void subscribeToDesktopFileOpen(async (path) => {
      if (!cancelled) await useWorkspaceStore.getState().openFileByPath(path);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((error: unknown) => console.warn('[desktopFileOpen] Could not listen for files:', error));
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [docsLoaded, uiSettingsLoaded]);

  // Keyboard shortcut: Ctrl/Cmd + Shift + T toggles task mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        const newMode = !taskMode;
        setTaskMode(newMode);
        if (newMode) {
          const lastTaskId = tasks[0]?.id ?? null;
          if (lastTaskId) setActiveTask(lastTaskId);
        } else {
          if (activeWorkspaceId) setActiveWorkspace(activeWorkspaceId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [taskMode, setTaskMode, tasks, activeWorkspaceId, setActiveWorkspace, setActiveTask]);

  // Keyboard shortcut: Ctrl/Cmd + J toggles the terminal panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'j') {
        e.preventDefault();
        useUIStore.getState().setTerminalPanelOpen(!useUIStore.getState().terminalPanelOpen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleEditorReady = useCallback((e: Editor) => {
    setEditor(e);
  }, []);

  const handleQuickPromptSelect = useCallback((prompt: string) => {
    sessionStorage.setItem('pendingPrompt', prompt);
    window.dispatchEvent(new CustomEvent('quickPromptSelected', { detail: prompt }));
  }, []);

  if (!isLoaded) {
    return (
      <div className="h-dvh" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <div className="flex-col gap-3" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: 32, height: 32,
            border: '2px solid var(--c-accent-center-panel)', borderTopColor: 'transparent',
            borderRadius: 'var(--radius-full)',
          }} />
          <span className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>Loading...</span>
        </div>
      </div>
    );
  }

  const effectiveTaskId = activeTaskId ?? storeActiveTaskId;

  // The Settings doc only lives in doc mode (not task/crm).
  const settingsActive = !githubMode && !taskMode && !crmMode && activeView === 'settings';

  // Panel 2 (editor) — CRM > task > doc. Settings primary content is
  // owned by AppLayout (SettingsDocument → section slots).
  const activeWorkspace = githubMode
    ? null
    : crmMode
    ? <CRMWorkspace />
    : taskMode
    ? activeTaskPage === 'projects'
      ? <TaskProjectsKanban />
      : <TaskDetailPanel />
    : settingsActive
    ? null
    : <EditorWorkspace onEditorReady={handleEditorReady} />;

  // Panel 1 (leftPanel) — CRM / Forms / file explorer.
  // Settings supplies its own list via SettingsPanels inside SettingsDocument.
  const formsPageActive = crmMode && activeCRMPage === 'forms';
  const clientsPageActive = crmMode && activeCRMPage === 'clients';
  const leftPanel = githubMode
    ? null
    : crmMode
    ? formsPageActive
      ? <FormsListPanel />
      : clientsPageActive
        ? <ClientsCategoryPanel />
        : <CRMListPanel />
    : settingsActive
    ? null
    : <FileExplorerPanel />;

  // Assistant content — Settings AI (scoped by sub-tab), Task Manager AI
  // (Tasks + Clients/Projects/CRM), or document writer AI.
  const taskBinding = githubMode ? null : resolveTaskAssistantBinding({
    taskMode,
    crmMode,
    activeCRMPage,
    activeTaskId: effectiveTaskId,
    selectedClientId,
    selectedProjectId,
  });

  const sidebar = githubMode ? (
    <AISidebar workspaceId={null} taskId={null} mode="writer" editor={null} />
  ) : settingsActive ? (
    <AISidebar
      workspaceId={null}
      taskId={null}
      settingsTab={activeSettingsSubTab}
      editor={null}
    />
  ) : taskBinding ? (
    <AISidebar
      workspaceId={null}
      taskId={taskBinding.taskId}
      mode="task"
      editor={editor}
    />
  ) : (
    <AISidebar
      workspaceId={activeWorkspaceId}
      taskId={null}
      mode="writer"
      editor={editor}
    />
  );

  return (
    <>
      {/* Shell — `app-shell` is the Agent 2 foundation (100dvh +
          grid, see src/styles/layout.css). The `#app-content` rule
          in index.css keeps `margin-top: 0` and a stable overflow
          anchor. The direct child `.app-shell-main` guarantees
          `min-height: 0; min-width: 0; overflow: hidden` so the
          workspace can shrink and internal panels can scroll. */}
      <div
        id="app-content"
        className="app-shell"
        data-navigation-collapsed={navigationCollapsed}
        style={{ '--sidebar-width': `${navigationCollapsed ? 0 : navigationWidth}px` } as CSSProperties}
      >
        <AppTitlebar>
          <Header />
        </AppTitlebar>
        <div className="app-shell-main">
          <AppLayout
            subtasksBar={<TaskTitleBar />}
            editor={activeWorkspace}
            sidebar={sidebar}
            leftPanel={leftPanel}
            taskListPanel={<TaskListPanel />}
            modals={
              <>
                <AgentEditor />
                <QuickPrompts onSelectPrompt={handleQuickPromptSelect} />
                {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
              </>
            }
          />
        </div>
      </div>
      <ToastContainer />
    </>
  );
}
