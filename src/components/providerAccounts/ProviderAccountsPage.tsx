import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauriRuntime } from '../../services/runtime';
import { accountConnections, accountIsStale, remainingPercent, USAGE_REFRESH_MS, usageWindow } from '../../services/providerAccounts/model';
import { useProviderAccountsStore } from '../../services/providerAccounts/store';
import type { ProviderAccount, UsageWindow } from '../../services/providerAccounts/types';
import { PrimaryWorkspaceContent } from '../layout/workspace';
import { AssistantToggle } from '../layout/workspace/AssistantToggle';
import './providerAccounts.css';

export function ProviderAccountsPage({ store = useProviderAccountsStore }: { store?: typeof useProviderAccountsStore }) {
  const { t, i18n } = useTranslation();
  const accounts = store((state) => state.accounts);
  const connections = store((state) => state.connections);
  const loaded = store((state) => state.loaded);
  const loading = store((state) => state.loading);
  const refreshing = store((state) => state.refreshing);
  const observing = store((state) => state.observing);
  const error = store((state) => state.error);
  const connectionError = store((state) => state.connectionError);
  const pending = store((state) => state.pendingLogins);
  const actionErrors = store((state) => state.actionErrors);
  const [now, setNow] = useState(() => Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const desktop = isTauriRuntime();
  const stamp = (value: number | null) => value === null ? t('providerAccounts.unknown')
    : new Date(value).toLocaleString(i18n.language);

  useEffect(() => {
    if (!desktop) return;
    void store.getState().load().then(() => store.getState().refresh());
    void store.getState().refreshConnections();
  }, [desktop, store]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!desktop || !autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void store.getState().refresh(); void store.getState().refreshConnections();
    }, USAGE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, desktop, store]);
  const hasPending = Object.keys(pending).length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => { void store.getState().pollLogins(); }, 2000);
    return () => window.clearInterval(timer);
  }, [hasPending, store]);

  const refresh = () => {
    if (!loaded) { void store.getState().load(); return; }
    void store.getState().refresh(); void store.getState().refreshConnections(); setNow(Date.now());
  };
  const connect = async (id: string) => {
    setConnecting(id);
    try { await store.getState().connect(id); } finally { setConnecting(null); }
  };
  const windowBlock = (window: UsageWindow | null, title: string) => {
    const remaining = remainingPercent(window?.usedPercent ?? null);
    return <div className="provider-limit">
      <div className="provider-limit-heading"><span>{title}</span><strong>{remaining === null
        ? t('providerAccounts.unknown') : t('providerAccounts.remaining', { value: remaining.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) })}</strong></div>
      {remaining !== null && <progress max={100} value={remaining} aria-label={title} />}
      <span className="provider-meta">{window?.resetsAt == null ? t('providerAccounts.resetUnknown')
        : window.resetsAt <= now ? t('providerAccounts.resetAwaitingRefresh')
          : t('providerAccounts.resetsAt', { time: stamp(window.resetsAt) })}</span>
    </div>;
  };
  const accountCard = (account: ProviderAccount) => {
    const bindings = accountConnections(account, connections);
    const busy = Boolean(pending[account.id]) || connecting === account.id;
    return <article key={account.id} className="ui-card provider-account-card" aria-label={account.label}>
      <header className="provider-card-heading"><div><h2>{account.label}</h2>
        <p>{account.identity?.email ?? t('providerAccounts.noAccount')}</p></div>
        <span className="provider-status" data-status={account.status}>{t(`providerAccounts.status.${account.status}`)}</span></header>
      {account.identity?.plan && <p className="provider-meta">{t('providerAccounts.plan', { plan: account.identity.plan })}</p>}
      {account.duplicateOf ? <p role="status">{t('providerAccounts.duplicate', { account: account.duplicateOf })}</p> : <>
        {windowBlock(usageWindow(account.usage, 300), t('providerAccounts.fiveHour'))}
        {windowBlock(usageWindow(account.usage, 10080), t('providerAccounts.weekly'))}
        <div className="provider-reset-tokens"><span>{t('providerAccounts.resetTokens')}</span><strong>{account.usage?.resetTokens ?? t('providerAccounts.unknown')}</strong></div>
      </>}
      <div className="provider-meta">
        {accountIsStale(account, now) && <p className="provider-warning">{t('providerAccounts.stale')}</p>}
        <p>{t('providerAccounts.lastSuccess', { time: stamp(account.lastSuccessAt) })}</p>
        <p>{t('providerAccounts.lastAttempt', { time: stamp(account.lastAttemptAt) })}</p>
        {bindings.map((binding) => <p key={binding.id}>{t(`providerAccounts.consumers.${binding.id}`)} · {t(`providerAccounts.evidence.${binding.evidence}`)}</p>)}
      </div>
      {account.error && <p className="provider-warning" role="status">{t('providerAccounts.accountError')}</p>}
      {pending[account.id] && <p role="status">{t('providerAccounts.loginPending')}</p>}
      {actionErrors[account.id] && <p role="alert" className="provider-warning">{t(`providerAccounts.errors.${actionErrors[account.id]}`)}</p>}
      <footer className="provider-card-actions">
        {pending[account.id] ? <>
          <button type="button" className="ui-button" onClick={() => void store.getState().openLogin(account.id)}><ExternalLink />{t('providerAccounts.openBrowser')}</button>
          <button type="button" className="ui-button" onClick={() => void store.getState().cancelLogin(account.id)}>{t('providerAccounts.cancelLogin')}</button>
        </> : <button type="button" className="ui-button" disabled={!desktop || busy || connecting !== null || hasPending}
          onClick={() => void connect(account.id)}><UserRound />{t(account.identity ? 'providerAccounts.reconnect' : 'providerAccounts.connect')}</button>}
        <button type="button" className="ui-icon-button" disabled={!desktop || refreshing || busy}
          aria-label={t('providerAccounts.refreshAccount', { account: account.label })}
          title={t('providerAccounts.refreshAccount', { account: account.label })}
          onClick={() => void store.getState().refresh(account.id)}><RefreshCw /></button>
      </footer>
    </article>;
  };

  return <PrimaryWorkspaceContent mode="providerAccounts" contextPanelAvailable={false} contextPanelOpen={false} contextPanelWidthVw={0}
    centerPanel={<section className="provider-accounts-page" aria-label={t('providerAccounts.title')}>
      <div className="ui-toolbar provider-accounts-toolbar"><h1>{t('providerAccounts.title')}</h1>
        <div className="provider-toolbar-actions"><label className="provider-auto-refresh"><input type="checkbox" checked={autoRefresh}
          onChange={(event) => setAutoRefresh(event.currentTarget.checked)} />{t('providerAccounts.autoRefresh')}</label>
          <button type="button" className="ui-button" disabled={!desktop || loading || refreshing || observing} onClick={refresh}><RefreshCw />{t('providerAccounts.refresh')}</button>
          <AssistantToggle id="provider-accounts-btn-assistant" variant="header" />
        </div>
      </div>
      <div className="ui-page-body provider-accounts-body">
        <p className="provider-meta">{t('providerAccounts.intro')}</p>
        {!desktop && <p role="status">{t('providerAccounts.desktopOnly')}</p>}
        {loading && <p role="status">{t('providerAccounts.loading')}</p>}
        {error && <p role="alert" className="provider-warning">{t(`providerAccounts.errors.${error}`)}</p>}
        <div className="provider-accounts-grid">{accounts.map(accountCard)}</div>
        <section className="provider-connections" aria-labelledby="provider-connections-title">
          <h2 id="provider-connections-title">{t('providerAccounts.connectionsTitle')}</h2>
          <p className="provider-meta">{t('providerAccounts.evidenceHint')}</p>
          {connectionError && <p role="alert" className="provider-warning">{t(`providerAccounts.errors.${connectionError}`)}</p>}
          <div className="provider-table-scroll"><table><thead><tr>
            <th>{t('providerAccounts.application')}</th><th>{t('providerAccounts.account')}</th>
            <th>{t('providerAccounts.confirmation')}</th><th>{t('providerAccounts.checkedAt')}</th>
          </tr></thead><tbody>{connections.map((connection) => <tr key={connection.id}>
            <th scope="row">{t(`providerAccounts.consumers.${connection.id}`)}</th>
            <td>{connection.identity?.email ?? connection.identity?.workspaceId ?? t('providerAccounts.unknown')}</td>
            <td>{t(`providerAccounts.evidence.${connection.evidence}`)}
              {connection.error && connection.error !== 'runtimeUnverified' && <p className="provider-meta">{t(`providerAccounts.observationErrors.${connection.error}`)}</p>}
            </td><td>{stamp(connection.observedAt)}</td>
          </tr>)}</tbody></table></div>
        </section>
      </div>
    </section>} />;
}
