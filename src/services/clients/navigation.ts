import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';

export function enterClients(): void {
  const ui = useUIStore.getState();
  const alreadyInClients = ui.crmMode && ui.activeCRMPage === 'clients';

  const tasks = useTaskStore.getState();
  tasks.setSelection(tasks.selectedClientId, null);
  if (!alreadyInClients) useClientDetailsStore.getState().setCategory('overview');
  ui.setActiveCRMPage('clients');
  ui.setCrmMode(true);
  ui.setContextPanelOpen('crm', true);
}
