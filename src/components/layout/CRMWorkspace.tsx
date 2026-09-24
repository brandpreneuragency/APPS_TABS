import '../crm/crmLayout.css';
import './workspacePages.css';
import { useUIStore, type CRMPage } from '../../stores/uiStore';
import CRMDashboardPage from '../crm/pages/CRMDashboardPage';
import CRMLeadsPage from '../crm/pages/CRMLeadsPage';
import CRMContactsPage from '../crm/pages/CRMContactsPage';
import CRMCompaniesPage from '../crm/pages/CRMCompaniesPage';
import CRMPipelinePage from '../crm/pages/CRMPipelinePage';
import CRMActivitiesPage from '../crm/pages/CRMActivitiesPage';
import CRMSettingsPage from '../crm/pages/CRMSettingsPage';
import { FormsWorkspace } from './FormsWorkspace';
import { TaskProjectsKanban } from '../taskManager/TaskProjectsKanban';

function renderCRMPage(page: CRMPage) {
  switch (page) {
    case 'dashboard':
      return <CRMDashboardPage />;
    case 'leads':
      return <CRMLeadsPage />;
    case 'contacts':
      return <CRMContactsPage />;
    case 'companies':
      return <CRMCompaniesPage />;
    case 'pipeline':
      return <CRMPipelinePage />;
    case 'activities':
      return <CRMActivitiesPage />;
    case 'forms':
      // Forms sub-module is hosted inside CRM mode; FormsWorkspace picks the
      // exact forms page from activeFormsPage (list/builder/submissions/templates/settings).
      return <FormsWorkspace />;
    case 'settings':
      return <CRMSettingsPage />;
  }
}

export function CRMWorkspace() {
  const { activeCRMPage } = useUIStore();

  if (activeCRMPage === 'projects') return <TaskProjectsKanban />;

  return (
    <div id="crm-workspace" className="crm-workspace panel">
      <div className="crm-workspace-body panel-body">{renderCRMPage(activeCRMPage)}</div>
    </div>
  );
}
