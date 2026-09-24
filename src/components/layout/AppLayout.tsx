import { useEffect, type CSSProperties, type ReactNode } from 'react';
import {
  useUIStore,
  selectActiveWorkspaceMode,
  selectIsContextPanelAvailable,
  selectIsContextPanelOpen,
  type WorkspaceMode,
} from '../../stores/uiStore';
import { LeftNarrowSidebar } from './LeftNarrowSidebar';
import { NavigationResizeHandle } from './NavigationResizeHandle';
import './navigation.css';
import { FileViewerPanel } from '../fileViewer/FileViewerPanel';
import { RightPanelSubheader } from '../sidebar/RightPanelSubheader';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { SettingsDocument } from '../settings/SettingsDocument';
import { useTaskStore } from '../../stores/taskStore';
import { resolveTaskAssistantBinding } from '../../stores/taskAssistantBinding';
import {
  WorkspaceShell,
  PrimaryWorkspaceContent,
} from './workspace';

interface AppLayoutProps {
  editor: ReactNode;
  sidebar: ReactNode;
  leftPanel: ReactNode;
  taskListPanel: ReactNode;
  modals: ReactNode;
  subtasksBar?: ReactNode;
}

/**
 * Universal two-wrapper shell for Documents, Tasks, CRM, Forms, and Settings.
 */
export function AppLayout({
  editor,
  sidebar,
  leftPanel,
  taskListPanel,
  modals,
  subtasksBar,
}: AppLayoutProps) {
  const editorFontSize = useUIStore((s) => s.editorFontSize);
  const navigationWidth = useUIStore((s) => s.navigationWidth);
  const navigationCollapsed = useUIStore((s) => s.navigationCollapsed);

  useEffect(() => {
    if (editorFontSize === 14) {
      document.documentElement.setAttribute('data-text-size', '14');
    } else if (editorFontSize === 16) {
      document.documentElement.setAttribute('data-text-size', '16');
    } else {
      document.documentElement.removeAttribute('data-text-size');
    }
  }, [editorFontSize]);

  return (
    <div className="workspace" data-navigation-collapsed={navigationCollapsed} style={{ '--sidebar-width': `${navigationCollapsed ? 0 : navigationWidth}px` } as CSSProperties}>
      <div className="sidebar-panel" aria-hidden={navigationCollapsed} inert={navigationCollapsed}>
        <LeftNarrowSidebar />
        <NavigationResizeHandle />
      </div>
      <div id="workspace-panels" className="workspace-panels">
        <div id="workspace-content" className="workspace-content">
          <UniversalWorkspaceShell
            editor={editor}
            sidebar={sidebar}
            leftPanel={leftPanel}
            taskListPanel={taskListPanel}
            subtasksBar={subtasksBar}
          />
        </div>
        {modals}
      </div>

      <TerminalPanel />
    </div>
  );
}

function UniversalWorkspaceShell({
  editor,
  sidebar,
  leftPanel,
  taskListPanel,
  subtasksBar,
}: {
  editor: ReactNode;
  sidebar: ReactNode;
  leftPanel: ReactNode;
  taskListPanel: ReactNode;
  subtasksBar?: ReactNode;
}) {
  const primaryWrapperOpen = useUIStore((s) => s.primaryWrapperOpen);
  const assistantWrapperOpen = useUIStore((s) => s.assistantWrapperOpen);
  const wrappersSwapped = useUIStore((s) => s.wrappersSwapped);
  const assistantWrapperWidth = useUIStore((s) => s.assistantWrapperWidth);
  const contextPanelWidth = useUIStore((s) => s.contextPanelWidth);
  const contextPanelOpenByMode = useUIStore((s) => s.contextPanelOpenByMode);
  const fileViewerOpen = useUIStore((s) => s.fileViewerOpen);
  const activeTaskPage = useUIStore((s) => s.activeTaskPage);
  const activeCRMPage = useUIStore((s) => s.activeCRMPage);
  const activeSettingsSubTab = useUIStore((s) => s.activeSettingsSubTab);
  const taskMode = useUIStore((s) => s.taskMode);
  const crmMode = useUIStore((s) => s.crmMode);
  const activeTaskId = useUIStore((s) => s.activeTaskId);
  const storeActiveTaskId = useTaskStore((s) => s.activeTaskId);
  const selectedClientId = useTaskStore((s) => s.selectedClientId);
  const selectedProjectId = useTaskStore((s) => s.selectedProjectId);
  const mode = useUIStore(selectActiveWorkspaceMode);
  const taskBinding = resolveTaskAssistantBinding({
    taskMode,
    crmMode,
    activeCRMPage,
    activeTaskId: activeTaskId ?? storeActiveTaskId,
    selectedClientId,
    selectedProjectId,
  });
  const contextPanelVisible = useUIStore(
    (s) => selectIsContextPanelAvailable(s) && selectIsContextPanelOpen(s),
  );

  const layout = resolveModeLayout({
    mode,
    editor,
    leftPanel,
    taskListPanel,
    subtasksBar,
    contextPanelOpenByMode,
    contextPanelWidth,
    activeTaskPage,
    activeCRMPage,
  });

  const assistantBody = fileViewerOpen ? (
    <div className="assistant-file-viewer-wrapper">
      <FileViewerPanel />
    </div>
  ) : (
    <>
      <div id="right-panel-subheader-wrapper" className="right-panel-subheader-wrapper">
        {mode === 'settings' ? (
          <RightPanelSubheader
            mode="writer"
            workspaceId={null}
            taskId={null}
            settingsTab={activeSettingsSubTab}
          />
        ) : taskBinding ? (
          <RightPanelSubheader
            mode="task"
            workspaceId={null}
            taskId={taskBinding.taskId}
          />
        ) : (
          <RightPanelSubheader />
        )}
      </div>
      {sidebar}
    </>
  );

  return (
    <WorkspaceShell
      primaryWrapperOpen={primaryWrapperOpen}
      assistantWrapperOpen={assistantWrapperOpen}
      wrappersSwapped={wrappersSwapped}
      assistantWrapperWidthVw={assistantWrapperWidth}
      assistantContentId={fileViewerOpen ? 'file-viewer-panel' : 'ai-sidebar-panel'}
      contextPanelVisible={contextPanelVisible}
      primary={layout.primary}
      // Always pass body so CSS-hidden assistant keeps chat/file-viewer mounted.
      assistant={assistantBody}
    />
  );
}

function resolveModeLayout(args: {
  mode: WorkspaceMode;
  editor: ReactNode;
  leftPanel: ReactNode;
  taskListPanel: ReactNode;
  subtasksBar?: ReactNode;
  contextPanelOpenByMode: {
    documents: boolean;
    tasks: boolean;
    crm: boolean;
    forms: boolean;
    settings: boolean;
  };
  contextPanelWidth: number;
  activeTaskPage: string;
  activeCRMPage: string;
}): { primary: ReactNode } {
  const {
    mode,
    editor,
    leftPanel,
    taskListPanel,
    subtasksBar,
    contextPanelOpenByMode,
    contextPanelWidth,
    activeTaskPage,
    activeCRMPage,
  } = args;

  // Settings: section components own PrimaryWorkspaceContent via SettingsPanels.
  if (mode === 'settings') {
    return { primary: <SettingsDocument /> };
  }

  if (mode === 'documents') {
    return {
      primary: (
        <PrimaryWorkspaceContent
          mode="documents"
          contextPanel={leftPanel}
          centerPanel={editor}
          contextPanelAvailable
          contextPanelOpen={contextPanelOpenByMode.documents}
          contextPanelWidthVw={contextPanelWidth}
          contextPanelId="file-tree-panel"
          contextPanelStyle={{ padding: '0 10px' }}
        />
      ),
    };
  }

  if (mode === 'tasks') {
    const projectsOnly = activeTaskPage === 'projects';
    const showSubtasks = !projectsOnly && activeTaskPage !== 'calendar' && Boolean(subtasksBar);
    const contextAvailable = !projectsOnly;
    return {
      primary: (
        <PrimaryWorkspaceContent
          mode="tasks"
          contextPanel={taskListPanel}
          centerPanel={editor}
          contextOnly={activeTaskPage === 'calendar'}
          contextPanelAvailable={contextAvailable}
          contextPanelOpen={contextPanelOpenByMode.tasks}
          contextPanelWidthVw={contextPanelWidth}
          contextPanelId="task-list-column"
          contextPanelStyle={{
            paddingTop: 0,
            paddingBottom: 0,
            backgroundColor: 'var(--c-background-2)',
          }}
          subtasksBar={subtasksBar}
          showSubtasksBar={showSubtasks}
        />
      ),
    };
  }

  if (mode === 'crm') {
    const contextAvailable = activeCRMPage !== 'pipeline' && activeCRMPage !== 'projects';
    return {
      primary: (
        <PrimaryWorkspaceContent
          mode="crm"
          contextPanel={leftPanel}
          centerPanel={editor}
          contextPanelAvailable={contextAvailable}
          contextPanelOpen={contextPanelOpenByMode.crm}
          contextPanelWidthVw={contextPanelWidth}
          contextPanelId="crm-forms-list-column"
          contextPanelStyle={{
            paddingTop: 0,
            paddingBottom: 0,
            backgroundColor: 'var(--c-background-2)',
          }}
        />
      ),
    };
  }

  // forms (hosted under CRM with activeCRMPage === 'forms')
  return {
    primary: (
      <PrimaryWorkspaceContent
        mode="forms"
        contextPanel={leftPanel}
        centerPanel={editor}
        contextPanelAvailable
        contextPanelOpen={contextPanelOpenByMode.forms}
        contextPanelWidthVw={contextPanelWidth}
        contextPanelId="crm-forms-list-column"
        contextPanelStyle={{
          paddingTop: 0,
          paddingBottom: 0,
          backgroundColor: 'var(--c-background-2)',
        }}
      />
    ),
  };
}
