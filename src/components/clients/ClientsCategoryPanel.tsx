import { Building2, Layers, StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isNoClient } from '../../stores/clientOverview';
import { useClientDetailsStore, type ClientCategory } from '../../stores/clientDetailsStore';
import { useClientStore } from '../../stores/clientStore';
import { useTaskStore } from '../../stores/taskStore';
import './clients.css';

const categories = [
  { id: 'overview', label: 'clients.overview', icon: Layers },
  { id: 'profile', label: 'clients.profile', icon: Building2 },
  { id: 'notes', label: 'clients.notes', icon: StickyNote },
] as const;

export function ClientsCategoryPanel() {
  const { t } = useTranslation();
  const category = useClientDetailsStore((state) => state.category);
  const setCategory = useClientDetailsStore((state) => state.setCategory);
  const clients = useClientStore((state) => state.clients);
  const selectedClientId = useTaskStore((state) => state.selectedClientId);
  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const liveClient = selectedClient && !isNoClient(selectedClient) ? selectedClient : null;
  const isEverything = selectedClientId === null;
  const isNoClientScope = Boolean(selectedClient && isNoClient(selectedClient));
  const identity = isEverything
    ? t('clients.everythingScope')
    : isNoClientScope
      ? t('clients.noClientScope')
      : selectedClient?.name ?? t('clients.unavailableBrand');
  const profileDisabled = liveClient === null;
  const tabStopCategory: ClientCategory = category === 'profile' && profileDisabled ? 'overview' : category;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    const nextIndex = event.key === 'ArrowDown' ? (index + 1) % buttons.length
      : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
      : null;
    if (nextIndex === null) return;
    event.preventDefault();
    buttons[nextIndex]?.focus();
    buttons[nextIndex]?.click();
  };

  return (
    <section className="clients-category-panel" aria-label={t('clients.categoryNavigation')}>
      <header className="clients-category-heading">
        <span className="clients-category-eyebrow">{t('navigation.clients')}</span>
        <h2 className="clients-category-identity" title={identity}>{identity}</h2>
      </header>
      <div className="clients-category-tabs" role="tablist" aria-label={t('clients.categoryNavigation')}
        aria-orientation="vertical" onKeyDown={handleKeyDown}>
        {categories.map(({ id, label, icon: Icon }) => {
          const disabled = id === 'profile' && profileDisabled;
          return (
            <button key={id} id={`clients-category-${id}`} type="button" role="tab" className="clients-category-tab"
              aria-selected={category === id} aria-controls="clients-workspace-category"
              aria-describedby={disabled ? 'clients-profile-disabled-reason' : undefined}
              title={disabled ? t('clients.profileNeedsBrand') : undefined}
              tabIndex={tabStopCategory === id ? 0 : -1} disabled={disabled}
              onClick={() => setCategory(id)}>
              <Icon size={15} aria-hidden="true" />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </div>
      {profileDisabled && <p id="clients-profile-disabled-reason" className="clients-profile-explanation">
        {t('clients.profileNeedsBrand')}
      </p>}
    </section>
  );
}
