import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, GitBranch, RefreshCw, Settings2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isTauriRuntime } from '../../services/runtime';
import { publicGithubError } from '../../services/github/errors';
import { decodeBase64, encodeBase64 } from '../../services/github/binary';
import { exactCommitMessage, GITHUB_DOWNLOAD_BYTE_CAP } from '../../services/github/gitProtocol';
import { DEFAULT_GITHUB_PANEL, GITHUB_INLINE_BYTE_CAP, type CommitResult, type GithubDraft, type GithubEntry, type GithubPanelLayout, type GithubRepo, type RepoCreateForm, type RepoCreateResult, type RepoDeleteResult, type RepoDeleteSnapshot } from '../../services/github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useUIStore } from '../../stores/uiStore';
import { PrimaryWorkspaceContent } from '../layout/workspace/PrimaryWorkspaceContent';
import { AISidebar } from '../sidebar/AISidebar';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types';
import './github.css';

type GithubStoreHook = typeof useGithubStore;

interface GithubWorkspaceProps {
  /** Isolated store injection for fixture-backed UI acceptance tests. */
  store?: GithubStoreHook;
}

interface DirectoryListing {
  entries: GithubEntry[];
  complete: boolean;
}

interface CommitReview {
  accountId: string
  repoId: string
  ref: string
  expectedBaseSha: string
  commitId: string
  sentMessage: string
  draftVersions: Array<{ path: string; editVersion: number }>
}

interface TargetedValue<T> {
  targetKey: string | null;
  value: T;
}

const EMPTY_DRAFT_PATHS: Set<string> = new Set();

function listingKey(repoId: string, ref: string, path: string): string {
  return JSON.stringify([repoId, ref, path]);
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function imageMimeType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'ico': return 'image/x-icon';
    case 'png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

const EMPTY_OPEN_PATHS: string[] = [];
const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];

interface GithubAssistantNoticeProps {
  /** Isolated store injection for fixture-backed privacy and egress tests. */
  store?: GithubStoreHook;
}

export function GithubAssistantNotice({ store = useGithubStore }: GithubAssistantNoticeProps) {
  const { t } = useTranslation();
  const connection = store((state) => state.connection);
  const repos = store((state) => state.repos);
  const accountWorkspace = store((state) => state.accountWorkspace);
  const openedFile = store((state) => state.openedFile);
  const drafts = store((state) => state.drafts);
  const aiConsent = store((state) => state.aiConsent);
  const preparedAi = store((state) => state.preparedAi);
  const commitMessageSuggestion = store((state) => state.aiCommitMessage);
  const threads = useChatStore((state) => state.threads);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const messages = useChatStore((state) => state.activeThreadId
    ? state.messagesByThread[state.activeThreadId] ?? EMPTY_CHAT_MESSAGES
    : EMPTY_CHAT_MESSAGES);
  const [status, setStatus] = useState('');
  const [preparedAssistantIds, setPreparedAssistantIds] = useState<Set<string> | null>(null);
  const storeApi = store.getState;
  const activeRepoId = accountWorkspace?.activeRepoId ?? null;
  const activeRepo = repos.find((repo) => repo.id === activeRepoId) ?? null;
  const activeRef = activeRepoId ? accountWorkspace?.activeRefByRepo[activeRepoId] ?? activeRepo?.defaultBranch ?? '' : '';
  const accountId = connection.status === 'connected' ? connection.account.id : null;
  const target = activeRepo && activeRef ? `${activeRepo.ownerLogin}/${activeRepo.name} @ ${activeRef}` : '';
  const filePath = openedFile?.repoId === activeRepoId && openedFile.ref === activeRef ? openedFile.path : null;
  const currentDrafts = drafts.filter((draft) => draft.accountId === accountId && draft.repoId === activeRepoId && draft.ref === activeRef);
  const aiDraftPath = currentDrafts.find((draft) => draft.path === filePath)?.path ?? currentDrafts[0]?.path ?? null;
  const aiCommitDraftCount = currentDrafts.filter((draft) => !draft.binary && draft.operation !== 'delete').length;
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const contextId = accountId && activeRepoId && activeRef ? githubContextId(accountId, activeRepoId, activeRef) : null;
  const threadMatches = Boolean(contextId && activeThread?.workspaceId === contextId && !activeThread.taskId && !activeThread.settingsTab);
  const latestAssistant = threadMatches ? [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim()) : undefined;
  const freshAssistant = latestAssistant && preparedAssistantIds && !preparedAssistantIds.has(latestAssistant.id)
    ? latestAssistant
    : undefined;

  const beginPrepare = (purpose: 'review_file' | 'review_diff' | 'suggest_commit_message' | 'edit_draft') => {
    const chatState = useChatStore.getState();
    const existingAssistantIds = chatState.threads
      .filter((thread) => thread.workspaceId === contextId && !thread.taskId && !thread.settingsTab)
      .flatMap((thread) => (chatState.messagesByThread[thread.id] ?? [])
        .filter((message) => message.role === 'assistant')
        .map((message) => message.id));
    setPreparedAssistantIds(new Set([...existingAssistantIds, ...messages.filter((message) => message.role === 'assistant').map((message) => message.id)]));
    storeApi().clearPreparedAi();
    void prepare(purpose);
  };

  const prepare = async (purpose: 'review_file' | 'review_diff' | 'suggest_commit_message' | 'edit_draft') => {
    setStatus('');
    try {
      const path = purpose === 'review_file' || purpose === 'edit_draft' ? filePath ?? undefined
        : purpose === 'review_diff' || purpose === 'suggest_commit_message' ? aiDraftPath ?? undefined
          : undefined;
      const prepared = await storeApi().prepareAi(purpose, path);
      if (!prepared) setStatus(t('github.aiSelectRepo'));
      else if (prepared.blocked) setStatus(prepared.warning);
    } catch (error) {
      setStatus(publicGithubError(error).message);
    }
  };

  const applyAiResponse = async () => {
    if (!freshAssistant || !preparedAi?.proposalId || !target || !filePath || typeof window === 'undefined') return;
    const exactTarget = `${target} · ${filePath}`;
    if (!window.confirm(t('github.confirmAiApply', { target: exactTarget }))) return;
    try {
      await storeApi().applyAiDraft({ confirm: true, proposalId: preparedAi.proposalId, text: freshAssistant.content });
      setStatus(t('github.aiDraftApplied'));
    } catch (error) {
      setStatus(publicGithubError(error).message);
    }
  };

  return (
    <section className="github-ai-notice" aria-labelledby="github-ai-notice-title">
      <h2 id="github-ai-notice-title">{t('github.aiUnavailableTitle')}</h2>
      {!target ? <p>{t('github.aiSelectRepo')}</p> : (
        <>
          <p className="github-ai-target" title={target}>{target}</p>
          <p className="github-ai-context">{t('github.aiCurrentContext', { context: preparedAi?.purpose === 'review_diff'
            ? t('github.aiDiffContext', { path: aiDraftPath ?? t('github.aiNoFile') })
            : preparedAi?.purpose === 'suggest_commit_message'
              ? t('github.aiCommitContext', { count: aiCommitDraftCount })
              : filePath ?? t('github.aiNoFile') })}</p>
          {activeRepo?.private ? (
            <label className="github-ai-consent">
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={(event) => {
                  const action = event.currentTarget.checked ? storeApi().grantAiConsent : storeApi().revokeAiConsent;
                  void action().catch((error: unknown) => setStatus(publicGithubError(error).message));
                }}
                disabled={!accountId}
              />
              <span>{t('github.aiPrivateConsent', { repo: target.split(' @ ')[0] })}</span>
            </label>
          ) : <p>{t('github.aiPublicNotice')}</p>}
          <p className="github-ai-warning" role="note">{t('github.aiRecallWarning')}</p>
          {activeRepo?.private && !aiConsent && <p className="github-ai-status" role="status">{t('github.aiPrivateBlocked')}</p>}
          <div className="github-ai-actions" role="group" aria-label={t('github.aiActions')}>
            <button type="button" onClick={() => beginPrepare('review_file')} disabled={!filePath || (activeRepo?.private === true && !aiConsent)}>{t('github.aiReviewFile')}</button>
            <button type="button" onClick={() => beginPrepare('review_diff')} disabled={!aiDraftPath || (activeRepo?.private === true && !aiConsent)}>{t('github.aiReviewDiff')}</button>
            <button type="button" onClick={() => beginPrepare('suggest_commit_message')} disabled={aiCommitDraftCount === 0 || (activeRepo?.private === true && !aiConsent)}>{t('github.aiSuggestCommit')}</button>
            <button type="button" onClick={() => beginPrepare('edit_draft')} disabled={!filePath || !currentDrafts.some((draft) => draft.path === filePath) || (activeRepo?.private === true && !aiConsent)}>{t('github.aiEditDraft')}</button>
          </div>
          {preparedAi?.blocked && <p className="github-ai-status" role="alert">{status || preparedAi.warning}</p>}
          {!preparedAi?.blocked && status && <p className="github-ai-status" role="status">{status}</p>}
          {freshAssistant && preparedAi?.purpose === 'suggest_commit_message' && (
            <button type="button" className="github-secondary-button" onClick={() => {
              storeApi().setAiCommitMessage(freshAssistant.content.trim());
              setStatus(t('github.aiCommitSuggestionReady'));
            }}>{t('github.aiUseCommitSuggestion')}</button>
          )}
          {freshAssistant && preparedAi?.purpose === 'edit_draft' && preparedAi.proposalId && (
            <button type="button" className="github-secondary-button" onClick={() => void applyAiResponse()}>{t('github.aiApplyDraft')}</button>
          )}
          {commitMessageSuggestion && <p className="github-ai-status" role="status">{t('github.aiCommitSuggestionReady')}</p>}
        </>
      )}
    </section>
  );
}

export function GithubAssistantSidebar() {
  const connection = useGithubStore((state) => state.connection);
  const accountWorkspace = useGithubStore((state) => state.accountWorkspace);
  const repos = useGithubStore((state) => state.repos);
  const repoId = accountWorkspace?.activeRepoId ?? null;
  const repo = repos.find((item) => item.id === repoId);
  const ref = repoId ? accountWorkspace?.activeRefByRepo[repoId] ?? repo?.defaultBranch ?? '' : '';
  const accountId = connection.status === 'connected' ? connection.account.id : null;
  const workspaceId = accountId && repoId && ref ? githubContextId(accountId, repoId, ref) : null;
  if (!workspaceId) return null;
  return <AISidebar workspaceId={workspaceId} mode="writer" taskId={null} settingsTab={null} editor={null} githubMode />;
}

function githubContextId(accountId: string, repoId: string, ref: string): string {
  return `github:${accountId}:${repoId}:${encodeURIComponent(ref)}`;
}

export function GithubWorkspace({ store = useGithubStore }: GithubWorkspaceProps) {
  const { t } = useTranslation();
  const desktop = isTauriRuntime();
  const connection = store((state) => state.connection);
  const repos = store((state) => state.repos);
  const reposComplete = store((state) => state.reposComplete);
  const branches = store((state) => state.branches);
  const openedFile = store((state) => state.openedFile);
  const accountWorkspace = store((state) => state.accountWorkspace);
  const branchWorkspace = store((state) => state.branchWorkspace);
  const lastError = store((state) => state.lastError);
  const busy = store((state) => state.busy);
  const drafts = store((state) => state.drafts);
  const remote = store((state) => state.remote);
  const search = store((state) => state.search);
  const history = store((state) => state.history);
  const commitDetail = store((state) => state.commitDetail);
  const commitResult = store((state) => state.commitResult);
  const repoTemplates = store((state) => state.repoTemplates);
  const commitMessageSuggestion = store((state) => state.aiCommitMessage);
  const contextPanelOpen = useUIStore((state) => state.contextPanelOpenByMode.github);
  const contextPanelWidthVw = useUIStore((state) => state.contextPanelWidth);

  const [initialized, setInitialized] = useState(false);
  const [clientId, setClientId] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [finishingSignIn, setFinishingSignIn] = useState(false);
  const [selectingRepo, setSelectingRepo] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [directoryListings, setDirectoryListings] = useState<Record<string, DirectoryListing>>({});
  const [editorBuffer, setEditorBuffer] = useState<{ fileKey: string | null; text: string }>({ fileKey: null, text: '' });
  const [savingDraft, setSavingDraft] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [draftSelection, setDraftSelection] = useState<TargetedValue<Set<string>>>({ targetKey: null, value: new Set() });
  const [searchState, setSearchState] = useState<TargetedValue<string>>({ targetKey: null, value: '' });
  const [newPath, setNewPath] = useState('');
  const [newText, setNewText] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [explicitGitkeep, setExplicitGitkeep] = useState(false);
  const [renamePath, setRenamePath] = useState('');
  const [conflictDestinations, setConflictDestinations] = useState<Record<string, string>>({});
  const [customConflictText, setCustomConflictText] = useState<Record<string, string>>({});
  const [commitMessageState, setCommitMessageState] = useState<TargetedValue<string | null>>({ targetKey: null, value: null });
  const [commitReviewState, setCommitReviewState] = useState<TargetedValue<CommitReview | null>>({ targetKey: null, value: null });
  const [downloadUrl, setDownloadUrl] = useState<{ path: string; url: string; mediaKind: string } | null>(null);
  const [transientPanelWidth, setTransientPanelWidth] = useState<{ targetKey: string; widthPx: number } | null>(null);
  const [localStatus, setLocalStatus] = useState('');
  const [lastRemoteCheck, setLastRemoteCheck] = useState<TargetedValue<number | null>>({ targetKey: null, value: null });
  const [repoManagementOpen, setRepoManagementOpen] = useState(false);
  const [repoManagementView, setRepoManagementView] = useState<'create' | 'delete'>('create');
  const [repoManagementBusy, setRepoManagementBusy] = useState(false);
  const [repoManagementMessage, setRepoManagementMessage] = useState('');
  const [repoManagementError, setRepoManagementError] = useState('');
  const [repoCreateForm, setRepoCreateForm] = useState<RepoCreateForm>({
    name: '', description: '', visibility: 'private', readme: false, gitignoreTemplate: null, licenseTemplate: null,
  });
  const [repoCreateReview, setRepoCreateReview] = useState<{ form: RepoCreateForm; accountId: string; ownerLogin: string } | null>(null);
  const [repoCreateResult, setRepoCreateResult] = useState<RepoCreateResult | null>(null);
  const [repoDeleteRepoId, setRepoDeleteRepoId] = useState('');
  const [repoDeleteSnapshot, setRepoDeleteSnapshot] = useState<RepoDeleteSnapshot | null>(null);
  const [repoDeleteName, setRepoDeleteName] = useState('');
  const [repoDeleteReview, setRepoDeleteReview] = useState<{ snapshot: RepoDeleteSnapshot; typedOwnerRepo: string } | null>(null);
  const [repoDeleteResult, setRepoDeleteResult] = useState<RepoDeleteResult | null>(null);
  const [scopeElevationRepoId, setScopeElevationRepoId] = useState<string | null>(null);
  const [deviceLoginStatus, setDeviceLoginStatus] = useState('');
  const repoManagementLock = useRef(false);

  const activeRepoId = accountWorkspace?.activeRepoId ?? null;
  const activeRepo = repos.find((repo) => repo.id === activeRepoId) ?? null;
  const activeRef = activeRepoId
    ? accountWorkspace?.activeRefByRepo[activeRepoId] ?? activeRepo?.defaultBranch ?? ''
    : '';
  const currentBranchWorkspace = branchWorkspace?.repoId === activeRepoId && branchWorkspace.ref === activeRef
    ? branchWorkspace
    : null;
  const openPaths = currentBranchWorkspace?.openPaths ?? EMPTY_OPEN_PATHS;
  const selectedPath = currentBranchWorkspace?.selectedPath ?? null;
  const activeFileBase = openedFile
    && openedFile.repoId === activeRepoId
    && openedFile.ref === activeRef
    && openPaths.includes(openedFile.path)
    ? openedFile
    : null;
  const currentOpenedDraft = activeFileBase ? drafts.find((draft) => draft.repoId === activeFileBase.repoId && draft.ref === activeFileBase.ref && draft.path === activeFileBase.path) ?? null : null;
  const activeFile = useMemo(() => activeFileBase ? {
    ...activeFileBase,
    draft: currentOpenedDraft,
    text: currentOpenedDraft?.newText ?? activeFileBase.text,
    binaryBase64: currentOpenedDraft?.newBinary ?? activeFileBase.binaryBase64,
  } : null, [activeFileBase, currentOpenedDraft]);
  const activeFileKey = activeFile
    ? JSON.stringify([activeFile.accountId, activeFile.repoId, activeFile.ref, activeFile.path, activeFile.draft?.editVersion ?? 0, activeFile.remoteBlobSha])
    : null;
  const sourceText = activeFile && editorBuffer.fileKey === activeFileKey ? editorBuffer.text : activeFile?.text ?? '';
  const hasUnsavedEdits = activeFile?.kind === 'text' && sourceText !== (activeFile.text ?? '');
  const activePanelTargetKey = activeRepoId && activeRef ? listingKey(activeRepoId, activeRef, '@panel') : null;
  const selectedDraftPaths = draftSelection.targetKey === activePanelTargetKey ? draftSelection.value : EMPTY_DRAFT_PATHS;
  const searchQuery = searchState.targetKey === activePanelTargetKey ? searchState.value : '';
  const commitMessage = activePanelTargetKey
    ? commitMessageState.targetKey === activePanelTargetKey
      ? commitMessageState.value ?? commitMessageSuggestion ?? ''
      : commitMessageSuggestion ?? ''
    : '';
  const commitReview = activePanelTargetKey && commitReviewState.targetKey === activePanelTargetKey ? commitReviewState.value : null;
  const setSelectedDraftPaths = useCallback((action: SetStateAction<Set<string>>) => {
    setDraftSelection((previous) => {
      const current = previous.targetKey === activePanelTargetKey ? previous.value : EMPTY_DRAFT_PATHS;
      return { targetKey: activePanelTargetKey, value: typeof action === 'function' ? action(current) : action };
    });
  }, [activePanelTargetKey]);
  const setSearchQuery = useCallback((value: string) => {
    setSearchState({ targetKey: activePanelTargetKey, value });
  }, [activePanelTargetKey]);
  const setCommitMessage = useCallback((value: string | null) => {
    setCommitMessageState({ targetKey: activePanelTargetKey, value });
  }, [activePanelTargetKey]);
  const setCommitReview = useCallback((value: CommitReview | null) => {
    setCommitReviewState({ targetKey: activePanelTargetKey, value });
  }, [activePanelTargetKey]);
  const panel: GithubPanelLayout = currentBranchWorkspace?.panel ?? DEFAULT_GITHUB_PANEL;
  const accountId = connection.status === 'connected' ? connection.account.id : null;
  const activeDrafts = drafts.filter((draft) => draft.accountId === accountId && draft.repoId === activeRepoId && draft.ref === activeRef);
  const selectedDrafts = activeDrafts.filter((draft) => selectedDraftPaths.has(draft.path));
  const selectedHasUnresolvedConflict = selectedDrafts.some((draft) => draft.conflict && !draft.conflict.resolved);
  const activeRemote = remote?.repoId === activeRepoId && remote.ref === activeRef ? remote : null;
  const visibleBaseShas = new Set((selectedDrafts.length > 0 ? selectedDrafts : activeDrafts).map((draft) => draft.baseCommitSha));
  const visibleBaseLabel = visibleBaseShas.size > 1
    ? t('github.mixedBases')
    : [...visibleBaseShas][0]?.slice(0, 8) ?? t('github.noBase');
  const statusTargetKey = activeRepoId && activeRef ? listingKey(activeRepoId, activeRef, '@status') : null;
  const activeLastRemoteCheck = statusTargetKey && lastRemoteCheck.targetKey === statusTargetKey ? lastRemoteCheck.value : null;
  const selectedDeleteRepo = repos.find((repo) => repo.id === repoDeleteRepoId) ?? null;
  const deleteSnapshotCurrent = Boolean(repoDeleteSnapshot && repoDeleteSnapshot.repoId === repoDeleteRepoId
    && connection.status === 'connected' && repoDeleteSnapshot.accountId === connection.account.id);
  const deleteScopeGranted = Boolean(deleteSnapshotCurrent && repoDeleteSnapshot?.grantedScopes.includes('delete_repo'));
  const canReviewRepoDelete = Boolean(deleteSnapshotCurrent && deleteScopeGranted && repoDeleteSnapshot?.permission === 'admin'
    && repoDeleteName === repoDeleteSnapshot?.fullName && !repoManagementBusy);

  const unsavedRef = useRef(false);
  unsavedRef.current = hasUnsavedEdits;
  const currentTargetRef = useRef<{ repoId: string; ref: string } | null>(null);
  currentTargetRef.current = activeRepo && activeRef ? { repoId: activeRepo.id, ref: activeRef } : null;
  const discardMessageRef = useRef('');
  discardMessageRef.current = t('github.confirmCloseUnsaved');

  const localizedGithubError = useCallback((error: unknown) => {
    const { code } = publicGithubError(error);
    switch (code) {
      case 'auth_expired': return t('github.authExpired');
      case 'forbidden':
      case 'access_denied':
      case 'insufficient_scope': return t('github.permissionDenied');
      case 'not_found': return t('github.targetNotFound');
      case 'personal_account_required': return t('github.personalAccountOnly');
      case 'organization_rejected': return t('github.organizationNotSupported');
      case 'rate_limited': return t('github.rateLimited');
      case 'timeout': return t('github.requestTimedOut');
      case 'ambiguous_write': return t('github.writeUncertain');
      case 'stale_target':
      case 'target_mismatch': return t('github.targetChanged');
      case 'signed_out': return t('github.signedOut');
      case 'needs_setup': return t('github.setupHint');
      case 'native_unavailable': return t('github.nativeUnavailable');
      case 'native_http_not_linked': return t('github.nativeHttpNotLinked');
      case 'device_flow_disabled': return t('github.enableDeviceFlow');
      default: return t('github.errorUnexpected');
    }
  }, [t]);

  const repoCreateOutcomeMessage = useCallback((result: RepoCreateResult) => {
    switch (result.status) {
      case 'created': return t('github.repoCreateStatus.created');
      case 'ambiguous': return t('github.repoCreateStatus.ambiguous');
      case 'not_applied': return t('github.repoCreateStatus.not_applied');
      case 'blocked': return localizedGithubError({ code: result.code, message: result.message });
      case 'stale_target': return t('github.repoCreateStatus.stale_target');
      case 'mismatch': return t('github.repoCreateStatus.mismatch');
    }
  }, [localizedGithubError, t]);

  const repoDeleteOutcomeMessage = useCallback((result: RepoDeleteResult) => {
    switch (result.status) {
      case 'deleted': return t('github.repoDeleteStatus.deleted');
      case 'uncertain': return t('github.repoDeleteStatus.uncertain');
      case 'blocked': return localizedGithubError({ code: result.code, message: result.message });
      case 'needs_scope': return t('github.repoDeleteStatus.needs_scope');
      case 'mismatch': return t('github.repoDeleteStatus.mismatch');
    }
  }, [localizedGithubError, t]);

  const commitOutcomeMessage = useCallback((result: CommitResult) => {
    switch (result.status) {
      case 'sent': return result.protocol === 'contents_bootstrap'
        ? t('github.singleFileBootstrapSent')
        : t('github.commitSent', { sha: result.commitSha.slice(0, 8) });
      case 'blocked': return localizedGithubError({ code: result.code, message: result.message });
      case 'conflict': return t('github.commitConflictResult');
      case 'protected_branch': return t('github.protectedBranchBlocked');
      case 'ambiguous': return t('github.commitUncertain');
      case 'not_applied': return t('github.commitNotApplied');
      case 'stale_target': return t('github.commitTargetChanged');
    }
  }, [localizedGithubError, t]);

  const reportError = useCallback((error: unknown) => {
    const safe = publicGithubError(error);
    store.setState({ lastError: { code: safe.code, message: localizedGithubError(error) } });
  }, [localizedGithubError, store]);

  const confirmDiscard = useCallback(() => {
    if (!unsavedRef.current) return true;
    if (typeof window === 'undefined' || !window.confirm(discardMessageRef.current)) return false;
    unsavedRef.current = false;
    return true;
  }, []);

  const openRepository = useCallback(async (repoId: string, requestedRef?: string): Promise<boolean> => {
    const state = store.getState();
    const repo = state.repos.find((item) => item.id === repoId);
    if (!repo) return false;
    const ref = requestedRef ?? state.accountWorkspace?.activeRefByRepo[repoId] ?? repo.defaultBranch;
    const current = currentTargetRef.current;
    if (current && (current.repoId !== repoId || current.ref !== ref) && !confirmDiscard()) return false;
    if (current && (current.repoId !== repoId || current.ref !== ref)) setEditorBuffer({ fileKey: null, text: '' });

    setSelectingRepo(true);
    setLocalStatus('');
    setExpandedDirectories(new Set());
    try {
      await state.selectBranch(repoId, ref);
      await store.getState().browse('');
      try {
        await store.getState().refreshRemote();
        setLastRemoteCheck({ targetKey: listingKey(repoId, ref, '@status'), value: Date.now() });
      } catch (error) {
        reportError(error);
      }
      const refreshed = store.getState();
      const rootKey = listingKey(repoId, ref, '');
      setDirectoryListings((previous) => ({
        ...previous,
        [rootKey]: { entries: refreshed.entries, complete: refreshed.entriesComplete },
      }));
      const workspace = refreshed.branchWorkspace;
      const selected = workspace?.selectedPath && workspace.openPaths.includes(workspace.selectedPath)
        ? workspace.selectedPath
        : workspace?.openPaths.at(-1);
      if (selected) await store.getState().openDraftPath(selected);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    } finally {
      setSelectingRepo(false);
    }
  }, [confirmDiscard, reportError, store]);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void (async () => {
      try {
        await store.getState().restore();
        if (!current) return;
        if (store.getState().connection.status === 'connected') {
          await store.getState().refreshRepos();
          if (!current) return;
          const workspace = store.getState().accountWorkspace;
          if (workspace?.activeRepoId) {
            await openRepository(workspace.activeRepoId, workspace.activeRefByRepo[workspace.activeRepoId]);
          }
        }
      } catch (error) {
        if (current) reportError(error);
      } finally {
        if (current) setInitialized(true);
      }
    })();
    return () => {
      current = false;
      store.getState().cancelActive();
      if (store.getState().connection.status === 'authorizing') store.getState().cancelSignIn();
    };
  }, [desktop, openRepository, reportError, store]);


  const repoTabs = useMemo(() => (accountWorkspace?.openRepoIds ?? []).flatMap((repoId) => {
    const repo = repos.find((item) => item.id === repoId);
    return repo ? [repo] : [];
  }), [accountWorkspace?.openRepoIds, repos]);

  const filteredRepos = useMemo(() => {
    const query = repoSearch.trim().toLocaleLowerCase();
    return query
      ? repos.filter((repo) => `${repo.ownerLogin}/${repo.name}`.toLocaleLowerCase().includes(query))
      : repos;
  }, [repoSearch, repos]);

  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl.url);
  }, [downloadUrl]);

  const updatePanel = useCallback((next: Partial<GithubPanelLayout>) => {
    void store.getState().setPanel({ ...(store.getState().branchWorkspace?.panel ?? DEFAULT_GITHUB_PANEL), ...next }).catch(reportError);
  }, [reportError, store]);

  const setPanelWidth = useCallback((widthPx: number, persist: boolean) => {
    if (!activePanelTargetKey) return;
    setTransientPanelWidth({ targetKey: activePanelTargetKey, widthPx });
    if (!persist) return;
    const panel = store.getState().branchWorkspace?.panel ?? DEFAULT_GITHUB_PANEL;
    void store.getState().setPanel({ ...panel, navWidthPx: Math.round(widthPx) }).catch(reportError);
  }, [activePanelTargetKey, reportError, store]);

  const loadDirectory = useCallback(async (path: string) => {
    if (!activeRepo || !activeRef) return;
    const key = listingKey(activeRepo.id, activeRef, path);
    setLoadingDirectories((previous) => new Set(previous).add(key));
    try {
      await store.getState().browse(path);
      const result = store.getState();
      setDirectoryListings((previous) => ({
        ...previous,
        [key]: { entries: result.entries, complete: result.entriesComplete },
      }));
    } catch (error) {
      reportError(error);
    } finally {
      setLoadingDirectories((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }, [activeRepo, activeRef, reportError, store]);

  const toggleDirectory = useCallback((path: string) => {
    if (!activeRepo || !activeRef) return;
    const key = listingKey(activeRepo.id, activeRef, path);
    if (expandedDirectories.has(key)) {
      setExpandedDirectories((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
      return;
    }
    setExpandedDirectories((previous) => new Set(previous).add(key));
    if (!directoryListings[key] && !loadingDirectories.has(key)) void loadDirectory(path);
  }, [activeRepo, activeRef, directoryListings, expandedDirectories, loadDirectory, loadingDirectories]);

  const openFile = useCallback(async (path: string) => {
    if (activeFile?.path !== path && !confirmDiscard()) return;
    if (activeFile?.path !== path) setEditorBuffer({ fileKey: null, text: '' });
    setLocalStatus('');
    try {
      await store.getState().openDraftPath(path);
      setRenamePath(path);
    } catch (error) {
      reportError(error);
    }
  }, [activeFile?.path, confirmDiscard, reportError, store]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setLocalStatus('');
    try {
      if (hasUnsavedEdits) {
        if (new TextEncoder().encode(sourceText).byteLength > GITHUB_INLINE_BYTE_CAP) throw new Error(t('github.textDraftTooLarge'));
        await store.getState().saveOpenedDraft({ text: sourceText });
      }
      await store.getState().refreshRepos();
      const state = store.getState();
      const repoId = state.accountWorkspace?.activeRepoId;
      const ref = repoId ? state.accountWorkspace?.activeRefByRepo[repoId] : undefined;
      if (repoId && ref) {
        await state.refreshRemote();
        setLastRemoteCheck({ targetKey: listingKey(repoId, ref, '@status'), value: Date.now() });
        await state.browse('');
        const result = store.getState();
        setDirectoryListings((previous) => ({
          ...previous,
          [listingKey(repoId, ref, '')]: { entries: result.entries, complete: result.entriesComplete },
        }));
      }
      if (hasUnsavedEdits) setLocalStatus(t('github.refreshSavedLocalDraft'));
    } catch (error) {
      reportError(error);
    } finally {
      setRefreshing(false);
    }
  }, [hasUnsavedEdits, reportError, sourceText, store, t]);

  const handleConfigureClientId = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConfiguring(true);
    try {
      await store.getState().configureClientId(clientId);
      setClientId('');
    } catch (error) {
      reportError(error);
    } finally {
      setConfiguring(false);
    }
  }, [clientId, reportError, store]);

  const handleBeginSignIn = useCallback(async () => {
    setScopeElevationRepoId(null);
    setDeviceLoginStatus('');
    try {
      await store.getState().beginDeviceBrowserSignIn();
    } catch (error) {
      reportError(error);
    }
  }, [reportError, store]);

  const handleFinishSignIn = useCallback(async () => {
    setFinishingSignIn(true);
    try {
      await store.getState().finishDeviceBrowserSignIn();
      await store.getState().refreshRepos();
      const workspace = store.getState().accountWorkspace;
      if (workspace?.activeRepoId) {
        await openRepository(workspace.activeRepoId, workspace.activeRefByRepo[workspace.activeRepoId]);
      }
      if (scopeElevationRepoId) {
        const snapshot = await store.getState().captureDeleteSnapshot(scopeElevationRepoId);
        setRepoDeleteSnapshot(snapshot);
        setRepoDeleteName('');
        setRepoDeleteResult(null);
        setRepoManagementMessage(t('github.deleteScopeRefreshed', { target: snapshot.fullName }));
        setScopeElevationRepoId(null);
      }
    } catch (error) {
      if (publicGithubError(error).code !== 'cancelled') reportError(error);
    } finally {
      setFinishingSignIn(false);
    }
  }, [openRepository, reportError, scopeElevationRepoId, store, t]);

  const handleOpenDeviceLogin = useCallback(async () => {
    setDeviceLoginStatus('');
    try {
      const result = await store.getState().openDeviceLogin();
      setDeviceLoginStatus(t(result.opened ? 'github.devicePageOpened' : 'github.devicePageUnavailable'));
    } catch (error) {
      reportError(error);
    }
  }, [reportError, store, t]);

  const openRepoManagement = useCallback(() => {
    setRepoManagementOpen(true);
    setRepoManagementView('create');
    setRepoCreateReview(null);
    setRepoDeleteReview(null);
    setRepoManagementMessage('');
    setRepoManagementError('');
    if (!repoTemplates) {
      if (repoManagementLock.current) return;
      repoManagementLock.current = true;
      setRepoManagementBusy(true);
      void store.getState().listRepoTemplates()
        .catch((error: unknown) => {
          const message = localizedGithubError(error);
          setRepoManagementError(message);
          reportError(error);
        })
        .finally(() => {
          repoManagementLock.current = false;
          setRepoManagementBusy(false);
        });
    }
  }, [localizedGithubError, repoTemplates, reportError, store]);

  const closeRepoManagement = useCallback(() => {
    if (repoManagementBusy) return;
    setRepoManagementOpen(false);
    setRepoCreateReview(null);
    setRepoDeleteReview(null);
    setRepoDeleteSnapshot(null);
    setRepoDeleteName('');
    setRepoManagementError('');
  }, [repoManagementBusy]);

  const handleRepoManagementKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || repoManagementBusy) return;
    event.preventDefault();
    if (repoCreateReview) setRepoCreateReview(null);
    else if (repoDeleteReview) setRepoDeleteReview(null);
    else closeRepoManagement();
  }, [closeRepoManagement, repoCreateReview, repoDeleteReview, repoManagementBusy]);

  const switchRepoManagementView = useCallback((view: 'create' | 'delete') => {
    setRepoManagementView(view);
    setRepoCreateReview(null);
    setRepoDeleteReview(null);
    setRepoManagementMessage('');
    setRepoManagementError('');
    if (view === 'delete') {
      setRepoDeleteRepoId('');
      setRepoDeleteSnapshot(null);
      setRepoDeleteName('');
      setRepoDeleteResult(null);
    } else {
      setRepoCreateResult(null);
    }
  }, []);

  const handleReviewRepoCreate = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (repoManagementLock.current || connection.status !== 'connected') return;
    const form = { ...repoCreateForm, name: repoCreateForm.name.trim(), description: repoCreateForm.description?.trim() ?? '' };
    if (!form.name) return;
    setRepoCreateResult(null);
    setRepoManagementMessage('');
    setRepoManagementError('');
    setRepoCreateReview({ form, accountId: connection.account.id, ownerLogin: connection.account.login });
  }, [connection, repoCreateForm]);

  const handleConfirmRepoCreate = useCallback(async () => {
    if (!repoCreateReview || repoManagementLock.current) return;
    repoManagementLock.current = true;
    setRepoManagementBusy(true);
    setRepoManagementError('');
    try {
      const result = await store.getState().createRepository({
        form: repoCreateReview.form,
        confirmation: {
          confirm: true,
          accountId: repoCreateReview.accountId,
          ownerLogin: repoCreateReview.ownerLogin,
          repoName: repoCreateReview.form.name,
          aiDerived: false,
        },
      });
      setRepoCreateResult(result);
      setRepoManagementMessage(repoCreateOutcomeMessage(result));
      setRepoCreateReview(null);
      const current = store.getState().connection;
      if (result.status === 'created' && current.status === 'connected' && current.account.id === repoCreateReview.accountId) {
        try {
          await store.getState().refreshRepos();
        } catch (error) {
          reportError(error);
        }
      }
    } catch (error) {
      const message = publicGithubError(error).message;
      setRepoManagementError(message);
      reportError(error);
    } finally {
      repoManagementLock.current = false;
      setRepoManagementBusy(false);
    }
  }, [localizedGithubError, repoCreateOutcomeMessage, repoCreateReview, reportError, store]);

  const handleCaptureDeleteSnapshot = useCallback(async () => {
    if (!repoDeleteRepoId || repoManagementLock.current) return;
    repoManagementLock.current = true;
    setRepoManagementBusy(true);
    setRepoDeleteSnapshot(null);
    setRepoDeleteName('');
    setRepoDeleteResult(null);
    setRepoManagementError('');
    setRepoManagementMessage('');
    try {
      const snapshot = await store.getState().captureDeleteSnapshot(repoDeleteRepoId);
      setRepoDeleteSnapshot(snapshot);
      setRepoManagementMessage(t('github.deleteTargetVerified', { target: snapshot.fullName }));
    } catch (error) {
      const message = localizedGithubError(error);
      setRepoManagementError(message);
      reportError(error);
    } finally {
      repoManagementLock.current = false;
      setRepoManagementBusy(false);
    }
  }, [localizedGithubError, repoDeleteRepoId, reportError, store, t]);

  const handleBeginDeleteScopeElevation = useCallback(async () => {
    if (!repoDeleteSnapshot || repoManagementLock.current) return;
    repoManagementLock.current = true;
    setRepoManagementBusy(true);
    setRepoManagementError('');
    setScopeElevationRepoId(repoDeleteSnapshot.repoId);
    try {
      await store.getState().beginDeleteScopeElevation();
      setDeviceLoginStatus('');
    } catch (error) {
      setScopeElevationRepoId(null);
      const message = localizedGithubError(error);
      setRepoManagementError(message);
      reportError(error);
    } finally {
      repoManagementLock.current = false;
      setRepoManagementBusy(false);
    }
  }, [localizedGithubError, repoDeleteSnapshot, reportError, store]);

  const handleReviewRepoDelete = useCallback(() => {
    if (!repoDeleteSnapshot || repoDeleteName !== repoDeleteSnapshot.fullName || repoDeleteSnapshot.permission !== 'admin'
      || !repoDeleteSnapshot.grantedScopes.includes('delete_repo') || repoManagementLock.current) return;
    setRepoDeleteReview({ snapshot: repoDeleteSnapshot, typedOwnerRepo: repoDeleteName });
    setRepoDeleteResult(null);
    setRepoManagementMessage('');
    setRepoManagementError('');
  }, [repoDeleteName, repoDeleteSnapshot]);

  const handleConfirmRepoDelete = useCallback(async () => {
    if (!repoDeleteReview || repoManagementLock.current) return;
    repoManagementLock.current = true;
    setRepoManagementBusy(true);
    setRepoManagementError('');
    try {
      const result = await store.getState().deleteRepository({
        confirm: true,
        typedOwnerRepo: repoDeleteReview.typedOwnerRepo,
        snapshot: repoDeleteReview.snapshot,
        aiDerived: false,
      });
      setRepoDeleteResult(result);
      setRepoManagementMessage(repoDeleteOutcomeMessage(result));
      setRepoDeleteReview(null);
      if (result.status === 'deleted') {
        await store.getState().dismissLocalRepo(result.repoId);
        try {
          await store.getState().refreshRepos();
        } catch (error) {
          reportError(error);
        }
      }
    } catch (error) {
      const message = publicGithubError(error).message;
      setRepoManagementError(message);
      reportError(error);
    } finally {
      repoManagementLock.current = false;
      setRepoManagementBusy(false);
    }
  }, [localizedGithubError, repoDeleteOutcomeMessage, repoDeleteReview, reportError, store]);

  const handleSaveDraft = useCallback(async () => {
    if (!activeFile || activeFile.kind !== 'text' || !hasUnsavedEdits) return;
    setSavingDraft(true);
    try {
      if (new TextEncoder().encode(sourceText).byteLength > GITHUB_INLINE_BYTE_CAP) throw new Error(t('github.textDraftTooLarge'));
      await store.getState().saveOpenedDraft({ text: sourceText });
    } catch (error) {
      reportError(error);
    } finally {
      setSavingDraft(false);
    }
  }, [activeFile, hasUnsavedEdits, reportError, sourceText, store, t]);

  const baseCommitForNewDraft = useCallback(() => activeRemote?.remoteCommitSha ?? activeDrafts[0]?.baseCommitSha ?? '', [activeDrafts, activeRemote]);

  const handleCreateFile = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRepo || !activeRef || !accountId || !newPath.trim()) return;
    setActionBusy(true);
    try {
      const path = newPath.trim();
      if (new TextEncoder().encode(newText).byteLength > GITHUB_INLINE_BYTE_CAP) throw new Error(t('github.textDraftTooLarge'));
      if (activeDrafts.some((draft) => draft.path === path || draft.newPath === path)) throw new Error(t('github.draftPathExists', { path }));
      await store.getState().saveDraft({
        repoId: activeRepo.id,
        ref: activeRef,
        path,
        baseCommitSha: baseCommitForNewDraft(),
        baseBlobSha: null,
        originalText: null,
        originalBinary: null,
        newText,
        binary: false,
        operation: 'add',
      });
      await store.getState().openDraftPath(path);
      setNewPath('');
      setNewText('');
      setSelectedDraftPaths((previous) => new Set(previous).add(path));
      setLocalStatus(t('github.fileAddedToDrafts', { path }));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [accountId, activeDrafts, activeRef, activeRepo, baseCommitForNewDraft, newPath, newText, reportError, setSelectedDraftPaths, store, t]);

  const handleCreateFolder = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRepo || !activeRef || !folderPath.trim()) return;
    setActionBusy(true);
    try {
      const path = folderPath.trim().replace(/\/+$/, '');
      await store.getState().stageDirectory(path, explicitGitkeep);
      setFolderPath('');
      if (explicitGitkeep) {
        setSelectedDraftPaths((previous) => new Set(previous).add(`${path}/.gitkeep`));
        setLocalStatus(t('github.gitkeepStaged'));
      }
      else setLocalStatus(t('github.emptyFolderNotStored'));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [activeRef, activeRepo, explicitGitkeep, folderPath, reportError, setSelectedDraftPaths, store, t]);

  const handleCreateBranch = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRepo || !newBranchName.trim()) return;
    setActionBusy(true);
    try {
      await store.getState().createBranch(newBranchName.trim());
      setNewBranchName('');
      setLocalStatus(t('github.branchCreatedSelectIt'));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [activeRepo, newBranchName, reportError, store, t]);

  const handleRenameOrMove = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeFile || !activeRepo || !activeRef || !accountId || !renamePath.trim()) return;
    if (hasUnsavedEdits) {
      setLocalStatus(t('github.saveBeforeFileOperation'));
      return;
    }
    const targetPath = renamePath.trim();
    if (targetPath === activeFile.path) return;
    const currentDraft = activeFile.draft ?? activeDrafts.find((draft) => draft.path === activeFile.path);
    const existingDestination = activeDrafts.some((draft) => draft.path === targetPath && draft.path !== activeFile.path);
    if (existingDestination) {
      setLocalStatus(t('github.draftPathExists', { path: targetPath }));
      return;
    }
    const sourceParent = activeFile.path.includes('/') ? activeFile.path.slice(0, activeFile.path.lastIndexOf('/')) : '';
    const destinationParent = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
    const operation = sourceParent === destinationParent ? 'rename' : 'move';
    setActionBusy(true);
    try {
      if (currentDraft?.operation === 'add') {
        await store.getState().saveDraft({
          repoId: activeRepo.id,
          ref: activeRef,
          path: targetPath,
          baseCommitSha: currentDraft.baseCommitSha,
          baseBlobSha: null,
          originalText: null,
          originalBinary: null,
          newText: currentDraft.newText,
          newBinary: currentDraft.newBinary,
          binary: currentDraft.binary,
          operation: 'add',
        });
        await store.getState().deleteDrafts({ confirm: true, accountId, repoId: activeRepo.id, ref: activeRef, path: currentDraft.path });
      } else {
        await store.getState().saveDraft({
          repoId: activeRepo.id,
          ref: activeRef,
          path: activeFile.path,
          baseCommitSha: currentDraft?.baseCommitSha ?? activeFile.baseCommitSha ?? baseCommitForNewDraft(),
          baseBlobSha: currentDraft?.baseBlobSha ?? activeFile.baseBlobSha,
          originalText: currentDraft?.originalText ?? activeFile.text,
          originalBinary: currentDraft?.originalBinary ?? activeFile.binaryBase64,
          newText: currentDraft?.newText ?? activeFile.text,
          newBinary: currentDraft?.newBinary ?? activeFile.binaryBase64,
          binary: activeFile.mediaKind !== 'text',
          operation,
          newPath: targetPath,
          ...(currentDraft ? { expectedEditVersion: currentDraft.editVersion } : {}),
        });
      }
      setRenamePath(targetPath);
      setLocalStatus(t(operation === 'rename' ? 'github.renameStaged' : 'github.moveStaged', { from: activeFile.path, to: targetPath }));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [accountId, activeDrafts, activeFile, activeRef, activeRepo, baseCommitForNewDraft, hasUnsavedEdits, renamePath, reportError, store, t]);

  const handleDeleteFile = useCallback(async () => {
    if (!activeFile || !activeRepo || !activeRef || !accountId) return;
    if (hasUnsavedEdits) {
      setLocalStatus(t('github.saveBeforeFileOperation'));
      return;
    }
    const exactTarget = `${activeRepo.ownerLogin}/${activeRepo.name} @ ${activeRef} · ${activeFile.path}`;
    if (typeof window === 'undefined' || !window.confirm(t('github.confirmDeleteFile', { target: exactTarget }))) return;
    setActionBusy(true);
    try {
      const currentDraft = activeFile.draft ?? activeDrafts.find((draft) => draft.path === activeFile.path);
      if (currentDraft?.operation === 'add') {
        await store.getState().deleteDrafts({ confirm: true, accountId, repoId: activeRepo.id, ref: activeRef, path: currentDraft.path });
      } else {
        await store.getState().saveDraft({
          repoId: activeRepo.id,
          ref: activeRef,
          path: activeFile.path,
          baseCommitSha: currentDraft?.baseCommitSha ?? activeFile.baseCommitSha ?? baseCommitForNewDraft(),
          baseBlobSha: currentDraft?.baseBlobSha ?? activeFile.baseBlobSha,
          originalText: currentDraft?.originalText ?? activeFile.text,
          originalBinary: currentDraft?.originalBinary ?? activeFile.binaryBase64,
          newText: null,
          newBinary: null,
          binary: activeFile.mediaKind !== 'text',
          operation: 'delete',
          ...(currentDraft ? { expectedEditVersion: currentDraft.editVersion } : {}),
        });
      }
      setSelectedDraftPaths((previous) => new Set(previous).add(activeFile.path));
      setLocalStatus(t('github.deleteStaged', { path: activeFile.path }));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [accountId, activeDrafts, activeFile, activeRef, activeRepo, baseCommitForNewDraft, hasUnsavedEdits, reportError, setSelectedDraftPaths, store, t]);

  const handleUndoDraft = useCallback(async (draft: GithubDraft) => {
    if (!accountId || !activeRepo || !activeRef || typeof window === 'undefined') return;
    if (!window.confirm(t('github.confirmUndoDraft', { target: `${activeRepo.ownerLogin}/${activeRepo.name} @ ${activeRef} · ${draft.path}` }))) return;
    setActionBusy(true);
    try {
      await store.getState().deleteDrafts({ confirm: true, accountId, repoId: activeRepo.id, ref: activeRef, path: draft.path });
      setSelectedDraftPaths((previous) => {
        const next = new Set(previous);
        next.delete(draft.path);
        return next;
      });
      setLocalStatus(t('github.draftUndone', { path: draft.path }));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [accountId, activeRef, activeRepo, reportError, setSelectedDraftPaths, store, t]);

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!activeRepo || !activeRef) return;
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    setActionBusy(true);
    let staged = 0;
    try {
      for (const file of fileList) {
        if (file.size > GITHUB_INLINE_BYTE_CAP) throw new Error(t('github.uploadTooLarge', { name: file.name }));
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        if (activeDrafts.some((draft) => draft.path === path || draft.newPath === path)) throw new Error(t('github.draftPathExists', { path }));
        const bytes = new Uint8Array(await file.arrayBuffer());
        await store.getState().stageUpload(path, encodeBase64(bytes));
        staged += 1;
      }
      setLocalStatus(t('github.uploadsStaged', { count: staged }));
    } catch (error) {
      if (staged > 0) setLocalStatus(t('github.uploadPartial', { count: staged }));
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [activeDrafts, activeRef, activeRepo, reportError, store, t]);

  const handleSearch = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setActionBusy(true);
    try {
      await store.getState().searchRepository(searchQuery.trim());
    } catch (error) {
      reportError(error);
    } finally {
      setSearching(false);
      setActionBusy(false);
    }
  }, [reportError, searchQuery, store]);

  const handleShowHistory = useCallback(async () => {
    updatePanel({ leftView: 'history' });
    setHistoryLoading(true);
    setActionBusy(true);
    try {
      await store.getState().loadHistory();
    } catch (error) {
      reportError(error);
    } finally {
      setHistoryLoading(false);
      setActionBusy(false);
    }
  }, [reportError, store, updatePanel]);

  const handleStageCommit = useCallback(() => {
    if (!activeRepo || !activeRef || !accountId || selectedDrafts.length === 0) return;
    if (selectedHasUnresolvedConflict) {
      setLocalStatus(t('github.resolveConflictsBeforeCommit'));
      return;
    }
    if (!activeRemote) {
      setLocalStatus(t('github.refreshBeforeCommit'));
      return;
    }
    if (activeRemote.protected) {
      setLocalStatus(t('github.protectedBranchBlocked'));
      return;
    }
    const bases = new Set(selectedDrafts.map((draft) => draft.baseCommitSha));
    if (bases.size !== 1 || [...bases][0] !== (activeRemote.remoteCommitSha ?? '')) {
      setLocalStatus(t('github.refreshResolveStaleDrafts'));
      return;
    }
    const commitId = crypto.randomUUID().replaceAll('-', '');
    try {
      const sentMessage = exactCommitMessage(commitMessage.trim(), commitId);
      setCommitReview({
        accountId,
        repoId: activeRepo.id,
        ref: activeRef,
        expectedBaseSha: activeRemote.remoteCommitSha ?? '',
        commitId,
        sentMessage,
        draftVersions: selectedDrafts.map(({ path, editVersion }) => ({ path, editVersion })),
      });
    } catch (error) {
      reportError(error);
    }
  }, [accountId, activeRef, activeRemote, activeRepo, commitMessage, reportError, selectedDrafts, selectedHasUnresolvedConflict, setCommitReview, t]);

  const handleConfirmCommit = useCallback(async () => {
    if (!commitReview) return;
    setActionBusy(true);
    try {
      const state = store.getState();
      const currentAccount = state.connection.status === 'connected' ? state.connection.account.id : null;
      const currentTarget = state.accountWorkspace?.activeRepoId === commitReview.repoId
        && state.accountWorkspace.activeRefByRepo[commitReview.repoId] === commitReview.ref;
      if (currentAccount !== commitReview.accountId || !currentTarget) throw new Error(t('github.commitTargetChanged'));
      const currentDrafts = state.drafts.filter((draft) => draft.accountId === commitReview.accountId && draft.repoId === commitReview.repoId && draft.ref === commitReview.ref);
      if (commitReview.draftVersions.some((version) => currentDrafts.find((draft) => draft.path === version.path)?.editVersion !== version.editVersion)) {
        throw new Error(t('github.commitDraftChanged'));
      }
      await state.refreshRemote();
      setLastRemoteCheck({ targetKey: listingKey(commitReview.repoId, commitReview.ref, '@status'), value: Date.now() });
      const freshRemote = store.getState().remote;
      if (!freshRemote || freshRemote.repoId !== commitReview.repoId || freshRemote.ref !== commitReview.ref
        || (freshRemote.remoteCommitSha ?? '') !== commitReview.expectedBaseSha || freshRemote.protected) {
        throw new Error(freshRemote?.protected ? t('github.protectedBranchBlocked') : t('github.commitRemoteChanged'));
      }
      const result = await store.getState().commitSelected({ confirm: true, ...commitReview });
      setCommitReview(null);
      if (result.status === 'sent') {
        setSelectedDraftPaths(new Set());
        setCommitMessage('');
        setLocalStatus(commitOutcomeMessage(result));
        await store.getState().refreshRemote();
        await store.getState().browse('');
        const refreshed = store.getState();
        if (activeRepo) setDirectoryListings((previous) => ({ ...previous, [listingKey(activeRepo.id, commitReview.ref, '')]: { entries: refreshed.entries, complete: refreshed.entriesComplete } }));
      } else {
        setLocalStatus(commitOutcomeMessage(result));
      }
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [activeRepo, commitOutcomeMessage, commitReview, reportError, setCommitMessage, setCommitReview, setSelectedDraftPaths, store, t]);

  const handleDownload = useCallback(async () => {
    if (!activeFile) return;
    setActionBusy(true);
    try {
      let base64 = activeFile.binaryBase64;
      let mediaKind = activeFile.mediaKind ?? 'binary';
      if (!base64 && activeFile.remoteBlobSha) {
        const result = await store.getState().downloadBlob(activeFile.remoteBlobSha);
        if (result.byteLength > GITHUB_DOWNLOAD_BYTE_CAP) throw new Error(t('github.downloadTooLarge'));
        base64 = result.base64;
        mediaKind = result.mediaKind;
      }
      if (!base64) throw new Error(t('github.downloadUnavailable'));
      const bytes = decodeBase64(base64);
      if (bytes.byteLength > GITHUB_DOWNLOAD_BYTE_CAP) throw new Error(t('github.downloadTooLarge'));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl.url);
      const mime = mediaKind === 'image' ? imageMimeType(activeFile.path) : mediaKind === 'pdf' ? 'application/pdf' : 'application/octet-stream';
      const ownedBytes = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ownedBytes).set(bytes);
      const url = URL.createObjectURL(new Blob([ownedBytes], { type: mime }));
      setDownloadUrl({ path: activeFile.path, url, mediaKind });
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [activeFile, downloadUrl, reportError, store, t]);

  const handleResolveConflict = useCallback(async (draft: GithubDraft, choice: 'mine' | 'theirs' | 'both' | 'custom') => {
    if (!draft.conflict) return;
    setActionBusy(true);
    try {
      await store.getState().resolveConflict({
        path: draft.path,
        choice,
        ...(choice === 'custom' ? {
          resultText: customConflictText[draft.path] ?? draft.newText ?? '',
          ...(draft.conflict.kind === 'rename_collision' ? { resultPath: conflictDestinations[draft.path]?.trim() || draft.newPath || undefined } : {}),
        } : {}),
      });
      setLocalStatus(t('github.conflictResolved', { path: draft.path }));
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  }, [conflictDestinations, customConflictText, reportError, store, t]);

  const closeFileTab = useCallback(async (path: string) => {
    if (activeFile?.path === path && !confirmDiscard()) return;
    if (activeFile?.path === path) setEditorBuffer({ fileKey: null, text: '' });
    const remaining = openPaths.filter((openPath) => openPath !== path);
    try {
      await store.getState().setOpenPaths(remaining);
      if (selectedPath === path) {
        const nextPath = remaining.at(-1);
        if (nextPath) await store.getState().openDraftPath(nextPath);
        else store.setState({ openedFile: null });
      }
    } catch (error) {
      reportError(error);
    }
  }, [activeFile?.path, confirmDiscard, openPaths, reportError, selectedPath, store]);

  const closeRepoTab = useCallback(async (repo: GithubRepo) => {
    if (activeRepoId === repo.id && !confirmDiscard()) return;
    const closingActive = activeRepoId === repo.id;
    if (closingActive) setEditorBuffer({ fileKey: null, text: '' });
    try {
      await store.getState().closeRepoTab(repo.id);
      setLocalStatus(t('github.repoTabClosed'));
      if (closingActive) {
        const workspace = store.getState().accountWorkspace;
        if (workspace?.activeRepoId) {
          await openRepository(workspace.activeRepoId, workspace.activeRefByRepo[workspace.activeRepoId]);
        }
      }
    } catch (error) {
      reportError(error);
    }
  }, [activeRepoId, confirmDiscard, openRepository, reportError, store, t]);

  function renderEntries(path: string, entries: GithubEntry[]): ReactNode {
    const visibleEntries = [...entries];
    const seenPaths = new Set(entries.map((entry) => entry.path));
    for (const draft of activeDrafts) {
      const displayPath = draft.operation === 'rename' || draft.operation === 'move' ? draft.newPath ?? draft.path : draft.path;
      if (!['add', 'rename', 'move'].includes(draft.operation)) continue;
      const relative = path ? (displayPath.startsWith(`${path}/`) ? displayPath.slice(path.length + 1) : '') : displayPath;
      if (!relative) continue;
      const firstSegment = relative.split('/')[0];
      const childPath = path ? `${path}/${firstSegment}` : firstSegment;
      if (seenPaths.has(childPath)) continue;
      const isNestedPath = relative.includes('/');
      visibleEntries.push({ name: firstSegment, path: childPath, kind: isNestedPath ? 'dir' : 'file', sha: null, byteLength: null });
      seenPaths.add(childPath);
    }
    return (
      <ul className="github-file-tree-list">
        {visibleEntries.map((entry) => {
          const isDirectory = entry.kind === 'dir';
          const key = activeRepo && activeRef ? listingKey(activeRepo.id, activeRef, entry.path) : '';
          const isExpanded = expandedDirectories.has(key);
          const listing = directoryListings[key];
          const isLoading = loadingDirectories.has(key);
          const isUnsupported = !isDirectory && entry.kind !== 'file';
          const hasLocalChildren = activeDrafts.some((draft) => {
            const displayPath = draft.operation === 'rename' || draft.operation === 'move' ? draft.newPath ?? draft.path : draft.path;
            return displayPath.startsWith(`${entry.path}/`);
          });
          const pathDraft = activeDrafts.find((draft) => draft.path === entry.path || draft.newPath === entry.path);
          const indicator = pathDraft?.operation === 'add' ? t('github.treeAdded')
            : pathDraft?.operation === 'delete' ? t('github.treeDeleted')
              : pathDraft?.operation === 'rename' || pathDraft?.operation === 'move' ? t('github.treeRenamed')
                : pathDraft ? t('github.treeModified') : '';
          return (
            <li key={`${path}/${entry.name}`} className="github-file-tree-item">
              <button
                type="button"
                className="github-file-tree-entry"
                aria-expanded={isDirectory ? isExpanded : undefined}
                aria-label={entry.kind === 'file' ? t('github.openFile', { path: entry.path }) : undefined}
                title={isUnsupported ? t('github.unsupported') : undefined}
                disabled={isUnsupported || selectingRepo}
                onClick={() => {
                  if (isDirectory) toggleDirectory(entry.path);
                  else if (entry.kind === 'file') void openFile(entry.path);
                }}
              >
                {isDirectory
                  ? isExpanded ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />
                  : <FileText size={15} aria-hidden="true" />}
                <span className="github-file-tree-name">{entry.name}</span>
                {indicator && <span className="github-file-tree-kind" title={indicator} aria-label={indicator}>{indicator}</span>}
                {isDirectory && (isExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />)}
                {isUnsupported && <span className="github-file-tree-kind">{entry.kind}</span>}
              </button>
              {isDirectory && isExpanded && (
                <div className="github-file-tree-children">
                  {isLoading && <span className="github-inline-status" role="status">{t('github.statusChecking')}</span>}
                  {listing && listing.entries.length === 0 && !hasLocalChildren && <span className="github-inline-status">{t('github.emptyDirectory')}</span>}
                  {listing && !listing.complete && <span className="github-inline-warning" role="status">{t('github.incompleteEntries')}</span>}
                  {listing && (listing.entries.length > 0 || hasLocalChildren) && renderEntries(entry.path, listing.entries)}
                  {!listing && hasLocalChildren && renderEntries(entry.path, [])}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (!desktop) {
    return <GithubMessageScreen title={t('github.title')} message={t('github.desktopOnly')} />;
  }

  if (!initialized) {
    return <GithubMessageScreen title={t('github.title')} message={t('github.loading')} />;
  }

  if (connection.status !== 'connected') {
    const challenge = connection.status === 'authorizing' ? connection.challenge : null;
    return (
      <section className="github-mode github-connection-screen" aria-labelledby="github-connection-title">
        <div className="github-connection-card">
          <h1 id="github-connection-title">{connection.status === 'needs_setup' ? t('github.setupTitle') : t('github.title')}</h1>
          {connection.status === 'needs_setup' ? (
            <>
              <p>{t('github.setupHint')}</p>
              <form className="github-client-id-form" onSubmit={(event) => void handleConfigureClientId(event)}>
                <label htmlFor="github-client-id">{t('github.clientId')}</label>
                <input
                  id="github-client-id"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('github.clientIdPlaceholder')}
                  value={clientId}
                  onChange={(event) => setClientId(event.currentTarget.value)}
                />
                <button type="submit" className="github-primary-button" disabled={configuring || clientId.length === 0}>
                  {t('github.saveClientId')}
                </button>
              </form>
            </>
          ) : connection.status === 'authorizing' && challenge ? (
            <>
              <p>{scopeElevationRepoId ? t('github.deleteScopeDeviceTitle') : t('github.deviceTitle')}</p>
              {scopeElevationRepoId && <p>{t('github.deleteScopeDeviceHelp', {
                target: repoDeleteSnapshot?.repoId === scopeElevationRepoId ? repoDeleteSnapshot.fullName : scopeElevationRepoId,
              })}</p>}
              <button type="button" className="github-secondary-button" onClick={() => void handleOpenDeviceLogin()} disabled={finishingSignIn}>
                {t('github.openDevicePage')}
              </button>
              {deviceLoginStatus && <p className="github-inline-status" role="status">{deviceLoginStatus}</p>}
              <div className="github-device-code">
                <span>{t('github.userCode')}</span>
                <output aria-label={t('github.userCode')}>{challenge.userCode}</output>
              </div>
              <p>{scopeElevationRepoId ? t('github.deleteScopeSignInHelp') : t('github.signInHelp')}</p>
              {finishingSignIn && <p className="github-inline-status" role="status">{t('github.signInPending')}</p>}
              <div className="github-connection-actions">
                <button type="button" className="github-primary-button" onClick={() => void handleFinishSignIn()} disabled={finishingSignIn}>
                  {finishingSignIn ? t('github.signInPending') : t('github.finishSignIn')}
                </button>
                <button type="button" className="github-secondary-button" onClick={() => {
                  store.getState().cancelSignIn();
                  setFinishingSignIn(false);
                }}>{t('github.cancelSignIn')}</button>
              </div>
            </>
          ) : connection.status === 'native_unavailable' ? (
            <p>{t('github.nativeUnavailable')}</p>
          ) : (
            <>
              <p>{connection.status === 'auth_expired' ? t('github.authExpired') : t('github.connectionSignedOut')}</p>
              <p>{t('github.signInHelp')}</p>
              <button type="button" className="github-primary-button" onClick={() => void handleBeginSignIn()}>
                {t('github.connect')}
              </button>
            </>
          )}
          {lastError && <p className="github-error-message" role="alert">{lastError.message}</p>}
        </div>
      </section>
    );
  }

  const activeLocationKey = activeRepo && activeRef ? listingKey(activeRepo.id, activeRef, '') : '';
  const rootListing = activeLocationKey ? directoryListings[activeLocationKey] : undefined;
  const currentPanelWidth = transientPanelWidth?.targetKey === activePanelTargetKey
    ? transientPanelWidth.widthPx
    : currentBranchWorkspace?.panel.navWidthPx ?? DEFAULT_GITHUB_PANEL.navWidthPx;
  const isBusy = busy || selectingRepo;
  const activeDraft = activeFile?.draft ?? activeDrafts.find((draft) => draft.path === activeFile?.path || draft.newPath === activeFile?.path) ?? null;
  const activeExtension = activeFile?.path.split('.').at(-1)?.toLowerCase() ?? '';
  const markdownFile = activeFile?.kind === 'text' && ['md', 'markdown', 'mdown'].includes(activeExtension);
  const passivePreviewBlocked = activeFile?.kind === 'text' && ['svg', 'html', 'htm'].includes(activeExtension);
  const inlineBinaryPreview = activeFile?.kind === 'binary' && activeFile.byteLength <= GITHUB_INLINE_BYTE_CAP
    && (activeFile.mediaKind === 'image' || activeFile.mediaKind === 'pdf');

  return (
    <div className="github-mode">
      <PrimaryWorkspaceContent
        mode="github"
        contextPanel={(
          <aside className="github-repository-panel" aria-label={t('github.fileTree')}>
            <div className="github-panel-heading">
              <GitBranch size={16} aria-hidden="true" />
              <h2>{t('github.fileTree')}</h2>
            </div>
            <nav className="github-left-nav" role="tablist" aria-label={t('github.leftNavigation')}>
              <button type="button" role="tab" aria-selected={panel.leftView === 'files'} onClick={() => updatePanel({ leftView: 'files' })}>{t('github.filesTab')}</button>
              <button type="button" role="tab" aria-selected={panel.leftView === 'changes'} onClick={() => updatePanel({ leftView: 'changes' })}>
                {t('github.changesTab')} <span className="github-change-count">{activeDrafts.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={panel.leftView === 'history'} onClick={() => void handleShowHistory()}>{t('github.historyTab')}</button>
            </nav>
            {panel.leftView === 'files' && <>
            <label className="github-repo-search">
              <span>{t('github.repoSearch')}</span>
              <input
                type="search"
                aria-label={t('github.repoSearch')}
                placeholder={t('github.repoSearchPlaceholder')}
                value={repoSearch}
                onChange={(event) => setRepoSearch(event.currentTarget.value)}
              />
            </label>
            <div className="github-repo-search-results" role="group" aria-label={t('github.repoSearch')}>
              {filteredRepos.map((repo) => (
                <button
                  type="button"
                  key={repo.id}
                  className="github-repo-option"
                  aria-pressed={activeRepoId === repo.id}
                  disabled={selectingRepo}
                  onClick={() => void openRepository(repo.id)}
                  title={`${repo.ownerLogin}/${repo.name}`}
                >
                  <span className="github-repo-option-name">{repo.name}</span>
                  {repo.private && <span className="github-private-badge">{t('github.private')}</span>}
                </button>
              ))}
              {filteredRepos.length === 0 && (
                <p className="github-inline-status">{repos.length ? t('github.noRepoMatches') : t('github.noRepos')}</p>
              )}
              {!reposComplete && <p className="github-inline-warning" role="status">{t('github.incompleteRepos')}</p>}
            </div>
            <div className="github-tree-heading">
              <span>{t('github.fileTree')}</span>
              {activeRepo && <span className="github-tree-repo-name">{activeRepo.name}</span>}
            </div>
            <div className="github-file-tree-scroll" role="group" aria-label={t('github.fileTree')}>
              {!activeRepo ? (
                <p className="github-empty-prompt">{t('github.selectRepo')}</p>
              ) : rootListing?.entries.length === 0 ? (
                <p className="github-empty-prompt">{t('github.emptyDirectory')}</p>
              ) : rootListing ? (
                <>
                  {!rootListing.complete && <p className="github-inline-warning" role="status">{t('github.incompleteEntries')}</p>}
                  {renderEntries('', rootListing.entries)}
                </>
              ) : (
                <p className="github-inline-status" role="status">{t('github.statusChecking')}</p>
              )}
            </div>
            </>}
            {panel.leftView === 'changes' && (
              <section className="github-changes-scroll" aria-label={t('github.changesTab')}>
                <form className="github-search-form" onSubmit={(event) => void handleSearch(event)}>
                  <label htmlFor="github-repository-search">{t('github.searchRepo')}</label>
                  <div className="github-search-row">
                    <input id="github-repository-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} />
                    <button type="submit" className="github-secondary-button" disabled={actionBusy || !searchQuery.trim()}>{t('github.search')}</button>
                  </div>
                </form>
                {searching && <p className="github-inline-status" role="status">{t('github.searchingRepo')}</p>}
                {search && (
                  <div className="github-search-results" aria-label={t('github.searchResults')}>
                    {search.items.map((match, index) => (
                      <button type="button" className="github-search-result" key={`${match.path}:${match.line ?? index}:${match.source}`} onClick={() => void openFile(match.path)}>
                        <strong>{match.path}</strong>
                        <span>{t(match.source === 'draft' ? 'github.searchDraft' : 'github.searchRemote')}{match.line === null ? '' : ` · ${t('github.lineNumber', { line: match.line })}`}</span>
                        <code>{match.preview}</code>
                      </button>
                    ))}
                    <p className={search.complete ? 'github-inline-status' : 'github-inline-warning'} role="status">
                      {search.error?.message ?? search.message ?? t(search.complete ? 'github.searchComplete' : 'github.searchIncomplete')}
                    </p>
                    <p className="github-inline-status">{t('github.searchProgress', { scanned: search.progress.scannedBlobs, skipped: search.progress.skippedBySize + search.progress.skippedUnsupported, drafts: search.progress.draftCount })}</p>
                    {(search.progress.treeTruncated || search.progress.fetchCapReached || search.progress.rateLimited) && <p className="github-inline-warning">{t('github.searchLimitReached')}</p>}
                  </div>
                )}
                <div className="github-change-list-heading">
                  <strong>{t('github.draftsCount', { count: activeDrafts.length })}</strong>
                  <button type="button" className="github-secondary-button" disabled={selectedDrafts.length === 0 || actionBusy} onClick={() => updatePanel({ leftView: 'changes' })}>{t('github.selectedCount', { count: selectedDrafts.length })}</button>
                </div>
                {activeRemote && (
                  <p className={activeRemote.draftsStale ? 'github-inline-warning' : 'github-inline-status'} role="status">
                    {t('github.baseHeadStatus', { base: visibleBaseLabel, head: activeRemote.remoteCommitSha?.slice(0, 8) ?? t('github.noRemoteHead') })}
                  </p>
                )}
                {activeRemote?.protected && <p className="github-inline-warning" role="alert">{t('github.protectedBranchBlocked')}</p>}
                {activeRemote?.draftsStale && <p className="github-inline-warning" role="alert">{t('github.refreshResolveStaleDrafts')}</p>}
                {activeDrafts.length === 0 ? <p className="github-empty-prompt">{t('github.noDrafts')}</p> : activeDrafts.map((draft) => (
                  <article className="github-change-item" key={draft.path}>
                    <label className="github-change-select">
                      <input type="checkbox" checked={selectedDraftPaths.has(draft.path)} onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedDraftPaths((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(draft.path); else next.delete(draft.path);
                          return next;
                        });
                      }} />
                      <span className="github-change-path">{draft.path}{draft.newPath ? ` → ${draft.newPath}` : ''}</span>
                    </label>
                    <div className="github-change-actions">
                      <span className="github-change-operation">{t(`github.operation.${draft.operation}`)}</span>
                      <button type="button" className="github-secondary-button" onClick={() => void openFile(draft.newPath ?? draft.path)}>{t('github.openChange')}</button>
                      <button type="button" className="github-secondary-button" disabled={actionBusy} onClick={() => void handleUndoDraft(draft)}>{t('github.undoDraft')}</button>
                    </div>
                    {draft.conflict && (
                      <section className="github-conflict-card" aria-label={t('github.conflictFor', { path: draft.path })}>
                        <strong>{draft.conflict.resolved ? t('github.conflictResolvedLabel') : t('github.conflictUnresolvedLabel')}</strong>
                        <p>{t(`github.conflictKind.${draft.conflict.kind}`)} · {t('github.conflictRemoteHead', { sha: draft.conflict.remoteCommitSha.slice(0, 8) })}</p>
                        <div className="github-conflict-versions">
                          <section><h4>{t('github.conflictBase')}</h4><pre>{draft.originalText ?? t('github.binaryVersion')}</pre></section>
                          <section><h4>{t('github.conflictMine')}</h4><pre>{draft.binary ? t('github.binaryVersion') : draft.newText ?? t('github.deletedVersion')}</pre></section>
                          <section><h4>{t('github.conflictRemote')}</h4><pre>{draft.conflict.remoteDeleted ? t('github.deletedVersion') : draft.binary ? t('github.binaryVersion') : draft.conflict.remoteText ?? t('github.noRemoteText')}</pre></section>
                        </div>
                        {!draft.binary && <label className="github-conflict-custom">
                          <span>{t('github.conflictEditableResult')}</span>
                          <textarea value={customConflictText[draft.path] ?? draft.conflict.resultText ?? draft.newText ?? ''} onChange={(event) => {
                            const text = event.currentTarget.value;
                            setCustomConflictText((previous) => ({ ...previous, [draft.path]: text }));
                          }} />
                        </label>}
                        {draft.conflict.kind === 'rename_collision' && <label className="github-repo-search">
                          <span>{t('github.conflictDestination')}</span>
                          <input value={conflictDestinations[draft.path] ?? draft.newPath ?? ''} onChange={(event) => {
                            const path = event.currentTarget.value;
                            setConflictDestinations((previous) => ({ ...previous, [draft.path]: path }));
                          }} />
                        </label>}
                        <div className="github-conflict-actions">
                          <button type="button" className="github-secondary-button" disabled={actionBusy} onClick={() => void handleResolveConflict(draft, 'mine')}>{t('github.conflictKeepMine')}</button>
                          <button type="button" className="github-secondary-button" disabled={actionBusy} onClick={() => void handleResolveConflict(draft, 'theirs')}>{t('github.conflictKeepTheirs')}</button>
                          {!draft.binary && draft.conflict.kind === 'content' && <button type="button" className="github-secondary-button" disabled={actionBusy} onClick={() => void handleResolveConflict(draft, 'both')}>{t('github.conflictMergeBoth')}</button>}
                          {!draft.binary && <button type="button" className="github-primary-button" disabled={actionBusy} onClick={() => void handleResolveConflict(draft, 'custom')}>{t('github.conflictUseCustom')}</button>}
                        </div>
                      </section>
                    )}
                  </article>
                ))}
                {activeRemote?.empty && <p className="github-inline-warning">{t('github.emptyRepositoryFirstCommitNote')}</p>}
                <label className="github-commit-message">
                  <span>{t('github.commitMessage')}</span>
                  <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.currentTarget.value)} />
                </label>
                <button type="button" className="github-primary-button github-commit-button" disabled={!selectedDrafts.length || actionBusy || selectedHasUnresolvedConflict || activeRemote?.protected === true} onClick={handleStageCommit}>
                  {t('github.commitCreateAndSend', { target: activeRepo ? `${activeRepo.ownerLogin}/${activeRepo.name} @ ${activeRef}` : t('github.noTarget') })}
                </button>
                {commitResult && <p className="github-inline-status" role="status">{commitOutcomeMessage(commitResult)}</p>}
              </section>
            )}
            {panel.leftView === 'history' && (
              <section className="github-history-scroll" aria-label={t('github.historyTab')}>
                <form className="github-branch-create" onSubmit={(event) => void handleCreateBranch(event)}>
                  <label htmlFor="github-new-branch">{t('github.newBranch')}</label>
                  <div className="github-search-row"><input id="github-new-branch" value={newBranchName} onChange={(event) => setNewBranchName(event.currentTarget.value)} /><button className="github-secondary-button" type="submit" disabled={actionBusy || !newBranchName.trim()}>{t('github.createBranch')}</button></div>
                </form>
                {historyLoading && <p className="github-inline-status" role="status">{t('github.loadingHistory')}</p>}
                {history.map((commit) => (
                  <button type="button" className="github-history-item" key={commit.sha} aria-pressed={commitDetail?.sha === commit.sha} onClick={() => void store.getState().loadCommitDetail(commit.sha).catch(reportError)}>
                    <strong>{commit.message.split('\n')[0]}</strong><code>{commit.sha.slice(0, 8)}</code><time>{commit.date ?? ''}</time>
                  </button>
                ))}
                {history.length === 0 && <p className="github-empty-prompt">{t('github.noHistory')}</p>}
                {commitDetail && <section className="github-commit-detail">
                  <h3>{t('github.commitDetail')}</h3><pre>{commitDetail.message}</pre>
                  <ul>{commitDetail.files.map((file) => <li key={`${file.path}:${file.sha ?? ''}`}><span>{file.status ?? t('github.unknownStatus')}</span> {file.path}</li>)}</ul>
                </section>}
              </section>
            )}
          </aside>
        )}
        centerPanel={(
          <section className="github-editor-pane" aria-label={t('github.title')}>
            <div className="github-topbar">
              <div className="github-repo-tabs" role="tablist" aria-label={t('github.repoTabs')}>
                {repoTabs.map((repo) => (
                  <div className="github-repo-tab" key={repo.id}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={repo.id === activeRepoId}
                      className="github-repo-tab-select"
                      onClick={() => void openRepository(repo.id)}
                    >
                      <span>{repo.name}</span>
                    </button>
                    <button
                      type="button"
                      className="github-tab-close"
                      aria-label={t('github.closeRepoTab', { name: repo.name })}
                      disabled={selectingRepo || busy}
                      onClick={() => void closeRepoTab(repo)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="github-connection-status" role="status">
                <span className="github-status-dot" aria-hidden="true" />
                <span>{isBusy ? t('github.statusChecking') : t('github.statusConnected')}</span>
                <span className="github-connected-login">{t('github.connectedAs', { login: connection.account.login })}</span>
              </div>
            </div>
            <div className="github-repository-toolbar">
              <div className="github-active-repository">
                {activeRepo ? (
                  <>
                    <span className="github-active-repo-name">{activeRepo.ownerLogin}/{activeRepo.name}</span>
                    {activeRepo.private && <span className="github-private-badge">{t('github.private')}</span>}
                  </>
                ) : <span className="github-empty-prompt">{t('github.selectRepo')}</span>}
              </div>
              <label className="github-branch-picker">
                <GitBranch size={14} aria-hidden="true" />
                <span>{t('github.branch')}</span>
                <select
                  aria-label={t('github.branch')}
                  value={activeRef}
                  disabled={!activeRepo || isBusy || branches.length === 0}
                  onChange={(event) => {
                    if (activeRepo) void openRepository(activeRepo.id, event.currentTarget.value);
                  }}
                >
                  {activeRef && !branches.some((branch) => branch.name === activeRef) && <option value={activeRef}>{activeRef}</option>}
                  {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
                </select>
              </label>
              <button type="button" className="github-secondary-button github-manage-button" onClick={openRepoManagement} disabled={repoManagementBusy}>
                <Settings2 size={14} aria-hidden="true" />
                <span>{t('github.manageRepositories')}</span>
              </button>
              <button type="button" className="github-secondary-button github-refresh-button" onClick={() => void handleRefresh()} disabled={isBusy || refreshing}>
                <RefreshCw size={14} aria-hidden="true" />
                <span>{refreshing ? t('github.refreshing') : t('github.refresh')}</span>
              </button>
            </div>
            <details className="github-file-operations">
              <summary>{t('github.fileOperations')}</summary>
              <div className="github-file-operation-grid">
                <details>
                  <summary>{t('github.newFile')}</summary>
                  <form onSubmit={(event) => void handleCreateFile(event)}>
                    <label><span>{t('github.newFilePath')}</span><input value={newPath} onChange={(event) => setNewPath(event.currentTarget.value)} required /></label>
                    <label><span>{t('github.newFileContents')}</span><textarea value={newText} onChange={(event) => setNewText(event.currentTarget.value)} /></label>
                    <button type="submit" className="github-secondary-button" disabled={!activeRepo || actionBusy}>{t('github.addLocalDraft')}</button>
                  </form>
                </details>
                <details>
                  <summary>{t('github.newFolder')}</summary>
                  <form onSubmit={(event) => void handleCreateFolder(event)}>
                    <label><span>{t('github.newFolderPath')}</span><input value={folderPath} onChange={(event) => setFolderPath(event.currentTarget.value)} required /></label>
                    <label className="github-checkbox-label"><input type="checkbox" checked={explicitGitkeep} onChange={(event) => setExplicitGitkeep(event.currentTarget.checked)} /><span>{t('github.explicitGitkeep')}</span></label>
                    <button type="submit" className="github-secondary-button" disabled={!activeRepo || actionBusy}>{t('github.stageFolder')}</button>
                  </form>
                </details>
                {activeFile && <details>
                  <summary>{t('github.renameOrMove')}</summary>
                  <form onSubmit={(event) => void handleRenameOrMove(event)}>
                    <label><span>{t('github.newFilePath')}</span><input value={renamePath} onChange={(event) => setRenamePath(event.currentTarget.value)} required /></label>
                    <button type="submit" className="github-secondary-button" disabled={actionBusy || hasUnsavedEdits}>{t('github.stageRenameMove')}</button>
                  </form>
                  <button type="button" className="github-secondary-button" disabled={actionBusy || hasUnsavedEdits} onClick={() => void handleDeleteFile()}>{t('github.stageDelete')}</button>
                </details>}
                <div className="github-upload-drop" onDragOver={(event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  void handleUploadFiles(event.dataTransfer.files);
                }}>
                  <label><span>{t('github.uploadFiles')}</span><input type="file" multiple disabled={!activeRepo || actionBusy} onChange={(event) => {
                    const files = event.currentTarget.files;
                    if (files) void handleUploadFiles(files);
                    event.currentTarget.value = '';
                  }} /></label>
                  <span>{t('github.dropFilesHere')}</span>
                </div>
              </div>
            </details>
            {lastError && <p className="github-error-message" role="alert">{lastError.message}</p>}
            {localStatus && <p className="github-inline-status" role="status">{localStatus}</p>}
            <div className="github-file-tabs" role="tablist" aria-label={t('github.fileTabs')}>
              {openPaths.map((path) => (
                <div className="github-file-tab" key={path}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedPath === path}
                    className="github-file-tab-select"
                    title={path}
                    onClick={() => void openFile(path)}
                  >
                    <span>{fileName(path)}</span>
                  </button>
                  <button
                    type="button"
                    className="github-tab-close"
                    aria-label={t('github.closeFileTab', { path })}
                    onClick={() => void closeFileTab(path)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <div className="github-editor-view-tabs" role="tablist" aria-label={t('github.editorViews')}>
              {(['source', 'preview', 'diff'] as const).map((view) => (
                <button key={view} type="button" role="tab" aria-selected={panel.editorView === view} disabled={!activeFile}
                  onClick={() => updatePanel({ editorView: view })}>{t(`github.view.${view}`)}</button>
              ))}
              {panel.editorView === 'diff' && <div className="github-diff-layout-tabs" role="group" aria-label={t('github.diffLayout')}>
                <button type="button" aria-pressed={panel.diffLayout === 'side_by_side'} onClick={() => updatePanel({ diffLayout: 'side_by_side' })}>{t('github.sideBySide')}</button>
                <button type="button" aria-pressed={panel.diffLayout === 'inline'} onClick={() => updatePanel({ diffLayout: 'inline' })}>{t('github.inlineDiff')}</button>
              </div>}
            </div>
            <div className="github-editor-content">
              {!activeRepo ? (
                <p className="github-empty-prompt">{t('github.selectRepo')}</p>
              ) : !activeFile ? (
                <p className="github-empty-prompt">{t('github.emptyTree')}</p>
              ) : activeFile.kind !== 'text' ? (
                <div className="github-binary-preview">
                  <div className="github-file-notice" role="status">
                    <strong>{activeFile.kind === 'binary' ? t('github.binaryFile') : activeFile.kind === 'too_large' ? t('github.tooLarge') : t('github.unsupported')}</strong>
                    <p>{activeFile.message ?? t('github.textOnly')}</p>
                    <p>{t('github.binaryDownloadLimit', { limit: Math.round(GITHUB_DOWNLOAD_BYTE_CAP / 1_000_000) })}</p>
                    {activeFile.byteLength > GITHUB_INLINE_BYTE_CAP && <p>{t('github.binaryPreviewTooLarge', { limit: Math.round(GITHUB_INLINE_BYTE_CAP / 1_000_000) })}</p>}
                  </div>
                  {inlineBinaryPreview && downloadUrl?.path === activeFile.path && downloadUrl.mediaKind === 'image' && <img className="github-safe-image-preview" src={downloadUrl.url} alt={t('github.imagePreviewAlt', { path: activeFile.path })} />}
                  {inlineBinaryPreview && downloadUrl?.path === activeFile.path && downloadUrl.mediaKind === 'pdf' && <iframe className="github-safe-pdf-preview" src={downloadUrl.url} sandbox="" referrerPolicy="no-referrer" title={t('github.pdfPreviewTitle', { path: activeFile.path })} />}
                  {activeFile.mediaKind === 'image' || activeFile.mediaKind === 'pdf' ? (
                    <button type="button" className="github-secondary-button" disabled={actionBusy || activeFile.byteLength > GITHUB_DOWNLOAD_BYTE_CAP} onClick={() => void handleDownload()}>{t('github.loadSafePreviewOrDownload')}</button>
                  ) : <button type="button" className="github-secondary-button" disabled={actionBusy || activeFile.byteLength > GITHUB_DOWNLOAD_BYTE_CAP} onClick={() => void handleDownload()}>{t('github.downloadFile')}</button>}
                  {downloadUrl?.path === activeFile.path && <a className="github-download-link" href={downloadUrl.url} download={fileName(activeFile.path)}>{t('github.downloadReady', { path: activeFile.path })}</a>}
                </div>
              ) : panel.editorView === 'source' ? (
                <textarea
                  className="github-source-editor"
                  aria-label={t('github.sourceFor', { path: activeFile.path })}
                  spellCheck={false}
                  disabled={savingDraft}
                  value={sourceText}
                  onChange={(event) => {
                    setEditorBuffer({ fileKey: activeFileKey, text: event.currentTarget.value });
                    setLocalStatus('');
                  }}
                />
              ) : panel.editorView === 'preview' ? (
                passivePreviewBlocked ? <div className="github-file-notice" role="note"><strong>{t('github.passivePreviewBlocked')}</strong><p>{t('github.sourceOnlyPreview', { path: activeFile.path })}</p></div>
                  : markdownFile ? <article className="github-markdown-preview" aria-label={t('github.previewFor', { path: activeFile.path })}>
                    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
                      a: ({ children }) => <span className="github-inert-link">{children}</span>,
                      img: ({ alt }) => <span className="github-inert-image">{t('github.markdownImageDisabled', { alt: alt ?? '' })}</span>,
                    }}>{sourceText}</ReactMarkdown>
                  </article>
                  : <pre className="github-text-preview">{sourceText}</pre>
              ) : activeFile.kind !== 'text' ? (
                <div className="github-file-notice" role="status"><strong>{t('github.binaryDiffUnavailable')}</strong><p>{t('github.binaryVersionChoice')}</p></div>
              ) : (
                <div className={`github-text-diff github-text-diff-${panel.diffLayout}`}>
                  <section className="github-diff-version github-diff-base"><h3>{t('github.diffBase', { sha: activeDraft?.baseCommitSha.slice(0, 8) ?? activeFile.baseCommitSha?.slice(0, 8) ?? t('github.noBase') })}</h3><pre>{activeDraft?.originalText ?? activeFile.text ?? ''}</pre></section>
                  <section className="github-diff-version github-diff-working"><h3>{t('github.diffWorking', { sha: activeRemote?.remoteCommitSha?.slice(0, 8) ?? t('github.noRemoteHead') })}</h3><textarea aria-label={t('github.workingVersionFor', { path: activeFile.path })} spellCheck={false} value={sourceText} onChange={(event) => setEditorBuffer({ fileKey: activeFileKey, text: event.currentTarget.value })} /></section>
                </div>
              )}
            </div>
            {activeFile?.kind === 'text' && (
              <footer className="github-draft-footer">
                <div className="github-draft-status" role="status">
                  <span>{hasUnsavedEdits ? t('github.unsavedEdits') : activeFile.draft ? t('github.savedDraft') : t('github.noSavedDraft')}</span>
                  <span>{t('github.draftLocalOnly')}</span>
                </div>
                <button type="button" className="github-primary-button" onClick={() => void handleSaveDraft()} disabled={!hasUnsavedEdits || savingDraft}>
                  {savingDraft ? t('github.savingDraft') : t('github.saveDraft')}
                </button>
              </footer>
            )}
            <footer className="github-workspace-status" aria-label={t('github.workspaceStatus')} role="status">
              <span className="github-workspace-status-target">{activeRepo ? `${activeRepo.ownerLogin}/${activeRepo.name} @ ${activeRef}` : t('github.noTarget')}</span>
              <span>{t('github.remoteHeadStatus', {
                sha: activeRemote?.remoteCommitSha?.slice(0, 8) ?? (activeRemote?.empty ? t('github.emptyRepository') : t('github.noRemoteHead')),
              })}</span>
              <span>{t('github.lastCheckStatus', { time: activeLastRemoteCheck ? new Date(activeLastRemoteCheck).toLocaleString() : t('github.notChecked') })}</span>
              <span>{t('github.statusDraftCount', { count: activeDrafts.length })}</span>
              {lastError && <span className="github-workspace-status-error" role="alert">{lastError.message}</span>}
            </footer>
            {commitReview && <div className="github-commit-confirm-backdrop">
              <section className="github-commit-confirm" role="dialog" aria-modal="true" aria-labelledby="github-commit-confirm-title">
                <h2 id="github-commit-confirm-title">{t('github.confirmCommitTitle')}</h2>
                <p className="github-commit-target">{activeRepo?.ownerLogin}/{activeRepo?.name} @ {commitReview.ref}</p>
                <p>{t('github.confirmCommitBase', { sha: commitReview.expectedBaseSha || t('github.emptyRepositoryBase') })}</p>
                <ul>{commitReview.draftVersions.map((draft) => <li key={draft.path}>{draft.path}</li>)}</ul>
                <label className="github-commit-message"><span>{t('github.exactCommitMessage')}</span><pre>{commitReview.sentMessage}</pre></label>
                <p>{t('github.commitOneRequest')}</p>
                <div className="github-commit-confirm-actions">
                  <button type="button" className="github-secondary-button" disabled={actionBusy} onClick={() => setCommitReview(null)}>{t('github.cancelCommit')}</button>
                  <button type="button" className="github-primary-button" autoFocus disabled={actionBusy} onClick={() => void handleConfirmCommit()}>
                    {t('github.confirmCommitButton', { target: `${activeRepo?.ownerLogin}/${activeRepo?.name} @ ${commitReview.ref}` })}
                  </button>
                </div>
              </section>
            </div>}
          </section>
        )}
        contextPanelAvailable
        contextPanelOpen={contextPanelOpen}
        contextPanelWidthVw={contextPanelWidthVw}
        contextPanelWidthPx={currentPanelWidth}
        contextPanelMinWidthPx={120}
        contextPanelMaxWidthPx={480}
        onContextPanelWidthChange={setPanelWidth}
        contextResizeLabel={t('github.resizeContextPanel')}
        contextPanelId="github-repository-panel"
        contextPanelClassName="github-context-panel"
        contextPanelStyle={{ padding: 0 }}
      />
      {repoManagementOpen && <div className="github-commit-confirm-backdrop github-repo-management-backdrop">
        <section
          className="github-repo-management"
          role={repoCreateReview || repoDeleteReview ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-labelledby={repoCreateReview ? 'github-repo-create-confirm-title' : repoDeleteReview ? 'github-repo-delete-confirm-title' : 'github-repo-management-title'}
          onKeyDown={handleRepoManagementKeyDown}
        >
          <header className="github-repo-management-heading">
            <div>
              <h2 id="github-repo-management-title">{t('github.repoManagementTitle')}</h2>
              <p>{t('github.repoManagementAccount', { login: connection.account.login, id: connection.account.id })}</p>
            </div>
            <button type="button" className="github-tab-close" aria-label={t('github.closeRepoManagement')} disabled={repoManagementBusy} onClick={closeRepoManagement}>
              <X size={15} aria-hidden="true" />
            </button>
          </header>

          {!repoCreateReview && !repoDeleteReview ? <>
            <div className="github-repo-management-tabs" role="tablist" aria-label={t('github.repoManagementViews')}>
              <button type="button" role="tab" aria-selected={repoManagementView === 'create'} disabled={repoManagementBusy} onClick={() => switchRepoManagementView('create')}>
                {t('github.repoCreateTab')}
              </button>
              <button type="button" role="tab" aria-selected={repoManagementView === 'delete'} disabled={repoManagementBusy} onClick={() => switchRepoManagementView('delete')}>
                {t('github.repoDeleteTab')}
              </button>
            </div>
            <div className="github-repo-management-content">
              {repoManagementView === 'create' ? <>
                <p className="github-inline-status">{t('github.repoCreateHelp')}</p>
                <form className="github-repo-lifecycle-form" onSubmit={handleReviewRepoCreate}>
                  <label htmlFor="github-repo-create-name">{t('github.repoName')}</label>
                  <input id="github-repo-create-name" autoFocus maxLength={100} required value={repoCreateForm.name} onChange={(event) => {
                    const name = event.currentTarget.value;
                    setRepoCreateForm((current) => ({ ...current, name }));
                  }} />
                  <label htmlFor="github-repo-create-description">{t('github.repoDescription')}</label>
                  <textarea id="github-repo-create-description" maxLength={350} value={repoCreateForm.description ?? ''} onChange={(event) => {
                    const description = event.currentTarget.value;
                    setRepoCreateForm((current) => ({ ...current, description }));
                  }} />
                  <label htmlFor="github-repo-visibility">{t('github.repoVisibility')}</label>
                  <select id="github-repo-visibility" value={repoCreateForm.visibility ?? 'private'} onChange={(event) => {
                    const visibility = event.currentTarget.value as 'private' | 'public';
                    setRepoCreateForm((current) => ({ ...current, visibility }));
                  }}>
                    <option value="private">{t('github.private')}</option>
                    <option value="public">{t('github.public')}</option>
                  </select>
                  <label className="github-checkbox-label">
                    <input type="checkbox" checked={repoCreateForm.readme === true} onChange={(event) => {
                      const readme = event.currentTarget.checked;
                      setRepoCreateForm((current) => ({ ...current, readme }));
                    }} />
                    <span>{t('github.repoReadme')}</span>
                  </label>
                  <label htmlFor="github-repo-gitignore">{t('github.repoGitignore')}</label>
                  <select id="github-repo-gitignore" value={repoCreateForm.gitignoreTemplate ?? ''} onChange={(event) => {
                    const gitignoreTemplate = event.currentTarget.value || null;
                    setRepoCreateForm((current) => ({ ...current, gitignoreTemplate }));
                  }}>
                    <option value="">{t('github.repoNoTemplate')}</option>
                    {(repoTemplates?.gitignore ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <label htmlFor="github-repo-license">{t('github.repoLicense')}</label>
                  <select id="github-repo-license" value={repoCreateForm.licenseTemplate ?? ''} onChange={(event) => {
                    const licenseTemplate = event.currentTarget.value || null;
                    setRepoCreateForm((current) => ({ ...current, licenseTemplate }));
                  }}>
                    <option value="">{t('github.repoNoTemplate')}</option>
                    {(repoTemplates?.licenses ?? []).map((license) => <option key={license.key} value={license.key}>{license.name}</option>)}
                  </select>
                  {!repoTemplates && repoManagementBusy && <p className="github-inline-status" role="status">{t('github.repoCatalogLoading')}</p>}
                  {repoTemplates && !repoTemplates.complete && <p className="github-inline-warning" role="status">{t('github.repoCatalogIncomplete')}</p>}
                  <p className="github-inline-status">{t('github.repoInitialCommitNote')}</p>
                  <button type="submit" className="github-primary-button" disabled={repoManagementBusy || !repoCreateForm.name.trim()}>{t('github.reviewRepoCreate')}</button>
                </form>
                {repoCreateResult && <section className="github-repo-result" role={repoCreateResult.status === 'created' ? 'status' : 'alert'}>
                  <strong>{t(`github.repoCreateStatus.${repoCreateResult.status}`)}</strong>
                  <p>{repoCreateOutcomeMessage(repoCreateResult)}</p>
                  {repoCreateResult.status === 'created' && <dl>
                    <dt>{t('github.repoResultAccount')}</dt><dd>{connection.account.login} · {connection.account.id}</dd>
                    <dt>{t('github.repoResultTarget')}</dt><dd>{repoCreateResult.readback.fullName} · {repoCreateResult.readback.private ? t('github.private') : t('github.public')}</dd>
                    <dt>{t('github.repoResultId')}</dt><dd>{repoCreateResult.readback.id}</dd>
                    <dt>{t('github.repoResultBranch')}</dt><dd>{repoCreateResult.readback.branchExists ? repoCreateResult.readback.defaultBranch : t('github.repoNoBranchYet')}</dd>
                    <dt>{t('github.repoResultInitialCommit')}</dt><dd>{repoCreateResult.initialCommitRequested ? t('github.repoInitialCommitCreated') : t('github.repoInitialCommitNotRequested')}</dd>
                    <dt>{t('github.repoResultApplied')}</dt><dd>{t('github.repoCreateRequiresSelection')}</dd>
                  </dl>}
                </section>}
              </> : <>
                <p className="github-inline-warning">{t('github.repoDeleteHelp')}</p>
                <p className="github-inline-status">{t('github.localDismissNotice')}</p>
                <label className="github-repo-lifecycle-label" htmlFor="github-repo-delete-selection">{t('github.repoDeleteSelect')}</label>
                <select id="github-repo-delete-selection" value={repoDeleteRepoId} disabled={repoManagementBusy} onChange={(event) => {
                  setRepoDeleteRepoId(event.currentTarget.value);
                  setRepoDeleteSnapshot(null);
                  setRepoDeleteName('');
                  setRepoDeleteReview(null);
                  setRepoDeleteResult(null);
                  setRepoManagementMessage('');
                  setRepoManagementError('');
                }}>
                  <option value="">{t('github.repoDeleteSelectPlaceholder')}</option>
                  {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.ownerLogin}/{repo.name} · {repo.private ? t('github.private') : t('github.public')}</option>)}
                </select>
                {repos.length === 0 && <p className="github-empty-prompt">{t('github.noRepos')}</p>}
                <button type="button" className="github-secondary-button" disabled={!selectedDeleteRepo || repoManagementBusy} onClick={() => void handleCaptureDeleteSnapshot()}>
                  {repoManagementBusy ? t('github.statusChecking') : t('github.verifyDeleteTarget')}
                </button>
                {deleteSnapshotCurrent && repoDeleteSnapshot && <section className="github-repo-delete-snapshot" aria-label={t('github.repoDeleteSnapshot')}>
                  <p>{t('github.repoDeleteReadonlySummary')}</p>
                  <dl>
                    <dt>{t('github.repoResultAccount')}</dt><dd>{repoDeleteSnapshot.accountLogin} · {repoDeleteSnapshot.accountId}</dd>
                    <dt>{t('github.repoResultTarget')}</dt><dd>{repoDeleteSnapshot.fullName} · {repoDeleteSnapshot.private ? t('github.private') : t('github.public')}</dd>
                    <dt>{t('github.repoResultId')}</dt><dd>{repoDeleteSnapshot.repoId}</dd>
                    <dt>{t('github.repoDeletePermission')}</dt><dd>{repoDeleteSnapshot.permission === 'admin' ? t('github.repoDeleteAdminVerified') : t('github.repoDeletePermissionMissing')}</dd>
                    <dt>{t('github.repoDeleteScopes')}</dt><dd>{repoDeleteSnapshot.grantedScopes.length ? repoDeleteSnapshot.grantedScopes.join(', ') : t('github.repoDeleteNoScopes')}</dd>
                  </dl>
                </section>}
                {deleteSnapshotCurrent && repoDeleteSnapshot && !deleteScopeGranted && <div className="github-repo-scope-elevation">
                  <p>{t('github.repoDeleteScopeNeeded')}</p>
                  <button type="button" className="github-secondary-button" disabled={repoManagementBusy} onClick={() => void handleBeginDeleteScopeElevation()}>{t('github.repoRequestDeleteScope')}</button>
                </div>}
                {deleteSnapshotCurrent && repoDeleteSnapshot && <>
                  <label className="github-repo-lifecycle-label" htmlFor="github-repo-delete-exact">{t('github.repoDeleteTypeTarget')}</label>
                  <input id="github-repo-delete-exact" autoComplete="off" spellCheck={false} value={repoDeleteName} onChange={(event) => setRepoDeleteName(event.currentTarget.value)} />
                  <button type="button" className="github-danger-button" disabled={!canReviewRepoDelete} onClick={handleReviewRepoDelete}>{t('github.repoReviewPermanentDelete')}</button>
                </>}
                {repoDeleteResult && <section className="github-repo-result" role={repoDeleteResult.status === 'deleted' ? 'status' : 'alert'}>
                  <strong>{t(`github.repoDeleteStatus.${repoDeleteResult.status}`)}</strong>
                  <p>{repoDeleteOutcomeMessage(repoDeleteResult)}</p>
                  {'draftsRetained' in repoDeleteResult && repoDeleteResult.draftsRetained && <p>{t('github.repoDeleteDraftsRetained')}</p>}
                  {repoDeleteResult.status === 'needs_scope' && repoDeleteSnapshot && <button type="button" className="github-secondary-button" disabled={repoManagementBusy} onClick={() => void handleBeginDeleteScopeElevation()}>{t('github.repoRequestDeleteScope')}</button>}
                </section>}
              </>}
            </div>
            {(repoManagementMessage || repoManagementError) && <p className={repoManagementError ? 'github-error-message' : 'github-inline-status'} role={repoManagementError ? 'alert' : 'status'}>{repoManagementError || repoManagementMessage}</p>}
          </> : repoCreateReview ? <section className="github-repo-confirm-content">
            <h3 id="github-repo-create-confirm-title">{t('github.repoCreateConfirmTitle')}</h3>
            <p>{t('github.repoCreateConfirmHelp')}</p>
            <dl>
              <dt>{t('github.repoResultAccount')}</dt><dd>{repoCreateReview.ownerLogin} · {repoCreateReview.accountId}</dd>
              <dt>{t('github.repoResultTarget')}</dt><dd>{repoCreateReview.ownerLogin}/{repoCreateReview.form.name} · {t(repoCreateReview.form.visibility === 'public' ? 'github.public' : 'github.private')}</dd>
              <dt>{t('github.repoDescription')}</dt><dd>{repoCreateReview.form.description || t('github.repoNoDescription')}</dd>
              <dt>{t('github.repoReadme')}</dt><dd>{repoCreateReview.form.readme ? t('github.yes') : t('github.no')}</dd>
              <dt>{t('github.repoGitignore')}</dt><dd>{repoCreateReview.form.gitignoreTemplate || t('github.repoNoTemplate')}</dd>
              <dt>{t('github.repoLicense')}</dt><dd>{repoTemplates?.licenses.find((license) => license.key === repoCreateReview.form.licenseTemplate)?.name ?? t('github.repoNoTemplate')}</dd>
            </dl>
            <div className="github-repo-confirm-actions">
              <button type="button" className="github-secondary-button" disabled={repoManagementBusy} onClick={() => setRepoCreateReview(null)}>{t('github.cancel')}</button>
              <button type="button" className="github-primary-button" autoFocus disabled={repoManagementBusy} onClick={() => void handleConfirmRepoCreate()}>
                {t('github.repoConfirmCreateButton', { target: `${repoCreateReview.ownerLogin}/${repoCreateReview.form.name}` })}
              </button>
            </div>
          </section> : repoDeleteReview ? <section className="github-repo-confirm-content">
            <h3 id="github-repo-delete-confirm-title">{t('github.repoDeleteConfirmTitle')}</h3>
            <p>{t('github.repoDeleteConfirmHelp')}</p>
            <dl>
              <dt>{t('github.repoResultAccount')}</dt><dd>{repoDeleteReview.snapshot.accountLogin} · {repoDeleteReview.snapshot.accountId}</dd>
              <dt>{t('github.repoResultTarget')}</dt><dd>{repoDeleteReview.snapshot.fullName}</dd>
              <dt>{t('github.repoResultId')}</dt><dd>{repoDeleteReview.snapshot.repoId}</dd>
              <dt>{t('github.repoDeletePermission')}</dt><dd>{t('github.repoDeleteAdminVerified')}</dd>
              <dt>{t('github.repoDeleteScopes')}</dt><dd>{repoDeleteReview.snapshot.grantedScopes.join(', ')}</dd>
            </dl>
            <div className="github-repo-confirm-actions">
              <button type="button" className="github-secondary-button" disabled={repoManagementBusy} onClick={() => setRepoDeleteReview(null)}>{t('github.cancel')}</button>
              <button type="button" className="github-danger-button" autoFocus disabled={repoManagementBusy || repoDeleteReview.typedOwnerRepo !== repoDeleteReview.snapshot.fullName} onClick={() => void handleConfirmRepoDelete()}>
                {t('github.repoConfirmPermanentDeleteButton', { target: repoDeleteReview.snapshot.fullName })}
              </button>
            </div>
          </section> : null}
        </section>
      </div>}
    </div>
  );
}

function GithubMessageScreen({ title, message }: { title: string; message: string }) {
  return (
    <section className="github-mode github-message-screen" aria-labelledby="github-message-title">
      <div className="github-message-card">
        <h1 id="github-message-title">{title}</h1>
        <p>{message}</p>
      </div>
    </section>
  );
}
