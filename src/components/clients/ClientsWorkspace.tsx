import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { db, type TabsDB } from '../../services/db';
import { createClientRecords } from '../../services/clients/records';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { isNoClient } from '../../stores/clientOverview';
import { useClientDetailsStore } from '../../stores/clientDetailsStore';
import { useClientStore } from '../../stores/clientStore';
import { useTaskStore } from '../../stores/taskStore';
import { ClientOverview } from './ClientOverview';
import { ClientProfile } from './ClientProfile';
import { ClientNotes } from './ClientNotes';
import './clients.css';

interface ClientsWorkspaceProps {
  database?: TabsDB;
  records?: ClientRecordsAdapter;
}

const defaultRecords = createClientRecords(db);

export function ClientsWorkspace({ database = db, records }: ClientsWorkspaceProps = {}) {
  const { t } = useTranslation();
  const category = useClientDetailsStore((state) => state.category);
  const setCategory = useClientDetailsStore((state) => state.setCategory);
  const clients = useClientStore((state) => state.clients);
  const selectedClientId = useTaskStore((state) => state.selectedClientId);
  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const liveClient = selectedClient && !isNoClient(selectedClient) ? selectedClient : null;
  const isNoClientScope = Boolean(selectedClient && isNoClient(selectedClient));
  const clientRecords = useMemo(() => records ?? (database === db ? defaultRecords : createClientRecords(database)), [database, records]);
  const identity = selectedClientId === null
    ? t('clients.everythingScope')
    : isNoClientScope
      ? t('clients.noClientScope')
      : selectedClient?.name ?? t('clients.unavailableBrand');
  const categoryTitle = category === 'overview' ? t('clients.overview')
    : category === 'profile' ? t('clients.profile') : t('clients.notes');

  return (
    <section className="clients-workspace" aria-label={t('clients.categoryPanelLabel', { category: categoryTitle, identity })}>
      <header className="clients-workspace-header">
        <p className="clients-workspace-eyebrow">{t('navigation.clients')}</p>
        <h1>{categoryTitle}</h1>
        <p className="clients-workspace-identity">{identity}</p>
      </header>
      <div id="clients-workspace-category" className="clients-workspace-content" role="tabpanel" tabIndex={0}
        aria-label={t('clients.categoryPanelLabel', { category: categoryTitle, identity })}>
        {category === 'overview' && <ClientOverview clientId={selectedClientId} records={clientRecords}
          onViewNotes={() => setCategory('notes')}
          onCreateNote={!isNoClientScope && (selectedClientId === null || liveClient !== null)
            ? () => setCategory('notes') : undefined}
          onProfile={liveClient ? () => setCategory('profile') : undefined} />}
        {category === 'profile' && <ClientProfile client={liveClient} records={clientRecords} database={database} />}
        {category === 'notes' && <ClientNotes clientId={selectedClientId} records={clientRecords} database={database} />}
      </div>
    </section>
  );
}
