import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Check, ChevronDown, Search, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { codexDesktopClient } from '../../services/codex/desktopClient';
import { codexSessionService } from '../../services/codex/sessionService';
import { useCodexService } from '../../services/codex/useCodexService';
import {
  setAllCodexModelsVisible, setCodexModelVisible, useCodexModelVisibility, visibleCodexModels,
} from '../../services/codex/modelVisibility';
import type { CodexDiscovery, CodexLoginStart } from '../../services/codex/types';
import { db } from '../../services/db';
import { isTauriRuntime } from '../../services/runtime';

export function CodexSettings() {
  const { t } = useTranslation();
  const { connection, models, error: serviceError } = useCodexService();
  const visibility = useCodexModelVisibility();
  const desktop = isTauriRuntime();
  const [path, setPath] = useState('');
  const [discovery, setDiscovery] = useState<CodexDiscovery | null>(null);
  const [login, setLogin] = useState<CodexLoginStart | null>(null);
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    void db.settings.get('codexExecutablePath').then((saved) => {
      if (!current) return;
      const selectedPath = typeof saved?.value === 'string' ? saved.value : '';
      setPath(selectedPath);
      if (desktop) {
        void codexDesktopClient.discover(selectedPath || undefined)
          .then((found) => { if (current) setDiscovery(found); })
          .catch((cause: unknown) => { if (current) setError(message(cause)); });
      }
    }).catch((cause: unknown) => { if (current) setError(message(cause)); });
    const subscription = liveQuery(async () => {
      const [savedModel, savedEffort] = await Promise.all([
        db.settings.get('codexModelId'), db.settings.get('codexEffort'),
      ]);
      return {
        model: typeof savedModel?.value === 'string' ? savedModel.value : '',
        effort: typeof savedEffort?.value === 'string' ? savedEffort.value : '',
      };
    }).subscribe({
      next: (saved) => { if (current) { setModelId(saved.model); setEffort(saved.effort); } },
      error: (cause: unknown) => { if (current) setError(message(cause)); },
    });
    return () => { current = false; subscription.unsubscribe(); };
  }, [desktop]);

  const shownModels = visibility ? visibleCodexModels(models, visibility) : models;
  const shownIds = new Set(shownModels.map((model) => model.id));
  const chosen = shownModels.find((model) => model.id === modelId)
    ?? shownModels.find((model) => model.isDefault) ?? shownModels[0];
  const unresolvedModel = Boolean(modelId && models.length && !models.some((model) => model.id === modelId));
  const allShown = models.length > 0 && shownModels.length === models.length;
  const someShown = shownModels.length > 0 && shownModels.length < models.length;
  const matchingModels = models.filter((model) =>
    `${model.displayName} ${model.id}`.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()));
  const version = connection?.version ?? discovery?.version;
  const executablePath = connection?.executablePath ?? discovery?.executablePath;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  return (
    <div className="codex-provider-detail">
      <div className="codex-provider-detail__inner">
        <header className="codex-provider-header">
          <span className="codex-provider-header__icon" aria-hidden="true"><TerminalSquare size={20} /></span>
          <div className="codex-provider-header__copy">
            <h2>{t('codex.title')}</h2>
            <p>{t('codex.description')}</p>
          </div>
          <span className={`codex-status-badge codex-status-badge--${connection ? 'connected' : 'disconnected'}`}>
            <span className={`settings-status-dot settings-status-dot--${connection ? 'connected' : 'disconnected'}`} aria-hidden="true" />
            {connection ? t('codex.signedIn') : t('codex.disconnected')}
          </span>
        </header>

        <section className="codex-card" aria-labelledby="codex-connection-heading">
          <div className="codex-card__head">
            <div>
              <h3 id="codex-connection-heading">{t('codex.connection')}</h3>
              <p>{t('codex.connectionHelp')}</p>
            </div>
          </div>
          {!desktop && <p className="codex-inline-notice" role="status">{t('codex.desktopOnly')}</p>}
          {desktop && <>
            <div className="codex-connection-summary">
              <div className="codex-connection-summary__title">
                <span className={`settings-status-dot settings-status-dot--${connection ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                <strong>{connection ? t('codex.signedIn') : t('codex.disconnected')}</strong>
              </div>
              {version && <p>{t('codex.cliVersion', { version })}</p>}
              {executablePath && <p className="codex-connection-summary__path" title={executablePath}>{executablePath}</p>}
            </div>
            <div className="codex-actions">
              <button type="button" className={connection ? 'btn btn--secondary' : 'btn-brand'} disabled={busy}
                onClick={() => void run(async () => {
                  if (connection) await codexSessionService.disconnect();
                  await codexSessionService.connect(await codexSessionService.defaultWorkspace(), path.trim() || undefined);
                  setLogin(null);
                  await db.settings.put({ key: 'codexExecutablePath', value: path.trim() });
                })}>{connection ? t('codex.reconnect') : t('codex.connect')}</button>
              {!connection && <button type="button" className="btn btn--secondary" disabled={busy}
                onClick={() => void run(async () => {
                  const started = await codexDesktopClient.beginLogin(await codexSessionService.defaultWorkspace(), path.trim() || undefined);
                  setLogin(started);
                })}>{t('codex.signIn')}</button>}
              {connection && <button type="button" className="btn btn--secondary" disabled={busy}
                onClick={() => void run(() => codexSessionService.disconnect())}>{t('codex.disconnect')}</button>}
            </div>
            {login && !connection && <div className="codex-login-flow">
              <label htmlFor="codex-login-url">{t('codex.openLogin')}</label>
              <input id="codex-login-url" className="ctrl" readOnly value={login.authUrl}
                onFocus={(event) => event.currentTarget.select()} />
              <div className="codex-actions">
                <button type="button" className="btn btn--secondary" disabled={busy}
                  onClick={() => void run(() => navigator.clipboard.writeText(login.authUrl))}>{t('codex.copyLink')}</button>
                <button type="button" className="btn-brand" disabled={busy}
                  onClick={() => void run(async () => {
                    await codexSessionService.connect(await codexSessionService.defaultWorkspace(), path.trim() || undefined);
                    setLogin(null);
                  })}>{t('codex.finishedSignIn')}</button>
                <button type="button" className="btn btn--secondary" disabled={busy}
                  onClick={() => void run(async () => {
                    await codexDesktopClient.cancelLogin(login.epoch, login.loginId);
                    setLogin(null);
                  })}>{t('codex.cancelSignIn')}</button>
              </div>
            </div>}
            <details className="codex-advanced-setup">
              <summary><ChevronDown size={14} aria-hidden="true" />{t('codex.advancedSetup')}</summary>
              <div className="codex-advanced-setup__body">
                <label htmlFor="codex-executable-path">{t('codex.path')}</label>
                <p>{t('codex.pathHint')}</p>
                <div className="codex-path-controls">
                  <input id="codex-executable-path" className="ctrl" value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder={t('codex.pathPlaceholder')} autoComplete="off" />
                  <button type="button" className="btn btn--secondary" disabled={busy}
                    onClick={() => void run(async () => {
                      const found = await codexDesktopClient.discover(path.trim() || undefined);
                      setDiscovery(found);
                      await db.settings.put({ key: 'codexExecutablePath', value: path.trim() });
                    })}>{t('codex.find')}</button>
                </div>
              </div>
            </details>
          </>}
          {(error || serviceError) && <p className="codex-error" role="alert">{error || serviceError}</p>}
        </section>

        <section className="codex-card" aria-labelledby="codex-models-heading">
          <div className="codex-card__head codex-card__head--models">
            <div>
              <h3 id="codex-models-heading">{t('codex.models')}</h3>
              <p>{t('codex.modelsShown', { shown: shownModels.length, total: models.length })}</p>
            </div>
            <label className="codex-toggle-label">
              <span>{t('codex.showAllModels')}</span>
              <input className={`codex-switch${someShown ? ' codex-switch--mixed' : ''}`}
                type="checkbox" checked={allShown} aria-checked={someShown ? 'mixed' : allShown}
                ref={(input) => { if (input) input.indeterminate = someShown; }}
                disabled={!connection || !models.length || !visibility || busy}
                onChange={(event) => void run(() => setAllCodexModelsVisible(event.target.checked))} />
            </label>
          </div>
          {connection && models.length > 0 ? <>
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
                      {chosen?.id === model.id && <span className="codex-model-tag codex-model-tag--selected"><Check size={11} />{t('codex.selectedModel')}</span>}
                    </div>
                    {model.id !== model.displayName && <span className="codex-model-row__id">{model.id}</span>}
                  </div>
                  <label className="codex-toggle-label codex-toggle-label--model">
                    <span>{shown ? t('codex.shown') : t('codex.hidden')}</span>
                    <input className="codex-switch" type="checkbox" role="switch" checked={shown}
                      aria-label={t('codex.showModel', { model: model.displayName })}
                      disabled={!visibility || busy}
                      onChange={(event) => void run(() => setCodexModelVisible(
                        model.id, event.target.checked, models.map((entry) => entry.id),
                      ))} />
                  </label>
                </div>;
              })}
              {matchingModels.length === 0 && <p className="codex-model-empty">{t('codex.noSearchResults')}</p>}
            </div>
            <p className="codex-card__footnote">{t('codex.visibilityHint')}</p>
            {shownModels.length === 0 && visibility && <p className="codex-inline-notice" role="status">{t('codex.noVisibleModels')}</p>}
          </> : <p className="codex-model-empty">{connection ? t('codex.noModels') : t('codex.connectForModels')}</p>}
        </section>

        {connection && shownModels.length > 0 && <section className="codex-card" aria-labelledby="codex-preferences-heading">
          <div className="codex-card__head">
            <div>
              <h3 id="codex-preferences-heading">{t('codex.preferences')}</h3>
              <p>{t('codex.preferencesHint')}</p>
            </div>
          </div>
          <div className="codex-preferences-grid">
            <label htmlFor="codex-default-model">
              <span>{t('codex.defaultModel')}</span>
              <select id="codex-default-model" className="ctrl" value={chosen?.id ?? ''}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setEffort('');
                  void run(async () => {
                    await db.settings.put({ key: 'codexModelId', value: event.target.value });
                    await db.settings.put({ key: 'codexEffort', value: '' });
                  });
                }}>
                {shownModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
              </select>
            </label>
            <label htmlFor="codex-default-effort">
              <span>{t('codex.reasoning')}</span>
              <select id="codex-default-effort" className="ctrl"
                value={chosen?.reasoningEfforts.includes(effort) ? effort : ''}
                disabled={!chosen?.reasoningEfforts.length}
                onChange={(event) => {
                  setEffort(event.target.value);
                  void run(() => db.settings.put({ key: 'codexEffort', value: event.target.value }).then(() => undefined));
                }}>
                <option value="">{t('codex.defaultEffort')}</option>
                {chosen?.reasoningEfforts.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            </label>
          </div>
          {unresolvedModel && <p className="codex-inline-notice" role="status">{t('codex.modelUnavailable')}</p>}
        </section>}
      </div>
    </div>
  );
}

function message(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : 'Codex operation failed';
}
