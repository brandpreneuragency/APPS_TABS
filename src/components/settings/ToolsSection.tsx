import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TerminalSquare } from 'lucide-react';
import { useCodexService } from '../../services/codex/useCodexService';
import { probeCliProvider, type CliProviderId } from '../../services/providers/desktopClient';
import { useProviderModelVisibility, visibleProviderModels, type ProviderId, type ProviderModel } from '../../services/providers/modelVisibility';
import { isTauriRuntime } from '../../services/runtime';
import { CliProviderSettings } from './CliProviderSettings';
import { cliProviderStatus, type CliProviderState } from './cliProviderStatus';
import { CodexSettings } from './CodexSettings';
import { SettingsPanels } from './SettingsPanels';
import './codexSettings.css';

const cliProviders: Record<CliProviderId, { name: string; loginCommand: string }> = {
  grok: { name: 'Grok', loginCommand: 'grok login' },
  commandCode: { name: 'Command Code', loginCommand: 'cmdc login' },
  openCode: { name: 'OpenCode', loginCommand: 'opencode auth login' },
};
const cliProviderIds: CliProviderId[] = ['grok', 'commandCode', 'openCode'];

function SelectedProviderCount({ providerId, models }: { providerId: ProviderId; models: ProviderModel[] }) {
  const { t } = useTranslation();
  const visibility = useProviderModelVisibility(providerId);
  const shown = visibility ? visibleProviderModels(models, visibility).length : models.length;
  return <div className="codex-provider-nav__footer">{t('codex.modelsShown', { shown, total: models.length })}</div>;
}

export function ToolsSection() {
  const { t } = useTranslation();
  const { connection, models } = useCodexService();
  const desktop = isTauriRuntime();
  const [provider, setProvider] = useState<ProviderId>('codex');
  const isCliSettingsProvider = (id: ProviderId): id is CliProviderId => id === 'grok' || id === 'commandCode' || id === 'openCode';
  const [probeState, setProbeState] = useState<Partial<Record<CliProviderId, CliProviderState>>>({});
  const inFlight = useRef(new Map<CliProviderId, Promise<void>>());

  const refreshProvider = useCallback((providerId: CliProviderId): Promise<void> => {
    const running = inFlight.current.get(providerId);
    if (running) return running;
    setProbeState((current) => ({ ...current, [providerId]: { loading: true } }));
    const request = probeCliProvider(providerId)
      .then((probe) => setProbeState((current) => ({ ...current, [providerId]: { probe } })))
      .catch((cause: unknown) => setProbeState((current) => ({
        ...current,
        [providerId]: { error: errorMessage(cause) },
      })))
      .finally(() => { inFlight.current.delete(providerId); });
    inFlight.current.set(providerId, request);
    return request;
  }, []);

  const selectedCliState = isCliSettingsProvider(provider) ? probeState[provider] : undefined;
  useEffect(() => {
    if (isCliSettingsProvider(provider) && desktop && !selectedCliState) void refreshProvider(provider);
  }, [provider, desktop, selectedCliState, refreshProvider]);

  const selectedModels = provider === 'codex' ? (connection ? models : [])
    : isCliSettingsProvider(provider) && probeState[provider]?.probe?.installed ? probeState[provider].probe?.models ?? [] : [];

  const providerList = (
    <nav className="codex-provider-nav" aria-label={t('codex.providers')}>
      <div className="codex-provider-nav__heading">{t('codex.providers')}</div>
      <div className="settings-list-body">
        <button type="button" aria-current={provider === 'codex' ? 'page' : undefined}
          className={`settings-list-item codex-provider-nav__item${provider === 'codex' ? ' settings-list-item--active' : ''}`}
          onClick={() => setProvider('codex')}>
          <span className="codex-provider-nav__icon" aria-hidden="true"><TerminalSquare size={16} /></span>
          <span className="codex-provider-nav__text">
            <span className="codex-provider-nav__name">Codex</span>
            <span className="codex-provider-nav__meta">{connection ? t('codex.signedIn') : t('codex.disconnected')}</span>
          </span>
          <span className={`settings-status-dot settings-status-dot--${connection ? 'connected' : 'disconnected'}`} aria-hidden="true" />
        </button>
        {cliProviderIds.map((providerId) => {
          const state = probeState[providerId];
          const status = cliProviderStatus(state);
          return <button key={providerId} type="button" aria-current={provider === providerId ? 'page' : undefined}
            className={`settings-list-item codex-provider-nav__item${provider === providerId ? ' settings-list-item--active' : ''}`}
            onClick={() => setProvider(providerId)}>
            <span className="codex-provider-nav__icon" aria-hidden="true"><TerminalSquare size={16} /></span>
            <span className="codex-provider-nav__text">
              <span className="codex-provider-nav__name">{cliProviders[providerId].name}</span>
              <span className="codex-provider-nav__meta">
                {desktop ? t(`cliProviders.status.${status}`) : t('cliProviders.status.desktopOnly')}
              </span>
            </span>
            <span className={`settings-status-dot settings-status-dot--${status === 'signedIn' ? 'connected' : 'disconnected'}`} aria-hidden="true" />
          </button>;
        })}
      </div>
      {selectedModels.length > 0 && <SelectedProviderCount key={provider} providerId={provider} models={selectedModels} />}
    </nav>
  );

  const centerMain = provider === 'codex' ? <CodexSettings /> : isCliSettingsProvider(provider) ? <CliProviderSettings
    key={provider} providerId={provider} name={cliProviders[provider].name}
    loginCommand={cliProviders[provider].loginCommand} desktop={desktop}
    state={probeState[provider]} onRefresh={refreshProvider}
  /> : <CodexSettings />;

  return <SettingsPanels leftMain={providerList} centerMain={centerMain} />;
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : String(error);
}
