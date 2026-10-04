import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acceptance, authErrorCode, checkAcceptanceStorage, type AcceptanceDiagnostics, type GmailAuthStatus } from '../../../services/gmail/acceptance';
import './acceptance.css';

export default function AcceptanceApp() {
  const { t, i18n } = useTranslation();
  const [diagnostics, setDiagnostics] = useState<AcceptanceDiagnostics | null>(null);
  const [status, setStatus] = useState<GmailAuthStatus | null>(null);
  const [mailbox, setMailbox] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageRestored, setStorageRestored] = useState(false);
  const [readAccessPassed, setReadAccessPassed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const info = await acceptance.diagnostics();
        const restored = await checkAcceptanceStorage(info.startupAt);
        const current = await acceptance.status();
        if (active) {
          setDiagnostics(info); setStorageRestored(restored); setStatus(current);
          setMailbox(current.mailbox ?? '');
        }
      } catch (caught) { if (active) setError(authErrorCode(caught)); }
    })();
    return () => { active = false; };
  }, []);

  async function perform(action: () => Promise<GmailAuthStatus>) {
    setBusy(true); setError(''); setReadAccessPassed(false);
    try { setStatus(await action()); }
    catch (caught) { setError(authErrorCode(caught)); }
    finally {
      try { setStatus(await acceptance.status()); } catch { /* Preserve the original sanitized error. */ }
      setBusy(false);
    }
  }

  async function checkReadAccess() {
    setBusy(true); setError(''); setReadAccessPassed(false);
    try {
      const report = await acceptance.checkReadAccess();
      setReadAccessPassed(report.status === 'passed' && report.listEndpointVerified);
    } catch (caught) { setError(authErrorCode(caught)); }
    finally {
      try { setStatus(await acceptance.status()); } catch { /* Keep the original error. */ }
      setBusy(false);
    }
  }

  return <main className="clients-acceptance">
    <header>
      <div><p className="clients-acceptance-eyebrow">TABS Clients Acceptance</p><h1>{t('acceptance.title')}</h1></div>
      <div className="clients-acceptance-actions">
        <button type="button" onClick={() => void i18n.changeLanguage(i18n.language === 'tr' ? 'en' : 'tr')}>TR / EN</button>
        <button type="button" onClick={() => void acceptance.quit().catch(() => setError('CONFLICT'))}>{t('acceptance.quit')}</button>
      </div>
    </header>
    <p>{t('acceptance.intro')}</p>
    <section aria-labelledby="acceptance-google-title">
      <h2 id="acceptance-google-title">{t('acceptance.google')}</h2>
      <p>{t('acceptance.config')} <strong>{status ? t(status.configReady ? 'acceptance.ready' : 'acceptance.missing') : '…'}</strong></p>
      <form onSubmit={(event) => { event.preventDefault(); void perform(() => acceptance.connect(mailbox)); }}>
        <label htmlFor="acceptance-mailbox">{t('acceptance.mailbox')}</label>
        <input id="acceptance-mailbox" type="email" autoComplete="off" required value={mailbox}
          disabled={busy || status?.accountPresent} onChange={(event) => setMailbox(event.target.value)} />
        <div className="clients-acceptance-actions">
          <button type="submit" disabled={busy || !diagnostics || !status?.configReady || !mailbox}>{t('acceptance.connect')}</button>
          <button type="button" disabled={busy || !status?.accountPresent}
            onClick={() => void perform(acceptance.refresh)}>{t('acceptance.refresh')}</button>
          <button type="button" disabled={busy || !status?.accountPresent}
            onClick={() => void checkReadAccess()}>{t('acceptance.readAccess')}</button>
          {busy && <button type="button" onClick={() => void acceptance.cancel().catch(() => setError('CONFLICT'))}>{t('acceptance.cancel')}</button>}
          <button type="button" disabled={busy || !status?.accountPresent}
            onClick={() => void perform(acceptance.disconnect)}>{t('acceptance.disconnect')}</button>
        </div>
      </form>
      <p role="status" aria-live="polite">{t(busy ? 'acceptance.waiting' : status?.refreshVerifiedThisRun ? 'acceptance.refreshed' : status?.verifiedThisRun ? 'acceptance.connected' : status?.accountPresent ? 'acceptance.saved' : 'acceptance.notConnected')}</p>
      {error && <p role="alert">{t(`acceptance.errors.${error}`, { defaultValue: t('acceptance.errors.CONFLICT') })}</p>}
      {readAccessPassed && <p role="status">{t('acceptance.readAccessPassed')}</p>}
      <p>{t('acceptance.restart')}</p>
    </section>
    <section aria-labelledby="acceptance-isolation-title">
      <h2 id="acceptance-isolation-title">{t('acceptance.isolation')}</h2>
      <p>{t(storageRestored ? 'acceptance.storageRestored' : 'acceptance.storageFirstRun')}</p>
      <details><summary>{t('acceptance.diagnostics')}</summary>
        {diagnostics && <dl>
          <dt>Identifier</dt><dd>{diagnostics.identifier}</dd>
          <dt>PID</dt><dd>{diagnostics.pid}</dd>
          <dt>WebView</dt><dd>{diagnostics.webviewProfile}</dd>
          <dt>Keyring</dt><dd>{diagnostics.credentialService}</dd>
          <dt>Executable</dt><dd>{diagnostics.executablePath}</dd>
        </dl>}
      </details>
      <p>{t('acceptance.pending')}</p>
    </section>
  </main>;
}
