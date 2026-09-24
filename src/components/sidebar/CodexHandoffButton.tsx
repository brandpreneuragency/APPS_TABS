import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../services/db';
import { codexSessionService } from '../../services/codex/sessionService';
import { useChatStore } from '../../stores/chatStore';

interface Props {
  appThreadId: string | null;
  mode: 'writer' | 'task';
  workspaceId?: string | null;
  taskId?: string | null;
  settingsTab?: string | null;
}

export function CodexHandoffButton({ appThreadId, mode, workspaceId, taskId, settingsTab }: Props) {
  const { t } = useTranslation();
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!appThreadId) return;
    void Promise.all([
      db.codexSessions.get(appThreadId),
      db.codexRuns.where('appThreadId').equals(appThreadId).count(),
      db.chatMessages.where('threadId').equals(appThreadId).count(),
    ]).then(([session, runs, messages]) => { if (!cancelled) setLegacy(!session && !runs && messages > 0); });
    return () => { cancelled = true; };
  }, [appThreadId]);
  if (!legacy || !appThreadId) return null;
  async function handoff() {
    if (!appThreadId) return;
    setError('');
    try {
      const history = (await db.chatMessages.where('threadId').equals(appThreadId).toArray())
        .sort((a, b) => a.timestamp - b.timestamp).slice(-12)
        .map((message) => `${message.role}: ${message.content}`).join('\n\n').slice(-32 * 1024);
      await useChatStore.getState().newChat({ mode, workspaceId: workspaceId ?? undefined,
        taskId: taskId ?? undefined, settingsTab: settingsTab ?? undefined, origin: 'codex' });
      const newId = useChatStore.getState().activeThreadId;
      if (!newId || newId === appThreadId) throw new Error('Could not create a new Codex chat');
      await codexSessionService.handoff(appThreadId, newId, history);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create handoff'); }
  }
  return <div style={{ padding: '6px 12px' }}>
    <p className="subtle">{t('codex.legacyReadable')}</p>
    <button type="button" onClick={() => void handoff()}>{t('codex.newHandoff')}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
