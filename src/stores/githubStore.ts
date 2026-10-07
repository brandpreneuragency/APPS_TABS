import { create } from 'zustand'
import { publicGithubError } from '../services/github/errors'
import { createProductionGithubService, type GithubService } from '../services/github/service'
import { noteGithubTarget } from '../services/github/aiEgress'
import type {
  DeviceBrowserChallenge,
  DraftDeletionRequest,
  GithubAccountWorkspace,
  GithubBranch,
  GithubBranchWorkspace,
  GithubConnection,
  GithubDraft,
  GithubEntry,
  GithubErrorCode,
  GithubOpenedFile,
  GithubPanelLayout,
  GithubRepo,
  SaveDraftInput,
  CommitConfirmation,
  CommitResult,
  GithubAiPreparation,
  GithubAiPurpose,
  GithubCommitSummary,
  GithubCommitDetail,
  GithubConflictChoice,
  GithubSearchResult,
  RemoteRefresh,
  RepoCreateInput,
  RepoCreateResult,
  RepoDeleteConfirmation,
  RepoDeleteResult,
  RepoDeleteSnapshot,
  RepoTemplateCatalog,
  DeviceLoginOpen,
} from '../services/github/types'

export interface GithubStoreState {
  connection: GithubConnection
  repos: GithubRepo[]
  reposComplete: boolean
  branches: GithubBranch[]
  entries: GithubEntry[]
  entriesComplete: boolean
  entriesMessage: string | null
  openedFile: GithubOpenedFile | null
  drafts: GithubDraft[]
  accountWorkspace: GithubAccountWorkspace | null
  branchWorkspace: GithubBranchWorkspace | null
  remote: RemoteRefresh | null
  search: GithubSearchResult | null
  history: GithubCommitSummary[]
  commitDetail: GithubCommitDetail | null
  commitResult: CommitResult | null
  repoTemplates: RepoTemplateCatalog | null
  preparedAi: GithubAiPreparation | null
  aiConsent: boolean
  aiCommitMessage: string | null
  lastError: { code: GithubErrorCode; message: string } | null
  busy: boolean
  configureClientId: (clientId: string) => Promise<void>
  clearClientId: () => Promise<void>
  beginDeviceBrowserSignIn: () => Promise<DeviceBrowserChallenge>
  finishDeviceBrowserSignIn: () => Promise<void>
  cancelSignIn: () => void
  signOut: () => Promise<void>
  deleteDrafts: (request: DraftDeletionRequest) => Promise<void>
  refreshRepos: () => Promise<void>
  selectRepo: (repoId: string, ref: string) => Promise<void>
  selectBranch: (repoId: string, ref: string) => Promise<void>
  closeRepoTab: (repoId: string) => Promise<void>
  browse: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  openDraftPath: (path: string) => Promise<void>
  saveOpenedDraft: (content: { text?: string | null; binaryBase64?: string | null }) => Promise<void>
  saveDraft: (input: SaveDraftInput) => Promise<void>
  setPanel: (panel: GithubPanelLayout) => Promise<void>
  setOpenPaths: (paths: string[]) => Promise<void>
  restore: () => Promise<void>
  cancelActive: () => void
  refreshRemote: () => Promise<void>
  commitSelected: (confirmation: CommitConfirmation) => Promise<CommitResult>
  searchRepository: (query: string) => Promise<void>
  createBranch: (name: string) => Promise<void>
  stageDirectory: (path: string, explicitGitkeep?: boolean) => Promise<void>
  stageUpload: (path: string, bytesBase64: string) => Promise<void>
  resolveConflict: (input: { path: string; choice: GithubConflictChoice; resultText?: string | null; resultBinary?: string | null; resultPath?: string | null }) => Promise<void>
  grantAiConsent: () => Promise<void>
  revokeAiConsent: () => Promise<void>
  prepareAi: (purpose: GithubAiPurpose, path?: string) => Promise<GithubAiPreparation | null>
  loadHistory: () => Promise<void>
  loadCommitDetail: (sha: string) => Promise<GithubCommitDetail>
  downloadBlob: (sha: string) => ReturnType<GithubService['downloadBlob']>
  applyAiDraft: (input: { confirm: true; proposalId: string; text?: string }) => Promise<void>
  clearPreparedAi: () => void
  setAiCommitMessage: (message: string | null) => void
  listRepoTemplates: () => Promise<RepoTemplateCatalog>
  createRepository: (input: RepoCreateInput) => Promise<RepoCreateResult>
  captureDeleteSnapshot: (repoId: string) => Promise<RepoDeleteSnapshot>
  deleteRepository: (confirmation: RepoDeleteConfirmation) => Promise<RepoDeleteResult>
  beginDeleteScopeElevation: () => Promise<DeviceBrowserChallenge>
  openDeviceLogin: () => Promise<DeviceLoginOpen>
  dismissLocalRepo: (repoId: string) => Promise<void>
}

function failure(error: unknown): { code: GithubErrorCode; message: string } {
  const pub = publicGithubError(error)
  return { code: pub.code, message: pub.message }
}

export function createGithubStore(service: GithubService) {
  let active: AbortController | null = null
  const nextSignal = () => {
    active?.abort()
    active = new AbortController()
    return active.signal
  }

  return create<GithubStoreState>((set, get) => ({
    connection: { status: 'needs_setup' },
    repos: [],
    reposComplete: true,
    branches: [],
    entries: [],
    entriesComplete: true,
    entriesMessage: null,
    openedFile: null,
    drafts: [],
    accountWorkspace: null,
    branchWorkspace: null,
    remote: null,
    search: null,
    history: [],
    commitDetail: null,
    commitResult: null,
    repoTemplates: null,
    preparedAi: null,
    aiConsent: false,
    aiCommitMessage: null,
    lastError: null,
    busy: false,

    async configureClientId(clientId) {
      await service.configureClientId(clientId)
      set({ connection: service.getConnection(), lastError: null })
    },

    async clearClientId() {
      await service.clearClientId()
      set({ connection: service.getConnection() })
    },

    async beginDeviceBrowserSignIn() {
      try {
        const challenge = await service.beginDeviceBrowserSignIn()
        set({ connection: service.getConnection(), lastError: null })
        return challenge
      } catch (error) {
        set({ connection: service.getConnection(), lastError: failure(error) })
        throw error
      }
    },

    async finishDeviceBrowserSignIn() {
      set({ busy: true, lastError: null })
      try {
        await service.finishDeviceBrowserSignIn()
        const hydration = await service.hydrate()
        set({ connection: hydration.connection, drafts: hydration.drafts, accountWorkspace: hydration.accountWorkspace, busy: false })
      } catch (error) {
        set({ connection: service.getConnection(), busy: false, lastError: failure(error) })
        throw error
      }
    },

    cancelSignIn() {
      service.cancelSignIn()
      set({ connection: service.getConnection() })
    },

    async signOut() {
      const connection = get().connection
      if (connection.status === 'connected') {
        // Invalidate queued provider turns before the account context disappears.
        noteGithubTarget(connection.account.id, '__signed_out__', '')
      }
      await service.signOut()
      const drafts = await service.listDrafts()
      set({
        connection: service.getConnection(),
        repos: [],
        branches: [],
        entries: [],
        openedFile: null,
        drafts,
        accountWorkspace: null,
        branchWorkspace: null,
        remote: null,
        search: null,
        history: [],
        commitDetail: null,
        preparedAi: null,
        aiConsent: false,
        aiCommitMessage: null,
      })
    },

    async deleteDrafts(request) {
      await service.deleteDrafts(request)
      set({ drafts: await service.listDrafts() })
    },

    async refreshRepos() {
      const signal = nextSignal()
      set({ busy: true, lastError: null })
      try {
        const page = await service.listPersonalRepos(signal)
        if (signal.aborted) return
        set({ repos: page.items, reposComplete: page.complete, busy: false, lastError: page.error })
      } catch (error) {
        if (signal.aborted) return
        set({ busy: false, lastError: failure(error) })
        throw error
      }
    },

    async selectRepo(repoId, ref) {
      const workspace = await service.setActiveRepo(repoId, ref)
      const branchWorkspace = await service.getBranchWorkspace(repoId, ref)
      const connection = service.getConnection()
      const aiConsent = connection.status === 'connected' && service.hasAiConsent(connection.account.id, repoId)
      set({ accountWorkspace: workspace, branchWorkspace, connection, preparedAi: null, remote: null, search: null, history: [], commitDetail: null, commitResult: null, aiConsent, aiCommitMessage: null })
    },

    async selectBranch(repoId, ref) {
      await get().selectRepo(repoId, ref)
      const signal = nextSignal()
      const page = await service.listBranches(repoId, signal)
      if (!signal.aborted) {
        const connection = service.getConnection()
        set({ branches: page.items, lastError: page.error, preparedAi: null, remote: null, search: null, history: [], commitDetail: null, commitResult: null, aiCommitMessage: null,
          aiConsent: connection.status === 'connected' && service.hasAiConsent(connection.account.id, repoId) })
      }
    },

    async closeRepoTab(repoId) {
      const wasActive = get().accountWorkspace?.activeRepoId === repoId
      if (wasActive) get().cancelActive()
      const accountWorkspace = await service.closeRepoTab(repoId)
      const activeRepoId = accountWorkspace.activeRepoId
      const activeRef = activeRepoId ? accountWorkspace.activeRefByRepo[activeRepoId] : undefined
      const branchWorkspace = activeRepoId && activeRef
        ? await service.getBranchWorkspace(activeRepoId, activeRef)
        : null
      set({
        accountWorkspace,
        branchWorkspace,
        ...(wasActive ? {
          branches: [],
          entries: [],
          entriesComplete: true,
          entriesMessage: null,
          openedFile: null,
          lastError: null,
          preparedAi: null,
          remote: null,
          search: null,
          history: [],
          commitDetail: null,
          commitResult: null,
          aiConsent: false,
          aiCommitMessage: null,
        } : {}),
      })
    },

    async browse(path) {
      const workspace = get().accountWorkspace
      const ref = workspace?.activeRepoId ? workspace.activeRefByRepo[workspace.activeRepoId] : undefined
      if (!workspace?.activeRepoId || !ref) throw new Error('No GitHub repository is selected')
      const signal = nextSignal()
      set({ busy: true, lastError: null })
      try {
        const page = await service.listEntries(workspace.activeRepoId, ref, path, signal)
        if (signal.aborted) return
        set({ entries: page.items, entriesComplete: page.complete, entriesMessage: page.message, busy: false, lastError: page.error })
      } catch (error) {
        if (signal.aborted) return
        set({ busy: false, lastError: failure(error) })
        throw error
      }
    },

    async openPath(path) {
      const workspace = get().accountWorkspace
      const ref = workspace?.activeRepoId ? workspace.activeRefByRepo[workspace.activeRepoId] : undefined
      if (!workspace?.activeRepoId || !ref) throw new Error('No GitHub repository is selected')
      const signal = nextSignal()
      set({ busy: true, lastError: null })
      try {
        const openedFile = await service.openFile(workspace.activeRepoId, ref, path, signal)
        if (signal.aborted) return
        set({
          openedFile,
          accountWorkspace: await service.getAccountWorkspace(),
          branchWorkspace: await service.getBranchWorkspace(workspace.activeRepoId, ref),
          busy: false,
          preparedAi: null,
        })
      } catch (error) {
        if (signal.aborted) return
        set({ busy: false, lastError: failure(error) })
        throw error
      }
    },

    async openDraftPath(path) {
      const target = activeTarget(get())
      const connection = get().connection
      const accountId = connection.status === 'connected' ? connection.account.id : null
      if (!target || !accountId) throw new Error('No GitHub repository is selected')
      const drafts = await service.listDrafts({ accountId, repoId: target.repoId, ref: target.ref })
      const draft = drafts.find((item) => item.path === path || item.newPath === path)
      if (!draft) return get().openPath(path)
      const selectedPath = draft.path
      const previous = await service.getBranchWorkspace(target.repoId, target.ref)
      const branchWorkspace = await service.setBranchWorkspace(target.repoId, target.ref, {
        selectedPath,
        openPaths: [...new Set([...(previous?.openPaths ?? []), selectedPath])],
      })
      const repo = get().repos.find((item) => item.id === target.repoId)
      const openedFile: GithubOpenedFile = {
        accountId,
        repoId: target.repoId,
        ref: target.ref,
        path: selectedPath,
        kind: draft.binary ? 'binary' : 'text',
        text: draft.binary ? null : draft.newText ?? draft.originalText,
        binaryBase64: draft.binary ? draft.newBinary ?? draft.originalBinary : null,
        baseCommitSha: draft.baseCommitSha,
        baseBlobSha: draft.baseBlobSha,
        remoteBlobSha: draft.baseBlobSha,
        draft,
        byteLength: draft.binary
          ? Math.floor((draft.newBinary ?? draft.originalBinary ?? '').length * 3 / 4)
          : new TextEncoder().encode(draft.newText ?? '').length,
        private: repo?.private ?? false,
        message: null,
        mediaKind: draft.binary ? 'binary' : 'text',
      }
      set({ openedFile, branchWorkspace, preparedAi: null, lastError: null })
    },

    async saveOpenedDraft(content) {
      const opened = get().openedFile
      if (!opened || opened.baseCommitSha === null) throw new Error('Open a GitHub file before saving a draft')
      const draft = await service.saveDraft({
        repoId: opened.repoId,
        ref: opened.ref,
        path: opened.path,
        baseCommitSha: opened.baseCommitSha,
        baseBlobSha: opened.baseBlobSha,
        originalText: opened.draft?.originalText ?? opened.text,
        originalBinary: opened.draft?.originalBinary ?? opened.binaryBase64,
        newText: content.text,
        newBinary: content.binaryBase64,
        binary: opened.kind === 'binary',
        operation: opened.draft?.operation ?? 'edit',
        newPath: opened.draft?.newPath ?? null,
        ...(opened.draft ? { expectedEditVersion: opened.draft.editVersion } : {}),
      })
      set({
        drafts: await service.listDrafts({ accountId: draft.accountId }),
        openedFile: { ...opened, draft, text: draft.newText ?? opened.text, binaryBase64: draft.newBinary ?? opened.binaryBase64 },
        preparedAi: null,
      })
    },

    async saveDraft(input) {
      const draft = await service.saveDraft(input)
      const openedFile = get().openedFile
      const updatedOpenedFile = openedFile?.repoId === draft.repoId && openedFile.ref === draft.ref && openedFile.path === draft.path
        ? { ...openedFile, draft, text: draft.newText ?? openedFile.text, binaryBase64: draft.newBinary ?? openedFile.binaryBase64 }
        : null
      set({
        drafts: await service.listDrafts({ accountId: draft.accountId }),
        ...(updatedOpenedFile ? { openedFile: updatedOpenedFile } : {}),
        preparedAi: null,
      })
    },

    async setPanel(panel) {
      const workspace = get().accountWorkspace
      const ref = workspace?.activeRepoId ? workspace.activeRefByRepo[workspace.activeRepoId] : undefined
      if (!workspace?.activeRepoId || !ref) return
      const branchWorkspace = await service.setBranchWorkspace(workspace.activeRepoId, ref, { panel })
      set({ branchWorkspace })
    },

    async setOpenPaths(paths) {
      const workspace = get().accountWorkspace
      const ref = workspace?.activeRepoId ? workspace.activeRefByRepo[workspace.activeRepoId] : undefined
      if (!workspace?.activeRepoId || !ref) return
      const branchWorkspace = await service.setBranchWorkspace(workspace.activeRepoId, ref, { openPaths: paths })
      set({ branchWorkspace })
    },

    async restore() {
      const hydration = await service.hydrate()
      const ref = hydration.accountWorkspace?.activeRepoId
        ? hydration.accountWorkspace.activeRefByRepo[hydration.accountWorkspace.activeRepoId]
        : undefined
      const branchWorkspace = hydration.accountWorkspace?.activeRepoId && ref
        ? await service.getBranchWorkspace(hydration.accountWorkspace.activeRepoId, ref)
        : null
      set({
        connection: hydration.connection,
        drafts: hydration.drafts,
        accountWorkspace: hydration.accountWorkspace,
        branchWorkspace,
        lastError: null,
      })
    },

    cancelActive() {
      active?.abort()
      active = null
      set({ busy: false })
    },

    async refreshRemote() {
      const target = activeTarget(get())
      if (!target) return
      const remote = await service.refreshRemote(target.repoId, target.ref)
      const drafts = await service.listDrafts()
      const current = activeTarget(get())
      if (!current || current.repoId !== target.repoId || current.ref !== target.ref) return
      set({ remote, drafts, lastError: null, preparedAi: null })
    },

    async commitSelected(confirmation) {
      const result = await service.commitSelected(confirmation)
      set({ commitResult: result, drafts: await service.listDrafts(), lastError: result.status === 'sent' ? null : { code: result.status === 'blocked' ? result.code : result.status === 'protected_branch' ? 'protected_branch' : result.status === 'conflict' ? 'conflict' : 'github_unavailable', message: 'message' in result ? result.message : 'Commit was not sent' } })
      return result
    },

    async searchRepository(query) {
      const target = activeTarget(get())
      if (!target) return
      const search = await service.searchRepository(target.repoId, target.ref, query)
      const current = activeTarget(get())
      if (!current || current.repoId !== target.repoId || current.ref !== target.ref) return
      set({ search, lastError: search.error })
    },

    async createBranch(name) {
      const target = activeTarget(get())
      if (!target) return
      await service.createBranch(target.repoId, name, target.ref)
      const page = await service.listBranches(target.repoId)
      const current = activeTarget(get())
      if (current?.repoId === target.repoId && current.ref === target.ref) set({ branches: page.items, lastError: page.error })
    },

    async stageDirectory(path, explicitGitkeep = false) {
      const target = activeTarget(get())
      if (!target) return
      const opened = get().openedFile
      const remote = get().remote
      const base = opened?.repoId === target.repoId && opened.ref === target.ref
        ? opened.baseCommitSha ?? ''
        : remote?.repoId === target.repoId && remote.ref === target.ref
          ? remote.remoteCommitSha ?? ''
          : ''
      // An empty string is the explicit snapshot for an empty repository.
      await service.stageDirectory({ repoId: target.repoId, ref: target.ref, path, explicitGitkeep, baseCommitSha: base })
      set({ drafts: await service.listDrafts() })
    },

    async stageUpload(path, bytesBase64) {
      const target = activeTarget(get())
      if (!target) return
      const opened = get().openedFile
      const remote = get().remote
      const base = opened?.repoId === target.repoId && opened.ref === target.ref
        ? opened.baseCommitSha ?? ''
        : remote?.repoId === target.repoId && remote.ref === target.ref
          ? remote.remoteCommitSha ?? ''
          : ''
      await service.stageUpload({ repoId: target.repoId, ref: target.ref, path, bytesBase64, baseCommitSha: base })
      set({ drafts: await service.listDrafts() })
    },

    async resolveConflict(input) {
      const target = activeTarget(get())
      if (!target) return
      await service.resolveConflict({ confirm: true, repoId: target.repoId, ref: target.ref, ...input })
      set({ drafts: await service.listDrafts() })
    },

    async grantAiConsent() {
      const connection = get().connection
      const accountId = connection.status === 'connected' ? connection.account.id : null
      const repoId = get().accountWorkspace?.activeRepoId
      if (!accountId || !repoId) return
      await service.grantAiConsent(accountId, repoId)
      set({ aiConsent: true, preparedAi: null })
    },

    async revokeAiConsent() {
      const connection = get().connection
      const accountId = connection.status === 'connected' ? connection.account.id : null
      const repoId = get().accountWorkspace?.activeRepoId
      if (!accountId || !repoId) return
      await service.revokeAiConsent(accountId, repoId)
      set({ aiConsent: false, preparedAi: null })
    },

    async prepareAi(purpose, path) {
      const target = activeTarget(get())
      if (!target) return null
      const prepared = await service.prepareAi({ purpose, repoId: target.repoId, ref: target.ref, path })
      const current = activeTarget(get())
      if (!current || current.repoId !== target.repoId || current.ref !== target.ref) return null
      if (prepared.blocked) {
        set({ preparedAi: prepared })
        return prepared
      }
      const connection = get().connection
      const accountId = connection.status === 'connected' ? connection.account.id : prepared.accountId
      const drafts = await service.listDrafts({ accountId, repoId: target.repoId, ref: target.ref })
      const opened = get().openedFile
      const selectedPath = path ?? (opened?.repoId === target.repoId && opened.ref === target.ref ? opened.path : undefined)
      const selectedDraft = selectedPath ? drafts.find((item) => item.path === selectedPath) : null
      const textDrafts = purpose === 'suggest_commit_message'
        ? drafts.filter((item) => !item.binary && item.operation !== 'delete')
        : selectedDraft && !selectedDraft.binary && selectedDraft.operation !== 'delete' ? [selectedDraft] : []
      const fileText = selectedDraft && !selectedDraft.binary
        ? selectedDraft.newText ?? selectedDraft.originalText
        : opened?.repoId === target.repoId && opened.ref === target.ref && opened.path === selectedPath && opened.kind === 'text'
          ? opened.text
          : null
      const diffText = textDrafts.length
        ? textDrafts.map((draft) => `--- ${draft.path}\n+++ ${draft.newPath ?? draft.path}\n${draft.originalText ?? ''}\n${draft.newText ?? ''}`).join('\n\n')
        : null
      const relevantText = purpose === 'suggest_commit_message' || purpose === 'review_diff' ? diffText : fileText
      if (!relevantText) {
        const missing = {
          ...prepared,
          blocked: true,
          packet: null,
          proposalId: null,
          warning: 'Open or save a text file draft before sending GitHub content to AI.',
        }
        set({ preparedAi: missing })
        return missing
      }
      const packet = [
        `GitHub ${purpose} for repository ${target.repoId} ref ${target.ref}${selectedPath ? ` path ${selectedPath}` : ''}.`,
        purpose === 'suggest_commit_message' || purpose === 'review_diff'
          ? `[DIFF]\n${diffText ?? ''}`
          : `[FILE]\n${fileText ?? ''}`,
        prepared.warning,
      ].filter(Boolean).join('\n\n')
      const result = { ...prepared, packet }
      set({ preparedAi: result })
      return result
    },

    async loadHistory() {
      const target = activeTarget(get())
      if (!target) return
      const page = await service.commitHistory(target.repoId, target.ref)
      const current = activeTarget(get())
      if (!current || current.repoId !== target.repoId || current.ref !== target.ref) return
      set({ history: page.items, lastError: page.error })
    },

    async loadCommitDetail(sha) {
      const target = activeTarget(get())
      if (!target) throw new Error('No GitHub repository is selected')
      const detail = await service.commitDetail(target.repoId, sha)
      const current = activeTarget(get())
      if (!current || current.repoId !== target.repoId || current.ref !== target.ref) throw new Error('The repository or branch changed while loading history')
      set({ commitDetail: detail, lastError: null })
      return detail
    },

    downloadBlob(sha) {
      const target = activeTarget(get())
      if (!target) return Promise.reject(new Error('No GitHub repository is selected'))
      return service.downloadBlob(target.repoId, sha)
    },

    async applyAiDraft(input) {
      if (input.confirm !== true) throw new Error('Applying an AI draft requires explicit confirmation')
      const proposed = await service.applyAiDraft({ confirm: true, proposalId: input.proposalId })
      let saved = proposed
      if (input.text !== undefined) {
        saved = await service.saveDraft({
          ...proposed,
          newText: input.text,
          binary: false,
          expectedEditVersion: proposed.editVersion,
        })
      }
      const opened = get().openedFile
      const updatedOpenedFile = opened?.repoId === saved.repoId && opened.ref === saved.ref && opened.path === saved.path
        ? { ...opened, draft: saved, text: saved.newText ?? opened.text }
        : null
      set({
        drafts: await service.listDrafts({ accountId: saved.accountId }),
        ...(updatedOpenedFile ? { openedFile: updatedOpenedFile } : {}),
        preparedAi: null,
      })
    },

    clearPreparedAi() {
      set({ preparedAi: null })
    },

    setAiCommitMessage(message) {
      set({ aiCommitMessage: message })
    },

    async listRepoTemplates() {
      const catalog = await service.listRepoTemplates()
      set({ repoTemplates: catalog })
      set({ lastError: catalog.complete ? null : { code: 'github_unavailable', message: catalog.message ?? 'Templates are incomplete' } })
      return catalog
    },

    async createRepository(input) {
      const before = get().connection
      const accountId = before.status === 'connected' ? before.account.id : null
      const result = await service.createRepository(input)
      const after = service.getConnection()
      set({ connection: after })
      const still = after.status === 'connected' && after.account.id === accountId
      if (!still) return { ...result, appliedToActive: false }
      set({ lastError: result.status === 'blocked' ? { code: result.code, message: result.message } : null })
      return result
    },

    async captureDeleteSnapshot(repoId) {
      try {
        const snapshot = await service.captureDeleteSnapshot(repoId)
        set({ lastError: null })
        return snapshot
      } catch (error) {
        set({ connection: service.getConnection(), lastError: failure(error) })
        throw error
      }
    },

    async deleteRepository(confirmation) {
      const result = await service.deleteRepository(confirmation)
      set({
        connection: service.getConnection(),
        lastError: result.status === 'blocked' ? { code: result.code, message: result.message } : null,
      })
      return result
    },

    async beginDeleteScopeElevation() {
      try {
        const challenge = await service.beginDeleteScopeElevation()
        set({ connection: service.getConnection(), lastError: null })
        return challenge
      } catch (error) {
        set({ connection: service.getConnection(), lastError: failure(error) })
        throw error
      }
    },

    openDeviceLogin() {
      return service.openDeviceLogin()
    },

    async dismissLocalRepo(repoId) {
      await get().closeRepoTab(repoId)
    },
  }))
}

function activeTarget(state: { accountWorkspace: { activeRepoId: string | null; activeRefByRepo: Record<string, string> } | null }) {
  const repoId = state.accountWorkspace?.activeRepoId
  const ref = repoId ? state.accountWorkspace?.activeRefByRepo[repoId] : undefined
  return repoId && ref ? { repoId, ref } : null
}

export const useGithubStore = createGithubStore(createProductionGithubService())
