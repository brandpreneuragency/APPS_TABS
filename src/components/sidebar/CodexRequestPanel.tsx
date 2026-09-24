import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { codexSessionService } from '../../services/codex/sessionService';
import { useCodexService } from '../../services/codex/useCodexService';
import type { CodexPendingRecord, CodexRunRecord } from '../../services/codex/sessionTypes';

interface CodexQuestion {
  id: string;
  header: string;
  question: string;
  options?: { label: string; description: string }[];
  isOther: boolean;
  isSecret: boolean;
}

function questionsFromDetails(details: Record<string, unknown>): CodexQuestion[] {
  const raw = details.questions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return [];
  const questions: CodexQuestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== 'string' || !value.id || typeof value.header !== 'string'
      || typeof value.question !== 'string') return [];
    const options = value.options;
    if (options != null && (!Array.isArray(options) || options.some((option) => !option
      || typeof option !== 'object' || typeof option.label !== 'string'
      || typeof option.description !== 'string'))) return [];
    questions.push({ id: value.id, header: value.header, question: value.question,
      options: options == null ? undefined : options as CodexQuestion['options'],
      isOther: value.isOther === true, isSecret: value.isSecret === true });
  }
  if (new Set(questions.map((question) => question.id)).size !== questions.length) return [];
  return questions;
}

export function CodexRequestPanel({ appThreadId }: { appThreadId: string | null }) {
  const { t } = useTranslation();
  const snapshot = useCodexService();
  const [pending, setPending] = useState<CodexPendingRecord[]>([]);
  const [runs, setRuns] = useState<CodexRunRecord[]>([]);
  const [answersByRequest, setAnswersByRequest] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (!appThreadId) return;
    let cancelled = false;
    void Promise.all([codexSessionService.getPending(appThreadId), codexSessionService.getRuns(appThreadId)])
      .then(([requests, nextRuns]) => {
        if (!cancelled) { setPending(requests); setRuns(nextRuns); }
      });
    return () => { cancelled = true; };
  }, [appThreadId, snapshot]);
  if (!appThreadId) return null;
  // A recovery-required run blocks the queue, even when a newer run is waiting.
  const latest = runs.find((run) => run.status === 'recovery_required') ?? runs.at(-1);
  async function reply(request: CodexPendingRecord, accept: boolean) {
    setError('');
    try {
      if (request.request.kind === 'question') {
        const questions = questionsFromDetails(request.request.details);
        const answers: Record<string, string[]> = {};
        for (const question of questions) {
          const text = answersByRequest[request.requestId]?.[question.id]?.trim();
          if (!text) throw new Error(t('codex.answerEachQuestion'));
          answers[question.id] = [text];
        }
        if (!questions.length) throw new Error(t('codex.unsupportedQuestion'));
        await codexSessionService.reply(request.requestId, { kind: 'question', answers });
        setAnswersByRequest((current) => { const next = { ...current }; delete next[request.requestId]; return next; });
      } else if (request.request.kind === 'businessTool') {
        await codexSessionService.decideBusiness(request.requestId, accept);
      } else {
        await codexSessionService.reply(request.requestId, {
          kind: request.request.kind, decision: accept ? 'accept' : 'decline',
        });
      }
      setPending(await codexSessionService.getPending(appThreadId!));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not answer Codex request');
    }
  }
  return <div className="col gap-2" aria-live="polite" style={{ padding: '8px 12px' }}>
    {latest && <div className="subtle" role="status">{t('codex.runStatus')}: {latest.status}
      {latest.status === 'recovery_required' && <button type="button" onClick={() => void codexSessionService.reconcile(latest.runId)
        .then(() => codexSessionService.getRuns(appThreadId).then(setRuns))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Recovery failed'))}>
        {t('codex.reconcile')}
      </button>}
      {latest.status === 'recovery_required' && <button type="button" onClick={() => void codexSessionService.acknowledgeRecovery(latest.runId)
        .then(() => codexSessionService.getRuns(appThreadId).then(setRuns))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Recovery could not be set aside'))}>
        {t('codex.setAside')}
      </button>}
    </div>}
    {pending.map((row) => <div key={row.requestId} className="col gap-1" style={{ border: '1px solid var(--c-border-1)', padding: 10 }}>
      <strong>{row.request.kind === 'question' ? t('codex.question')
        : row.request.kind === 'businessTool' ? t('codex.businessProposal') : t('codex.approval')}</strong>
      {row.proposal && <div>
        <p>{row.proposal.summary}</p>
        <small>{t('codex.operationId')}: {row.proposal.operationId}</small>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflowY: 'auto' }}>
          {JSON.stringify({ before: row.proposal.before, after: row.proposal.after,
            expectedRevision: row.proposal.expectedRevision }, null, 2).slice(0, 12000)}
        </pre>
      </div>}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflowY: 'auto' }}>
        {JSON.stringify(row.request.details, null, 2).slice(0, 8000)}
      </pre>
      {row.decision && <p role="status">{t('codex.decisionSaved')}: {row.decision}</p>}
      {row.request.kind === 'question' ? <div className="col gap-2">
        {questionsFromDetails(row.request.details).map((question) => <label key={question.id} className="col gap-1">
          <span>{question.header}: {question.question}</span>
          {question.options?.length && !question.isOther ? <select aria-label={question.question}
            value={answersByRequest[row.requestId]?.[question.id] ?? ''}
            onChange={(event) => setAnswersByRequest((current) => ({ ...current,
              [row.requestId]: { ...current[row.requestId], [question.id]: event.target.value } }))}>
            <option value="">{t('codex.chooseAnswer')}</option>
            {question.options.map((option) => <option key={option.label} value={option.label}
              title={option.description}>{option.label}</option>)}
          </select> : <>
            <input type={question.isSecret ? 'password' : 'text'} aria-label={question.question}
              list={question.options?.length ? `codex-options-${row.requestId}-${question.id}` : undefined}
              value={answersByRequest[row.requestId]?.[question.id] ?? ''}
              onChange={(event) => setAnswersByRequest((current) => ({ ...current,
                [row.requestId]: { ...current[row.requestId], [question.id]: event.target.value } }))} />
            {question.options?.length ? <datalist id={`codex-options-${row.requestId}-${question.id}`}>
              {question.options.map((option) => <option key={option.label} value={option.label}>{option.description}</option>)}
            </datalist> : null}
          </>}
        </label>)}
        {!questionsFromDetails(row.request.details).length && <p role="alert">{t('codex.unsupportedQuestion')}</p>}
        <button type="button" disabled={!questionsFromDetails(row.request.details).length
          || questionsFromDetails(row.request.details).some((question) => !answersByRequest[row.requestId]?.[question.id]?.trim())}
          onClick={() => void reply(row, true)}>{t('codex.sendAnswer')}</button>
      </div> : <div className="row gap-2">
        <button type="button" disabled={row.decision === 'rejected' || (row.request.kind === 'businessTool' && !row.proposal)}
          onClick={() => void reply(row, true)}>{t('codex.approve')}</button>
        <button type="button" disabled={row.decision === 'approved' || (row.request.kind === 'businessTool' && !row.proposal)}
          onClick={() => void reply(row, false)}>{t('codex.decline')}</button>
      </div>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
