import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Check, Search, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '../../services/db';
import {
  setAllProviderModelsVisible, setProviderModelVisible, useProviderModelVisibility, visibleProviderModels,
} from '../../services/providers/modelVisibility';
import type { CliProviderId } from '../../services/providers/desktopClient';
import { cliProviderStatus, type CliProviderState } from './cliProviderStatus';

interface CliProviderSettingsProps {
  providerId: CliProviderId;
  name: string;
  loginCommand: string;
  desktop: boolean;
  state?: CliProviderState;
  onRefresh: (providerId: CliProviderId) => Promise<void>;
}

export function CliProviderSettings({
  providerId, name, loginCommand, desktop, state, onRefresh,
}: CliProviderSettingsProps) {
  const { t } = useTranslation();
  const visibility = useProviderModelVisibility(providerId);
  const [savedModelId, setSavedModelId] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const saved = await db.settings.get(`providerModelId:${providerId}`);
      return typeof saved?.value === 'string' ? saved.value : '';
    }).subscribe({
      next: setSavedModelId,
      error: (cause: unknown) => setError(errorMessage(cause)),
    });
    return () => subscription.unsubscribe();
  }, [providerId]);

  const status = cliProviderStatus(state);
  const models = state?.probe?.installed ? state.probe.models : [];
  const shownModels = visibility ? visibleProviderModels(models, visibility) : models;
  const shownIds = new Set(shownModels.map((model) => model.id));
  const selectedModel = shownModels.find((model) => model.id === savedModelId)
    ?? shownModels.find((model) => model.isDefault) ?? shownModels[0];
  const savedModelUnavailable = Boolean(savedModelId && models.length && !shownIds.has(savedModelId));
  const allShown = models.length > 0 && shownModels.length === models.length;
  const someShown = shownModels.length > 0 && shownModels.length < models.length;
  const matchingModels = models.filter((model) =>
    `${model.displayName} ${model.id}`.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <div className="codex-provider-detail">
    <div className="codex-provider-detail__inner">
      <header className="codex-provider-header">
        <span className="codex-provider-header__icon" aria-hidden="true"><TerminalSquare size={20} /></span>
        <div className="codex-provider-header__copy">
          <h2>{name}</h2>
          <p>{t('cliProviders.description', { provider: name })}</p>
        </div>
        <span className={`codex-status-badge${status === 'signedIn' ? ' codex-status-badge--connected' : ''}`} role="status">
          <span className={`settings-status-dot settings-status-dot--${status === 'signedIn' ? 'connected' : 'disconnected'}`} aria-hidden="true" />
          {t(`cliProviders.status.${status}`)}
        </span>
      </header>

      <section className="codex-card" aria-labelledby={`cli-${providerId}-connection`}>
        <div className="codex-card__head">
          <div>
            <h3 id={`cli-${providerId}-connection`}>{t('codex.connection')}</h3>
            <p>{t('cliProviders.connectionHelp', { provider: name })}</p>
          </div>
        </div>
        {!desktop ? <p className="codex-inline-notice" role="status">{t('cliProviders.desktopOnly')}</p> : <>
          <div className="codex-connection-summary">
            <div className="codex-connection-summary__title">
              <span className={`settings-status-dot settings-status-dot--${status === 'signedIn' ? 'connected' : 'disconnected'}`} aria-hidden="true" />
              <strong>{t(`cliProviders.status.${status}`)}</strong>
            </div>
            {state?.probe?.version && <p>{t('cliProviders.cliVersion', { provider: name, version: state.probe.version })}</p>}
            {state?.probe?.executablePath && <p className="codex-connection-summary__path" title={state.probe.executablePath}>
              {state.probe.executablePath}
            </p>}
          </div>
          <div className="codex-actions">
            <button type="button" className="btn btn--secondary" disabled={state?.loading}
              onClick={() => void onRefresh(providerId)}>{t('cliProviders.refresh')}</button>
          </div>
          {status !== 'signedIn' && <div className="cli-provider-login">
            <p>{t('cliProviders.loginHelp', { provider: name })}</p>
            <code>{loginCommand}</code>
            <p>{t('cliProviders.refreshAfterLogin')}</p>
          </div>}
        </>}
        {(error || state?.error || state?.probe?.error) && <p className="codex-error" role="alert">
          {error || state?.error || state?.probe?.error}
        </p>}
      </section>

      <section className="codex-card" aria-labelledby={`cli-${providerId}-models`}>
        <div className="codex-card__head codex-card__head--models">
          <div>
            <h3 id={`cli-${providerId}-models`}>{t('codex.models')}</h3>
            <p>{t('codex.modelsShown', { shown: shownModels.length, total: models.length })}</p>
          </div>
          <label className="codex-toggle-label">
            <span>{t('codex.showAllModels')}</span>
            <input className={`codex-switch${someShown ? ' codex-switch--mixed' : ''}`}
              type="checkbox" checked={allShown} aria-checked={someShown ? 'mixed' : allShown}
              ref={(input) => { if (input) input.indeterminate = someShown; }}
              disabled={!models.length || !visibility || busy}
              onChange={(event) => void run(() => setAllProviderModelsVisible(providerId, event.target.checked))} />
          </label>
        </div>
        {models.length > 0 ? <>
          <div className="codex-model-toolbar">
            <label className="codex-model-search">
              <Search size={15} aria-hidden="true" />
              <input className="ctrl" type="search" aria-label={t('codex.searchModels')} value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)} placeholder={t('codex.searchModels')} />
            </label>
          </div>
          <div className="codex-model-list">
            {matchingModels.map((model) => {
              const shown = shownIds.has(model.id);
              return <div className={`codex-model-row${shown ? '' : ' codex-model-row--hidden'}`} key={model.id}>
                <div className="codex-model-row__info">
                  <div className="codex-model-row__title">
                    <strong>{model.displayName}</strong>
                    {model.isDefault && <span className="codex-model-tag">{t('codex.nativeDefault')}</span>}
                    {selectedModel?.id === model.id && <span className="codex-model-tag codex-model-tag--selected">
                      <Check size={11} />{t('codex.selectedModel')}
                    </span>}
                  </div>
                  {model.id !== model.displayName && <span className="codex-model-row__id">{model.id}</span>}
                </div>
                <label className="codex-toggle-label codex-toggle-label--model">
                  <span>{shown ? t('codex.shown') : t('codex.hidden')}</span>
                  <input className="codex-switch" type="checkbox" role="switch" checked={shown}
                    aria-label={t('cliProviders.showModel', { model: model.displayName, provider: name })}
                    disabled={!visibility || busy}
                    onChange={(event) => void run(() => setProviderModelVisible(
                      providerId, model.id, event.target.checked, models.map((entry) => entry.id),
                    ))} />
                </label>
              </div>;
            })}
            {matchingModels.length === 0 && <p className="codex-model-empty">{t('codex.noSearchResults')}</p>}
          </div>
          <p className="codex-card__footnote">{t('cliProviders.visibilityHint')}</p>
          {shownModels.length === 0 && visibility && <p className="codex-inline-notice" role="status">
            {t('cliProviders.noVisibleModels')}
          </p>}
        </> : <p className="codex-model-empty">{t(
          !desktop ? 'cliProviders.desktopForModels'
            : state?.loading ? 'cliProviders.checkingModels'
              : status === 'notInstalled' ? 'cliProviders.installForModels'
                : status === 'notChecked' || status === 'checkFailed' ? 'cliProviders.checkForModels'
                  : 'cliProviders.noModels', { provider: name },
        )}</p>}
      </section>

      {shownModels.length > 0 && <section className="codex-card" aria-labelledby={`cli-${providerId}-preferences`}>
        <div className="codex-card__head">
          <div>
            <h3 id={`cli-${providerId}-preferences`}>{t('codex.preferences')}</h3>
            <p>{t('cliProviders.preferencesHint')}</p>
          </div>
        </div>
        <div className="codex-preferences-grid">
          <label htmlFor={`cli-${providerId}-default-model`}>
            <span>{t('codex.defaultModel')}</span>
            <select id={`cli-${providerId}-default-model`} className="ctrl" value={selectedModel?.id ?? ''}
              disabled={busy}
              onChange={(event) => {
                const modelId = event.target.value;
                setSavedModelId(modelId);
                void run(() => db.settings.put({ key: `providerModelId:${providerId}`, value: modelId }).then(() => undefined));
              }}>
              {shownModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </select>
          </label>
        </div>
        {savedModelUnavailable && <p className="codex-inline-notice" role="status">{t('codex.modelUnavailable')}</p>}
      </section>}
    </div>
  </div>;
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : String(error);
}
