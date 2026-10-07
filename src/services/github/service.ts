import type { TabsDB } from '../db'
import {
  apiGet,
  branchUrl,
  branchesUrl,
  classifyFile,
  contentsUrl,
  deviceCodeRequest,
  devicePollRequest,
  mapAccount,
  mapBranches,
  mapEntries,
  mapRepos,
  oauthErrorCode,
  parseJson,
  parseJsonArray,
  readDeviceStart,
  refreshRequest,
  reposPageUrl,
  repositoryUrl,
  statusError,
} from './api'
import { systemClock } from './clock'
import { GithubError, assertNoClientSecret, assertPublicClientId, isGithubError, publicGithubError } from './errors'
import { accountWorkspaceId, branchWorkspaceId, normalizeRepoPath, privateCacheId, safeRef } from './identity'
import {
  clearClientId,
  deleteDraftRecords,
  getAccount,
  getPrivateCache,
  listDraftRecords,
  putAccount,
  putDraft,
  putPrivateCache,
  readAccountWorkspace,
  readBranchWorkspace,
  readClientId,
  writeAccountWorkspace,
  writeBranchWorkspace,
  writeClientId,
} from './persistence'
import { createCacheKey, openJson, sealJson } from './privateCache'
import { assertVerificationUri, canonicalVerification, inspectGithubUrl, nextLink, pageCap, readRateLimit } from './policy'
import { createNativeGithubTransport, createNativeSecureStore, createPolicyTransport } from './transport'
import {
  DEFAULT_GITHUB_PANEL,
  GITHUB_EMPTY_DIRECTORY_NOTE,
  GITHUB_PHASE1_SCOPE,
  GITHUB_ELEVATED_DELETE_SCOPE,
  GITHUB_SECURE_ACCOUNTS,
  GITHUB_VERIFICATION_URI,
  type DeviceBrowserChallenge,
  type DeviceLoginOpen,
  type DraftDeletionRequest,
  type GithubAccount,
  type GithubAccountWorkspace,
  type GithubBranch,
  type GithubBranchWorkspace,
  type GithubClock,
  type GithubConnection,
  type GithubDraft,
  type GithubEntry,
  type GithubHydration,
  type GithubOpenedFile,
  type GithubPage,
  type GithubRepo,
  type GithubSecureStore,
  type GithubTransport,
  type GithubTransportRequest,
  type GithubTransportResponse,
  type PrivateCacheRead,
  type SaveDraftInput,
  type CommitConfirmation,
  type CommitResult,
  type DirectoryStageResult,
  type GithubAiPreparation,
  type GithubAiPurpose,
  type GithubCommitDetail,
  type GithubCommitSummary,
  type GithubConflictChoice,
  type GithubSearchResult,
  type RemoteRefresh,
  type RepoCreateInput,
  type RepoCreateResult,
  type RepoDeleteConfirmation,
  type RepoDeleteResult,
  type RepoDeleteSnapshot,
  type RepoProposal,
  type RepoTemplateCatalog,
} from './types'
import { noteGithubTarget, grantGithubAiConsent, revokeGithubAiConsent, hasGithubAiConsent, registerGithubMaterial } from './aiEgress'
import { applyDraftProposal, commitDetail as loadCommitDetail, commitHistory as loadCommitHistory, commitSelected as runCommitSelected, createBranch as createRemoteBranch, downloadBlob as downloadAuthenticatedBlob, prepareAiPacket, proposeDraftEdit, refreshRemote as refreshRemoteState, rejectUnconfirmedRemoteMutation, resolveConflict as resolveDraftConflict, searchRepository as searchRepoContent, stageDirectory as stageDirectoryDraft, stageUpload as stageUploadDraft } from './phase2'
import { captureDeleteSnapshot, createPersonalRepo, deletePersonalRepo, listTemplateCatalog, type LifecycleHost } from './lifecycle'
import { createTauriNativeSession, type GithubNativeSession } from './nativeSession'
import { db } from '../db'

const ACTIVE_ACCOUNT_SETTING = 'githubActiveAccountId'

interface DeviceSession {
  deviceCode: string | null
  expiresAt: number
  intervalSeconds: number
  scope: string
  expectedAccountId: string | null
  native: boolean
  flowId: string | null
}

export interface GithubService {
  getConnection(): GithubConnection
  configureClientId(clientId: string): Promise<void>
  clearClientId(): Promise<void>
  beginDeviceBrowserSignIn(): Promise<DeviceBrowserChallenge>
  finishDeviceBrowserSignIn(signal?: AbortSignal): Promise<GithubAccount>
  cancelSignIn(): void
  signOut(): Promise<void>
  deleteDrafts(request: DraftDeletionRequest): Promise<number>
  listPersonalRepos(signal?: AbortSignal): Promise<GithubPage<GithubRepo>>
  listBranches(repoId: string, signal?: AbortSignal): Promise<GithubPage<GithubBranch>>
  listEntries(repoId: string, ref: string, path: string, signal?: AbortSignal): Promise<GithubPage<GithubEntry>>
  openFile(repoId: string, ref: string, path: string, signal?: AbortSignal): Promise<GithubOpenedFile>
  saveDraft(input: SaveDraftInput): Promise<GithubDraft>
  listDrafts(filter?: { accountId?: string; repoId?: string; ref?: string }): Promise<GithubDraft[]>
  getAccountWorkspace(): Promise<GithubAccountWorkspace | null>
  getBranchWorkspace(repoId: string, ref: string): Promise<GithubBranchWorkspace | null>
  setActiveRepo(repoId: string, ref: string): Promise<GithubAccountWorkspace>
  closeRepoTab(repoId: string): Promise<GithubAccountWorkspace>
  setBranchWorkspace(repoId: string, ref: string, update: Partial<Pick<GithubBranchWorkspace, 'openPaths' | 'selectedPath' | 'panel'>>): Promise<GithubBranchWorkspace>
  hydrate(): Promise<GithubHydration>
  readPrivateCache(repoId: string, kind: 'file' | 'listing' | 'repos', extra?: string): Promise<PrivateCacheRead>
  stageDirectory(input: { repoId: string; ref: string; path: string; explicitGitkeep?: boolean; baseCommitSha: string }): Promise<DirectoryStageResult>
  stageUpload(input: { repoId: string; ref: string; path: string; bytesBase64: string; baseCommitSha: string }): Promise<GithubDraft>
  refreshRemote(repoId: string, ref: string, signal?: AbortSignal): Promise<RemoteRefresh>
  resolveConflict(input: { confirm: true; repoId: string; ref: string; path: string; choice: GithubConflictChoice; resultText?: string | null; resultBinary?: string | null; resultPath?: string | null }): Promise<GithubDraft>
  commitSelected(confirmation: CommitConfirmation, signal?: AbortSignal): Promise<CommitResult>
  createBranch(repoId: string, name: string, fromRef: string, signal?: AbortSignal): Promise<GithubBranch>
  commitHistory(repoId: string, ref: string, signal?: AbortSignal): Promise<GithubPage<GithubCommitSummary>>
  commitDetail(repoId: string, sha: string, signal?: AbortSignal): Promise<GithubCommitDetail>
  searchRepository(repoId: string, ref: string, query: string, signal?: AbortSignal): Promise<GithubSearchResult>
  downloadBlob(repoId: string, sha: string, signal?: AbortSignal): Promise<{ base64: string; byteLength: number; mediaKind: 'text' | 'image' | 'pdf' | 'binary' }>
  grantAiConsent(accountId: string, repoId: string): Promise<void>
  revokeAiConsent(accountId: string, repoId: string): Promise<void>
  hasAiConsent(accountId: string, repoId: string): boolean
  prepareAi(input: { purpose: GithubAiPurpose; repoId: string; ref: string; path?: string }): Promise<GithubAiPreparation>
  applyAiDraft(input: { confirm: true; proposalId: string }): Promise<GithubDraft>
  rejectAiRemoteMutation(confirm: unknown): CommitResult
  listRepoTemplates(signal?: AbortSignal): Promise<RepoTemplateCatalog>
  createRepository(input: RepoCreateInput, signal?: AbortSignal): Promise<RepoCreateResult>
  captureDeleteSnapshot(repoId: string, signal?: AbortSignal): Promise<RepoDeleteSnapshot>
  deleteRepository(confirmation: RepoDeleteConfirmation, signal?: AbortSignal): Promise<RepoDeleteResult>
  proposeRepoCreate(input: { accountId: string; ownerLogin: string; repoName: string }): RepoProposal
  proposeRepoDelete(input: { accountId: string; ownerLogin: string; repoName: string; repoId: string }): RepoProposal
  beginDeleteScopeElevation(): Promise<DeviceBrowserChallenge>
  openDeviceLogin(): Promise<DeviceLoginOpen>
  dismissLocalRepo(repoId: string): Promise<GithubAccountWorkspace>
}

export interface GithubServiceDeps {
  database: TabsDB
  transport: GithubTransport
  secureStore: GithubSecureStore
  clock?: GithubClock
  /** Production desktop sets this. Fixture tests omit it and keep the explicit token transport. */
  nativeSession?: GithubNativeSession
}

export function createGithubService(deps: GithubServiceDeps): GithubService {
  const database = deps.database
  const secure = deps.secureStore
  const clock = deps.clock ?? systemClock
  const nativeSession = deps.nativeSession
  const transport = createPolicyTransport(deps.transport, async () => {
    if (nativeSession) return (await nativeSession.hasAccess()) ? 'session' : null
    return (await secure.has(GITHUB_SECURE_ACCOUNTS.access)) ? 'session' : null
  })
  const repos = new Map<string, GithubRepo>()
  let connection: GithubConnection = { status: 'needs_setup' }
  let clientId: string | null = null
  let device: DeviceSession | null = null
  let finishing = false
  let signInAbort: AbortController | null = null
  let writeGeneration = 0
  let authorityToken: string | null = null
  let epochQueue: Promise<unknown> = Promise.resolve()
  const proposals = new Map<string, RepoProposal>()

  function requireAccount(): GithubAccount {
    if (connection.status !== 'connected') throw new GithubError('signed_out', 'GitHub is not signed in')
    return connection.account
  }

  async function rememberAccount(account: GithubAccount): Promise<void> {
    await putAccount(database, { ...account, connectedAt: clock.now() })
    await database.settings.put({ key: ACTIVE_ACCOUNT_SETTING, value: account.id })
    connection = { status: 'connected', account }
  }

  async function sealSession(next: GithubConnection): Promise<void> {
    await secure.delete(GITHUB_SECURE_ACCOUNTS.access)
    await secure.delete(GITHUB_SECURE_ACCOUNTS.refresh)
    await secure.delete(GITHUB_SECURE_ACCOUNTS.cacheKey)
    device = null
    connection = next
  }

  async function cacheKey(): Promise<string | null> {
    try {
      return await secure.get(GITHUB_SECURE_ACCOUNTS.cacheKey)
    } catch (error) {
      if (isGithubError(error) && (error.code === 'native_http_not_linked' || error.code === 'native_unavailable')) return null
      throw error
    }
  }

  async function ensureCacheKey(): Promise<string> {
    const existing = await cacheKey()
    if (existing) return existing
    const created = createCacheKey()
    await secure.set(GITHUB_SECURE_ACCOUNTS.cacheKey, created)
    return created
  }

  async function sealPrivate(repoId: string, kind: 'file' | 'listing' | 'repos', extra: string, value: unknown): Promise<void> {
    const account = requireAccount()
    const encoded = JSON.stringify(value)
    const sealed = nativeSession
      ? await nativeSession.seal(encoded)
      : await sealJson(await ensureCacheKey(), value)
    await putPrivateCache(database, {
      id: privateCacheId(account.id, repoId, kind, extra),
      accountId: account.id,
      repoId,
      kind,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      updatedAt: clock.now(),
    })
  }

  function enqueueEpoch<T>(op: () => Promise<T>): Promise<T> {
    const run = epochQueue.then(op, op)
    epochQueue = run.then(() => undefined, () => undefined)
    return run
  }

  async function bindWriteAuthority(): Promise<void> {
    if (!nativeSession || authorityToken !== null) return
    const authority = await nativeSession.allocateWriteAuthority()
    writeGeneration = authority.epoch
    authorityToken = authority.token
  }

  function ensureWriteAuthority(): Promise<void> {
    if (!nativeSession || authorityToken !== null) return Promise.resolve()
    return enqueueEpoch(() => bindWriteAuthority())
  }

  async function advanceWriteEpoch(): Promise<void> {
    await enqueueEpoch(async () => {
      await bindWriteAuthority()
      writeGeneration += 1
      if (nativeSession && authorityToken) await nativeSession.noteWriteEpoch(writeGeneration, authorityToken)
    })
  }

  async function send(request: GithubTransportRequest, signal: AbortSignal, allowRefresh = true): Promise<GithubTransportResponse> {
    const response = await exchange(request, signal, allowRefresh)
    const rate = readRateLimit(response.status, response.headers)
    if (rate.limited) throw new GithubError('rate_limited', 'GitHub rate limit was reached', rate.retryAfterMs)
    if (response.status >= 400) throw statusError(response.status, rate.retryAfterMs, response.bodyText)
    return response
  }

  async function exchange(request: GithubTransportRequest, signal: AbortSignal, allowRefresh = true): Promise<GithubTransportResponse> {
    if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
    await ensureWriteAuthority()
    const capturedWrite = writeGeneration
    const capturedToken = authorityToken
    const mutating = request.method !== 'GET'
    if (request.auth === 'bearer' && allowRefresh) await ensureFresh(signal)
    if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
    if (nativeSession) {
      const current = await nativeSession.currentWriteAuthority()
      if (current.token !== capturedToken || capturedWrite < current.epoch) {
        throw new GithubError('stale_target', 'The repository or branch changed before this request was sent')
      }
    }
    if (mutating && writeGeneration !== capturedWrite) {
      throw new GithubError('stale_target', 'The repository or branch changed before this request was sent')
    }
    const response = await transport.request({ ...request, callerEpoch: capturedWrite, authorityToken: capturedToken ?? undefined }, signal)
    if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
    if (nativeSession) {
      const current = await nativeSession.currentWriteAuthority()
      if (current.token !== capturedToken || capturedWrite < current.epoch) {
        throw new GithubError('stale_target', 'The repository or branch changed before this request could be applied')
      }
    }
    if (mutating && writeGeneration !== capturedWrite) {
      throw new GithubError('stale_target', 'The repository or branch changed before this request could be applied')
    }
    if (response.status === 401 && request.auth === 'bearer' && allowRefresh) {
      const refreshed = await refreshTokens(signal)
      if (!refreshed) {
        const accountId = connection.status === 'connected' ? connection.account.id : null
        await sealSession({ status: 'auth_expired', accountId })
        throw new GithubError('auth_expired', 'GitHub authorization expired')
      }
      return exchange(request, signal, false)
    }
    return response
  }

  async function refreshTokens(signal: AbortSignal): Promise<boolean> {
    if (!clientId) return false
    if (nativeSession) {
      const refreshed = await nativeSession.refresh(clientId)
      if (!refreshed) return false
      if (connection.status === 'connected') {
        await rememberAccount({ ...connection.account, grantedScopes: refreshed.scopes, expiresAt: refreshed.expiresIn === null ? null : clock.now() + refreshed.expiresIn * 1000 })
      }
      return true
    }
    if (!(await secure.has(GITHUB_SECURE_ACCOUNTS.refresh))) return false
    const refreshToken = await secure.get(GITHUB_SECURE_ACCOUNTS.refresh)
    if (!refreshToken) return false
    const response = await transport.request(refreshRequest(clientId, refreshToken), signal)
    if (response.status >= 400) return false
    const body = parseJson(response.bodyText)
    if (oauthErrorCode(body) || typeof body.refresh_token !== 'string' || body.refresh_token.length === 0) return false
    const consumed = await consumeToken(body)
    if (connection.status === 'connected') {
      await rememberAccount({ ...connection.account, grantedScopes: consumed.scopes, expiresAt: consumed.expiresAt })
    }
    return true
  }

  async function ensureFresh(signal: AbortSignal): Promise<void> {
    if (connection.status !== 'connected' || connection.account.expiresAt === null) return
    if (clock.now() + 60_000 < connection.account.expiresAt) return
    const refreshed = await refreshTokens(signal)
    if (!refreshed) {
      await sealSession({ status: 'auth_expired', accountId: connection.status === 'connected' ? connection.account.id : null })
      throw new GithubError('auth_expired', 'GitHub authorization expired')
    }
  }

  async function consumeToken(body: Record<string, unknown>, requiredScopes = [GITHUB_PHASE1_SCOPE]): Promise<{ scopes: string[]; expiresAt: number | null }> {
    if (nativeSession) throw new GithubError('token_leak_rejected', 'Production sign-in does not accept a token in the webview')
    const token = body.access_token
    if (typeof token !== 'string' || token.length === 0) {
      throw new GithubError('auth_expired', 'GitHub did not return an access token')
    }
    await secure.set(GITHUB_SECURE_ACCOUNTS.access, token)
    if (typeof body.refresh_token === 'string' && body.refresh_token.length > 0) {
      await secure.set(GITHUB_SECURE_ACCOUNTS.refresh, body.refresh_token)
    }
    const scopes = typeof body.scope === 'string' ? body.scope.split(/[,\s]+/).filter(Boolean) : []
    if (requiredScopes.some((scope) => !scopes.includes(scope))) {
      await secure.delete(GITHUB_SECURE_ACCOUNTS.access)
      await secure.delete(GITHUB_SECURE_ACCOUNTS.refresh)
      throw new GithubError('insufficient_scope', 'GitHub did not grant the repo scope')
    }
    const expiresAt = typeof body.expires_in === 'number' ? clock.now() + body.expires_in * 1000 : null
    return { scopes, expiresAt }
  }

  async function resolveRepo(repoId: string, signal: AbortSignal): Promise<GithubRepo> {
    const known = repos.get(repoId)
    if (known) return known
    const response = await send(apiGet(new URL(repositoryUrl(repoId)).pathname), signal)
    const mapped = mapRepos([parseJson(response.bodyText)], requireAccount().id)
    const repo = mapped.personal[0]
    if (!repo) throw new GithubError('organization_rejected', 'Only personal repositories owned by the signed-in account are available')
    repos.set(repo.id, repo)
    return repo
  }

  async function followPages(firstUrl: string, signal: AbortSignal, read: (bodyText: string) => void): Promise<{ complete: boolean; error: GithubPage<never>['error'] }> {
    let url: string | null = firstUrl
    let pages = 0
    while (url) {
      if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
      pages += 1
      if (pages > pageCap()) return { complete: false, error: { code: 'rate_limited', message: 'GitHub list stopped before the final page' } }
      let response: GithubTransportResponse
      try {
        response = await send(apiGet(new URL(url).pathname, Object.fromEntries(new URL(url).searchParams)), signal)
      } catch (error) {
        if (isGithubError(error) && error.code === 'rate_limited') {
          return { complete: false, error: publicGithubError(error) }
        }
        throw error
      }
      read(response.bodyText)
      const next = nextLink(response.headers.link ?? response.headers.Link)
      if (!next) return { complete: true, error: null }
      try {
        inspectGithubUrl(next, 'GET')
      } catch {
        return { complete: false, error: { code: 'host_rejected', message: 'GitHub next page was rejected' } }
      }
      url = next
    }
    return { complete: true, error: null }
  }

  async function loadClient(): Promise<void> {
    clientId = await readClientId(database)
    if (!clientId && connection.status === 'needs_setup') return
    if (!clientId) connection = { status: 'needs_setup' }
  }

  async function startSignIn(scope: string, expectedAccountId: string | null, allowConnected: boolean): Promise<DeviceBrowserChallenge> {
    await loadClient()
    if (!clientId) {
      connection = { status: 'needs_setup' }
      throw new GithubError('needs_setup', 'GitHub client ID is not configured')
    }
    if (connection.status === 'connected' && !allowConnected) throw new GithubError('already_connected', 'Sign out before connecting another GitHub account')
    if (finishing) throw new GithubError('sign_in_in_progress', 'GitHub sign-in is already in progress')
    if (nativeSession) {
      const started = await nativeSession.startDevice(clientId, scope, expectedAccountId)
      const expiresAt = clock.now() + started.expiresIn * 1000
      device = { deviceCode: null, expiresAt, intervalSeconds: started.intervalSeconds, scope, expectedAccountId, native: true, flowId: started.flowId }
      const challenge: DeviceBrowserChallenge = {
        userCode: started.userCode,
        verificationUri: canonicalVerification(),
        browserUrl: canonicalVerification(),
        expiresAt,
        intervalSeconds: started.intervalSeconds,
      }
      connection = { status: 'authorizing', challenge }
      return challenge
    }
    const response = await send(deviceCodeRequest(clientId, scope), new AbortController().signal)
    const body = parseJson(response.bodyText)
    const error = oauthErrorCode(body)
    if (error === 'device_flow_disabled') throw new GithubError('device_flow_disabled', 'Enable the device flow in the GitHub OAuth app settings')
    if (error) throw new GithubError('validation', 'GitHub could not start device sign-in')
    if (typeof body.verification_uri !== 'string') throw new GithubError('host_rejected', 'GitHub verification URL was rejected')
    assertVerificationUri(body.verification_uri)
    const started = readDeviceStart(body, clock.now())
    device = {
      deviceCode: started.deviceCode,
      expiresAt: started.expiresAt,
      intervalSeconds: started.intervalSeconds,
      scope,
      expectedAccountId,
      native: false,
      flowId: null,
    }
    const challenge: DeviceBrowserChallenge = {
      userCode: started.userCode,
      verificationUri: canonicalVerification(),
      browserUrl: canonicalVerification(),
      expiresAt: started.expiresAt,
      intervalSeconds: started.intervalSeconds,
    }
    connection = { status: 'authorizing', challenge }
    return challenge
  }

  function lifecycleHost(signal: AbortSignal): LifecycleHost {
    const capturedGeneration = writeGeneration
    return {
      signal,
      now: () => clock.now(),
      generation: () => writeGeneration,
      capturedGeneration,
      account: () => connection.status === 'connected' ? { id: connection.account.id, login: connection.account.login } : null,
      request: (input) => exchange(input, signal),
      rememberRepo: (repo) => { repos.set(repo.id, repo) },
      proposal: (id) => proposals.get(id) ?? null,
      hasAccess: async () => nativeSession ? nativeSession.hasAccess() : secure.has(GITHUB_SECURE_ACCOUNTS.access),
    }
  }

  const service: GithubService = {
    getConnection: () => connection,

    async configureClientId(value: string) {
      assertNoClientSecret(value)
      assertPublicClientId(value)
      await writeClientId(database, value)
      clientId = value
      if (connection.status === 'needs_setup') connection = { status: 'signed_out' }
    },

    async clearClientId() {
      await clearClientId(database)
      clientId = null
      if (connection.status !== 'connected' && connection.status !== 'authorizing') connection = { status: 'needs_setup' }
    },

    async beginDeviceBrowserSignIn() {
      return startSignIn(GITHUB_PHASE1_SCOPE, null, false)
    },

    async finishDeviceBrowserSignIn(signal?: AbortSignal) {
      if (!device || !clientId) throw new GithubError('validation', 'Device sign-in has not started')
      if (finishing) throw new GithubError('sign_in_in_progress', 'GitHub sign-in is already in progress')
      finishing = true
      signInAbort = new AbortController()
      const onAbort = () => signInAbort?.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const pollSignal = signInAbort.signal
      try {
        let intervalMs = device.intervalSeconds * 1000
        while (clock.now() < device.expiresAt) {
          if (pollSignal.aborted) throw new GithubError('cancelled', 'Cancelled')
          await clock.sleep(intervalMs, pollSignal)
          if (clock.now() >= device.expiresAt) break
          if (device.native) {
            if (!nativeSession || !device.flowId) throw new GithubError('native_unavailable', 'GitHub native sign-in is not available')
            const polled = await nativeSession.pollDevice(clientId, device.flowId)
            if (polled.status === 'pending') continue
            if (polled.status === 'slow_down') {
              intervalMs = Math.max(intervalMs + 5000, polled.intervalSeconds * 1000)
              continue
            }
            if (polled.status === 'denied') throw new GithubError('access_denied', 'GitHub sign-in was denied')
            if (polled.status === 'expired') throw new GithubError('device_expired', 'GitHub device code expired')
            if (polled.status === 'disabled') throw new GithubError('device_flow_disabled', 'Enable the device flow in the GitHub OAuth app settings')
            if (polled.status !== 'authorized') throw new GithubError('validation', 'GitHub device sign-in failed')
            const required = device.scope.split(/\s+/).filter(Boolean)
            const probed = await nativeSession.probePendingUser(device.flowId)
            if (probed.flowId !== device.flowId || required.some((scope) => !probed.scopes.includes(scope))) {
              await nativeSession.discardPendingAuth(probed.flowId)
              throw new GithubError('insufficient_scope', 'GitHub did not grant the requested scope')
            }
            if (device.expectedAccountId && probed.id !== device.expectedAccountId) {
              await nativeSession.discardPendingAuth(probed.flowId)
              throw new GithubError('target_mismatch', 'GitHub account changed during authorization')
            }
            if (!probed.id) throw new GithubError('personal_account_required', 'GitHub mode only connects a personal user account')
            await nativeSession.commitPendingAuth(probed.flowId, probed.id)
            const account = mapAccount({ id: Number(probed.id), login: probed.login, type: 'User' }, probed.scopes, polled.expiresIn === null ? null : clock.now() + polled.expiresIn * 1000)
            await rememberAccount(account)
            return account
          }
          if (!device.deviceCode) throw new GithubError('validation', 'Device sign-in has not started')
          const response = await send(devicePollRequest(clientId, device.deviceCode), pollSignal)
          const body = parseJson(response.bodyText)
          if (typeof body.access_token === 'string') {
            const consumed = await consumeToken(body, device.scope.split(/\s+/).filter(Boolean))
            const user = await send(apiGet('/user'), pollSignal)
            const account = mapAccount(parseJson(user.bodyText), consumed.scopes, consumed.expiresAt)
            await rememberAccount(account)
            await ensureCacheKey()
            return account
          }
          const error = oauthErrorCode(body)
          if (error === 'authorization_pending') continue
          if (error === 'slow_down') {
            const next = typeof body.interval === 'number' ? body.interval : intervalMs / 1000 + 5
            intervalMs = Math.max(intervalMs + 5000, next * 1000)
            continue
          }
          if (error === 'access_denied') throw new GithubError('access_denied', 'GitHub sign-in was denied')
          if (error === 'expired_token') throw new GithubError('device_expired', 'GitHub device code expired')
          if (error === 'device_flow_disabled') throw new GithubError('device_flow_disabled', 'Enable the device flow in the GitHub OAuth app settings')
          throw new GithubError('validation', 'GitHub device sign-in failed')
        }
        throw new GithubError('device_expired', 'GitHub device code expired')
      } catch (error) {
        if (connection.status !== 'connected') {
          await secure.delete(GITHUB_SECURE_ACCOUNTS.access)
          await secure.delete(GITHUB_SECURE_ACCOUNTS.refresh)
          connection = clientId ? { status: 'signed_out' } : { status: 'needs_setup' }
        }
        throw error
      } finally {
        finishing = false
        device = null
        signal?.removeEventListener('abort', onAbort)
        signInAbort = null
      }
    },

    cancelSignIn() {
      signInAbort?.abort()
      const flowId = device?.flowId
      if (flowId) void nativeSession?.cancelDevice(flowId)
      device = null
      finishing = false
      if (connection.status === 'authorizing') connection = clientId ? { status: 'signed_out' } : { status: 'needs_setup' }
    },

    async signOut() {
      this.cancelSignIn()
      await advanceWriteEpoch()
      repos.clear()
      proposals.clear()
      await database.settings.delete(ACTIVE_ACCOUNT_SETTING)
      if (nativeSession) {
        await nativeSession.logout()
      }
      await sealSession(clientId ? { status: 'signed_out' } : { status: 'needs_setup' })
    },

    deleteDrafts(request) {
      return deleteDraftRecords(database, request)
    },

    async listPersonalRepos(signal = new AbortController().signal) {
      const account = requireAccount()
      const items: GithubRepo[] = []
      const followed = await followPages(reposPageUrl(1), signal, (bodyText) => {
        const mapped = mapRepos(parseJsonArray(bodyText), account.id)
        for (const repo of mapped.personal) {
          repos.set(repo.id, repo)
          items.push(repo)
        }
      })
      const privateRepos = items.filter((repo) => repo.private)
      if (privateRepos.length > 0) await sealPrivate(account.id, 'repos', 'personal', privateRepos)
      return { items, complete: followed.complete, message: null, error: followed.error }
    },

    async listBranches(repoId, signal = new AbortController().signal) {
      const repo = await resolveRepo(repoId, signal)
      const items: GithubBranch[] = []
      const followed = await followPages(branchesUrl(repo.ownerLogin, repo.name, 1), signal, (bodyText) => {
        items.push(...mapBranches(parseJsonArray(bodyText)))
      })
      return { items, complete: followed.complete, message: null, error: followed.error }
    },

    async listEntries(repoId, ref, path, signal = new AbortController().signal) {
      const repo = await resolveRepo(repoId, signal)
      const response = await send(apiGet(new URL(contentsUrl(repo.ownerLogin, repo.name, path, safeRef(ref))).pathname, {
        ref: safeRef(ref),
      }), signal)
      const parsed: unknown = JSON.parse(response.bodyText)
      const entries = Array.isArray(parsed) ? mapEntries(parsed) : []
      if (repo.private) await sealPrivate(repo.id, 'listing', `${ref}:${path}`, entries)
      return {
        items: entries,
        complete: entries.length < 1000,
        message: entries.length === 0 ? GITHUB_EMPTY_DIRECTORY_NOTE : null,
        error: entries.length === 1000 ? { code: 'rate_limited', message: 'GitHub directory listing may be truncated' } : null,
      }
    },

    async openFile(repoId, ref, path, signal = new AbortController().signal) {
      const account = requireAccount()
      const normalizedPath = normalizeRepoPath(path)
      const repo = await resolveRepo(repoId, signal)
      const branchResponse = await send(apiGet(new URL(branchUrl(repo.ownerLogin, repo.name, ref)).pathname), signal)
      const branchBody = parseJson(branchResponse.bodyText)
      const commit = branchBody.commit
      const baseCommitSha = commit && typeof commit === 'object' && typeof (commit as Record<string, unknown>).sha === 'string'
        ? (commit as Record<string, unknown>).sha as string
        : null
      const response = await send(apiGet(new URL(contentsUrl(repo.ownerLogin, repo.name, normalizedPath, safeRef(ref))).pathname, { ref: safeRef(ref) }), signal)
      const classified = classifyFile(parseJson(response.bodyText))
      if (repo.private && (classified.text || classified.binaryBase64)) {
        await sealPrivate(repo.id, 'file', `${ref}:${normalizedPath}`, {
          text: classified.text,
          binaryBase64: classified.binaryBase64,
        })
      }
      const draft = (await listDraftRecords(database, { accountId: account.id, repoId, ref })).find((item) => item.path === normalizedPath) ?? null
      await this.setActiveRepo(repoId, ref)
      await this.setBranchWorkspace(repoId, ref, {
        selectedPath: normalizedPath,
        openPaths: [...new Set([...(await readBranchWorkspace(database, account.id, repoId, ref))?.openPaths ?? [], normalizedPath])],
      })
      return {
        accountId: account.id,
        repoId,
        ref,
        path: normalizedPath,
        kind: classified.kind,
        text: draft?.newText ?? classified.text,
        binaryBase64: draft?.newBinary ?? classified.binaryBase64,
        baseCommitSha: draft?.baseCommitSha ?? baseCommitSha,
        baseBlobSha: draft?.baseBlobSha ?? classified.blobSha,
        remoteBlobSha: classified.blobSha,
        draft,
        byteLength: classified.byteLength,
        private: repo.private,
        message: classified.message,
        mediaKind: classified.mediaKind,
      }
    },

    async saveDraft(input) {
      const account = requireAccount()
      return putDraft(database, { ...input, accountId: account.id, now: clock.now() })
    },

    listDrafts(filter = {}) {
      return listDraftRecords(database, filter)
    },

    getAccountWorkspace() {
      if (connection.status !== 'connected') return Promise.resolve(null)
      return readAccountWorkspace(database, connection.account.id)
    },

    getBranchWorkspace(repoId, ref) {
      if (connection.status !== 'connected') return Promise.resolve(null)
      return readBranchWorkspace(database, connection.account.id, repoId, ref)
    },

    async setActiveRepo(repoId, ref) {
      const account = requireAccount()
      const current = await readAccountWorkspace(database, account.id)
      const changed = current?.activeRepoId !== repoId || current?.activeRefByRepo[repoId] !== ref
      if (changed) {
        await advanceWriteEpoch()
        noteGithubTarget(account.id, repoId, ref)
      }
      const openRepoIds = current?.openRepoIds.includes(repoId) ? current.openRepoIds : [...(current?.openRepoIds ?? []), repoId]
      const workspace: GithubAccountWorkspace = {
        id: `ghws:v1:${account.id}`,
        accountId: account.id,
        openRepoIds,
        activeRepoId: repoId,
        activeRefByRepo: { ...(current?.activeRefByRepo ?? {}), [repoId]: ref },
        updatedAt: clock.now(),
      }
      await writeAccountWorkspace(database, workspace)
      const branch = await readBranchWorkspace(database, account.id, repoId, ref)
      if (!branch) {
        await writeBranchWorkspace(database, {
          id: branchWorkspaceId(account.id, repoId, ref),
          accountId: account.id,
          repoId,
          ref,
          openPaths: [],
          selectedPath: null,
          panel: DEFAULT_GITHUB_PANEL,
          updatedAt: clock.now(),
        })
      }
      return workspace
    },

    async closeRepoTab(repoId) {
      const account = requireAccount()
      const current = await readAccountWorkspace(database, account.id)
      const openRepoIds = (current?.openRepoIds ?? []).filter((id) => id !== repoId)
      const activeRepoId = current?.activeRepoId === repoId
        ? openRepoIds.at(-1) ?? null
        : current?.activeRepoId ?? null
      const workspace: GithubAccountWorkspace = {
        id: accountWorkspaceId(account.id),
        accountId: account.id,
        openRepoIds,
        activeRepoId,
        // Keep the last branch choice so reopening the local tab returns to it.
        activeRefByRepo: current?.activeRefByRepo ?? {},
        updatedAt: clock.now(),
      }
      await writeAccountWorkspace(database, workspace)
      return workspace
    },

    async setBranchWorkspace(repoId, ref, update) {
      const account = requireAccount()
      const current = await readBranchWorkspace(database, account.id, repoId, ref)
      const workspace: GithubBranchWorkspace = {
        id: branchWorkspaceId(account.id, repoId, ref),
        accountId: account.id,
        repoId,
        ref,
        openPaths: update.openPaths ?? current?.openPaths ?? [],
        selectedPath: update.selectedPath === undefined ? current?.selectedPath ?? null : update.selectedPath,
        panel: update.panel ?? current?.panel ?? DEFAULT_GITHUB_PANEL,
        updatedAt: clock.now(),
      }
      await writeBranchWorkspace(database, workspace)
      return workspace
    },

    async hydrate() {
      await loadClient()
      const active = await database.settings.get(ACTIVE_ACCOUNT_SETTING)
      const accountId = typeof active?.value === 'string' ? active.value : null
      const hasToken = clientId
        ? await (nativeSession ? nativeSession.hasAccess() : secure.has(GITHUB_SECURE_ACCOUNTS.access).catch(() => false))
        : false
      if (!clientId) connection = { status: 'needs_setup' }
      else if (!hasToken) connection = { status: 'signed_out' }
      else if (accountId) {
        const account = await getAccount(database, accountId)
        connection = account ? { status: 'connected', account } : { status: 'auth_expired', accountId }
      } else connection = { status: 'auth_expired', accountId: null }
      const drafts = await listDraftRecords(database, connection.status === 'connected' ? { accountId: connection.account.id } : {})
      for (const item of await readConsents()) {
        const [accountId, repoId] = item.split(':')
        if (accountId && repoId) grantGithubAiConsent(accountId, repoId, clock.now())
      }
      const accountWorkspace = connection.status === 'connected' ? await readAccountWorkspace(database, connection.account.id) : null
      return { connection, drafts, accountWorkspace }
    },

    async readPrivateCache(repoId, kind, extra = '') {
      const accountId = connection.status === 'connected' ? connection.account.id : null
      if (!accountId) return { status: 'sealed', value: null }
      const row = await getPrivateCache(database, privateCacheId(accountId, repoId, kind, extra))
      if (!row) return { status: 'missing', value: null }
      if (nativeSession) {
        try {
          return { status: 'available', value: JSON.parse(await nativeSession.open(row.iv, row.ciphertext)) as unknown }
        } catch {
          return { status: 'sealed', value: null }
        }
      }
      const key = await cacheKey()
      if (!key) return { status: 'sealed', value: null }
      return { status: 'available', value: await openJson(key, row.iv, row.ciphertext) }
    },

    async stageDirectory(input) {
      await ensureWriteAuthority()
      return stageDirectoryDraft(phaseHost(), input)
    },
    async stageUpload(input) {
      await ensureWriteAuthority()
      return stageUploadDraft(phaseHost(), input)
    },
    async refreshRemote(repoId, ref, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return refreshRemoteState(phaseHost(), repoId, ref, signal)
    },
    async resolveConflict(input) {
      await ensureWriteAuthority()
      return resolveDraftConflict(phaseHost(), input)
    },
    async commitSelected(confirmation, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return runCommitSelected(phaseHost(), confirmation, signal)
    },
    async createBranch(repoId, name, fromRef, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return createRemoteBranch(phaseHost(), repoId, name, fromRef, signal)
    },
    async commitHistory(repoId, ref, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return loadCommitHistory(phaseHost(), repoId, ref, signal)
    },
    async commitDetail(repoId, sha, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return loadCommitDetail(phaseHost(), repoId, sha, signal)
    },
    async searchRepository(repoId, ref, query, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return searchRepoContent(phaseHost(), repoId, ref, query, signal)
    },
    async downloadBlob(repoId, sha, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return downloadAuthenticatedBlob(phaseHost(), repoId, sha, signal)
    },
    async grantAiConsent(accountId, repoId) {
      grantGithubAiConsent(accountId, repoId, clock.now())
      await database.settings.put({ key: 'githubAiConsent', value: JSON.stringify([...new Set([...(await readConsents()), `${accountId}:${repoId}`])]) })
    },
    async revokeAiConsent(accountId, repoId) {
      revokeGithubAiConsent(accountId, repoId)
      const remaining = (await readConsents()).filter((item) => item !== `${accountId}:${repoId}`)
      await database.settings.put({ key: 'githubAiConsent', value: JSON.stringify(remaining) })
    },
    hasAiConsent(accountId, repoId) {
      return hasGithubAiConsent(accountId, repoId)
    },
    async prepareAi(input) {
      await ensureWriteAuthority()
      const account = requireAccount()
      const repo = repos.get(input.repoId) ?? await resolveRepo(input.repoId, new AbortController().signal)
      const drafts = await listDraftRecords(database, { accountId: account.id, repoId: input.repoId, ref: input.ref })
      const draft = input.path ? drafts.find((item) => item.path === input.path) : drafts[0]
      const fileText = draft?.newText ?? draft?.originalText ?? null
      const diffText = draft ? `--- base\n+++ working\n${draft.originalText ?? ''}\n${draft.newText ?? ''}` : null
      if (repo.private && fileText) registerGithubMaterial({ accountId: account.id, repoId: input.repoId, ref: input.ref, private: true, spans: [fileText, diffText ?? ''].filter((item) => item.length >= 8) })
      const consented = hasGithubAiConsent(account.id, input.repoId)
      const prepared = prepareAiPacket({ purpose: input.purpose, accountId: account.id, repoId: input.repoId, ref: input.ref, private: repo.private, fileText, diffText, consented })
      if (!prepared.blocked && input.purpose === 'edit_draft' && draft && fileText) {
        const proposal = proposeDraftEdit({ id: crypto.randomUUID(), accountId: account.id, repoId: input.repoId, ref: input.ref, path: draft.path, baseEditVersion: draft.editVersion, text: fileText })
        return { ...prepared, proposalId: proposal.id }
      }
      return prepared
    },
    async applyAiDraft(input) {
      await ensureWriteAuthority()
      return applyDraftProposal(phaseHost(), input)
    },
    rejectAiRemoteMutation(confirm) {
      return rejectUnconfirmedRemoteMutation(confirm)
    },
    async listRepoTemplates(signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return listTemplateCatalog(lifecycleHost(signal))
    },
    async createRepository(input, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return createPersonalRepo(lifecycleHost(signal), input)
    },
    async captureDeleteSnapshot(repoId, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return captureDeleteSnapshot(lifecycleHost(signal), repoId)
    },
    async deleteRepository(confirmation, signal = new AbortController().signal) {
      await ensureWriteAuthority()
      return deletePersonalRepo(lifecycleHost(signal), confirmation)
    },
    proposeRepoCreate(input) {
      const proposal: RepoProposal = { id: crypto.randomUUID(), kind: 'create', accountId: input.accountId, ownerLogin: input.ownerLogin, repoName: input.repoName, repoId: null }
      proposals.set(proposal.id, proposal)
      return proposal
    },
    proposeRepoDelete(input) {
      const proposal: RepoProposal = { id: crypto.randomUUID(), kind: 'delete', accountId: input.accountId, ownerLogin: input.ownerLogin, repoName: input.repoName, repoId: input.repoId }
      proposals.set(proposal.id, proposal)
      return proposal
    },
    beginDeleteScopeElevation() {
      if (connection.status !== 'connected') return Promise.reject(new GithubError('signed_out', 'GitHub is not signed in'))
      return startSignIn(GITHUB_ELEVATED_DELETE_SCOPE, connection.account.id, true)
    },
    async openDeviceLogin() {
      if (nativeSession) {
        await nativeSession.openDeviceLogin()
        return { opened: true, url: GITHUB_VERIFICATION_URI }
      }
      return { opened: false, url: GITHUB_VERIFICATION_URI }
    },
    dismissLocalRepo(repoId) {
      return this.closeRepoTab(repoId)
    },
  }

  function phaseHost() {
    return {
      database,
      clock,
      requireAccount,
      resolveRepo,
      send,
      listBranches: (repoId: string, signal: AbortSignal) => service.listBranches(repoId, signal),
      generation: () => writeGeneration,
      repoPrivate: (repoId: string) => repos.get(repoId)?.private === true,
    }
  }

  async function readConsents(): Promise<string[]> {
    const row = await database.settings.get('githubAiConsent')
    if (typeof row?.value !== 'string') return []
    try {
      const parsed: unknown = JSON.parse(row.value)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  return service
}

export function createProductionGithubService(): GithubService {
  return createGithubService({
    database: db,
    transport: createNativeGithubTransport(),
    secureStore: createNativeSecureStore(),
    nativeSession: createTauriNativeSession(),
  })
}
