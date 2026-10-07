import { parseJson, parseJsonArray, repositoryUrl, statusError } from './api'
import { GithubError, isGithubError, publicGithubError } from './errors'
import { isEmptyRepositoryMessage } from './gitProtocol'
import { safeName } from './identity'
import { nextLink, pageCap } from './policy'
import {
  EMPTY_INITIAL_BRANCH_NOTE,
  GITHUB_API_ORIGIN,
  GITHUB_DELETE_SCOPE,
  GITHUB_PHASE1_SCOPE,
  LOCAL_REPO_DISMISS_NOTE,
  type GithubErrorCode,
  type GithubRepo,
  type GithubTransportRequest,
  type GithubTransportResponse,
  type RepoCreateInput,
  type RepoCreateResult,
  type RepoDeleteConfirmation,
  type RepoDeleteResult,
  type RepoDeleteSnapshot,
  type RepoProposal,
  type RepoReadback,
  type RepoTemplateCatalog,
} from './types'

export interface LifecycleHost {
  signal: AbortSignal
  now: () => number
  generation: () => number
  capturedGeneration: number
  account: () => { id: string; login: string } | null
  request: (input: GithubTransportRequest) => Promise<GithubTransportResponse>
  rememberRepo: (repo: GithubRepo) => void
  proposal: (id: string) => RepoProposal | null
  hasAccess: () => Promise<boolean>
}

const BLOCKED = { appliedToActive: false as const }
const RETAINED = { draftsRetained: true as const, cacheDestroyed: false as const }

export function buildRepoCreateBody(input: RepoCreateInput['form']): {
  body: Record<string, unknown>
  initialCommitRequested: boolean
} {
  const name = input.name.trim()
  safeName(name)
  if (name.length > 100) throw new GithubError('validation', 'Repository name is too long')
  const description = input.description?.trim() ?? ''
  if (description.length > 350) throw new GithubError('validation', 'Repository description is too long')
  const visibility = input.visibility ?? 'private'
  if (visibility !== 'private' && visibility !== 'public') {
    throw new GithubError('validation', 'Repository visibility was rejected')
  }
  const gitignore = cleanTemplate(input.gitignoreTemplate)
  const license = cleanTemplate(input.licenseTemplate)
  const initialCommitRequested = input.readme === true || gitignore !== null || license !== null
  const body: Record<string, unknown> = {
    name,
    private: visibility !== 'public',
    auto_init: initialCommitRequested,
  }
  if (description) body.description = description
  if (gitignore) body.gitignore_template = gitignore
  if (license) body.license_template = license
  return { body, initialCommitRequested }
}

function cleanTemplate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9._+-]{1,80}$/.test(trimmed)) throw new GithubError('validation', 'Repository template name was rejected')
  return trimmed
}

function blocked(code: GithubErrorCode, message: string): RepoCreateResult {
  return { status: 'blocked', code, message, ...BLOCKED }
}

function sameTarget(host: LifecycleHost, accountId: string): boolean {
  const current = host.account()
  return host.generation() === host.capturedGeneration && current?.id === accountId
}

function confirmCreate(host: LifecycleHost, input: RepoCreateInput): RepoCreateResult | null {
  if (input.confirmation.confirm !== true) return blocked('confirmation_required', 'Repository creation requires an explicit confirmation')
  const account = host.account()
  if (!account) return blocked('signed_out', 'GitHub is not signed in')
  if (input.confirmation.accountId !== account.id || input.confirmation.ownerLogin !== account.login) {
    return { status: 'mismatch', code: 'target_mismatch', message: 'The confirmation does not match the signed-in account', ...BLOCKED }
  }
  if (input.confirmation.repoName !== input.form.name.trim()) {
    return { status: 'mismatch', code: 'target_mismatch', message: 'The confirmation name does not match the repository form', ...BLOCKED }
  }
  if (input.confirmation.aiDerived) {
    const proposal = input.confirmation.proposalId ? host.proposal(input.confirmation.proposalId) : null
    if (!proposal || proposal.kind !== 'create' || proposal.accountId !== account.id || proposal.ownerLogin !== account.login || proposal.repoName !== input.form.name.trim()) {
      return blocked('ai_mutation_unconfirmed', 'An AI repository creation needs a fresh exact-target confirmation')
    }
  }
  return null
}

function api(method: GithubTransportRequest['method'], url: string, body?: unknown): GithubTransportRequest {
  return {
    method,
    url,
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TABS',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    auth: 'bearer',
    timeoutMs: 20_000,
  }
}

function scopesFrom(headers: Record<string, string>): string[] {
  const raw = headers['x-oauth-scopes'] ?? headers['X-OAuth-Scopes'] ?? ''
  return raw.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
}

async function listOwnedIds(host: LifecycleHost, accountId: string): Promise<{ ids: Set<string>; complete: boolean; repos: GithubRepo[] }> {
  const ids = new Set<string>()
  const repos: GithubRepo[] = []
  let url: string | null = `${GITHUB_API_ORIGIN}/user/repos?affiliation=owner&per_page=100&page=1`
  let pages = 0
  while (url) {
    pages += 1
    if (pages > pageCap()) return { ids, complete: false, repos }
    const response = await host.request(api('GET', url))
    if (response.status >= 400) return { ids, complete: false, repos }
    for (const row of parseJsonArray(response.bodyText)) {
      const mapped = mapOwned(row, accountId)
      if (!mapped) continue
      ids.add(mapped.id)
      repos.push(mapped)
    }
    const next = nextLink(response.headers.link ?? response.headers.Link)
    url = next
  }
  return { ids, complete: true, repos }
}

function mapOwned(row: unknown, accountId: string): GithubRepo | null {
  if (!row || typeof row !== 'object') return null
  const repo = row as Record<string, unknown>
  const owner = repo.owner
  if (!owner || typeof owner !== 'object') return null
  const ownerRecord = owner as Record<string, unknown>
  if (ownerRecord.type !== 'User' || String(ownerRecord.id) !== accountId) return null
  if (typeof repo.id !== 'number' || typeof repo.name !== 'string' || typeof ownerRecord.login !== 'string') return null
  return {
    id: String(repo.id),
    ownerId: String(ownerRecord.id),
    ownerLogin: safeName(ownerRecord.login),
    name: safeName(repo.name),
    private: repo.private === true,
    defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch : 'main',
    description: typeof repo.description === 'string' ? repo.description : null,
  }
}

export async function createPersonalRepo(host: LifecycleHost, input: RepoCreateInput): Promise<RepoCreateResult> {
  const rejected = confirmCreate(host, input)
  if (rejected) return rejected
  const account = host.account()
  if (!account) return blocked('signed_out', 'GitHub is not signed in')
  let built: ReturnType<typeof buildRepoCreateBody>
  try {
    built = buildRepoCreateBody(input.form)
  } catch (error) {
    const pub = publicGithubError(error)
    return blocked(pub.code, pub.message)
  }
  if (!('private' in built.body) || typeof built.body.private !== 'boolean' || !('auto_init' in built.body)) {
    return blocked('validation', 'Repository creation must send private and auto_init explicitly')
  }
  let snapshot: { ids: Set<string>; complete: boolean; repos: GithubRepo[] }
  try {
    snapshot = await listOwnedIds(host, account.id)
  } catch (error) {
    return transportCreate(error)
  }
  if (!sameTarget(host, account.id)) return { status: 'stale_target', message: 'The account changed before the repository was created', ...BLOCKED }
  let response: GithubTransportResponse
  try {
    response = await host.request(api('POST', `${GITHUB_API_ORIGIN}/user/repos`, built.body))
  } catch (error) {
    return reconcileCreate(host, account.id, input, built.initialCommitRequested, snapshot, error)
  }
  if (response.status === 422 || response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
    if (response.status >= 500 || response.status === 429) {
      return reconcileCreate(host, account.id, input, built.initialCommitRequested, snapshot, statusError(response.status, undefined, response.bodyText))
    }
    const pub = publicGithubError(statusError(response.status, undefined, response.bodyText))
    return blocked(pub.code, pub.message)
  }
  if (response.status !== 201 && response.status !== 200) {
    return reconcileCreate(host, account.id, input, built.initialCommitRequested, snapshot, new GithubError('ambiguous_write', 'Repository creation returned an uncertain status'))
  }
  const echoed = mapOwned(parseJson(response.bodyText), account.id)
  const wantedPrivate = (input.form.visibility ?? 'private') !== 'public'
  const wantedName = input.form.name.trim()
  if (!echoed || echoed.ownerLogin !== input.confirmation.ownerLogin || echoed.name !== wantedName || echoed.private !== wantedPrivate) {
    return { status: 'mismatch', code: 'target_mismatch', message: 'GitHub did not create the requested repository. The response was not treated as success.', ...BLOCKED }
  }
  return confirmCreated(host, account.id, echoed, built.initialCommitRequested, input.confirmation.ownerLogin, wantedName, wantedPrivate)
}

async function reconcileCreate(
  host: LifecycleHost,
  accountId: string,
  input: RepoCreateInput,
  initialCommitRequested: boolean,
  snapshot: { ids: Set<string>; complete: boolean },
  error: unknown,
): Promise<RepoCreateResult> {
  if (isGithubError(error) && error.code === 'stale_target') {
    return { status: 'stale_target', message: error.message, ...BLOCKED }
  }
  if (!snapshot.complete) {
    return { status: 'ambiguous', message: 'Repository creation did not finish and the existing list was incomplete. It was not retried.', ...BLOCKED }
  }
  try {
    const listed = await listOwnedIds(host, accountId)
    if (!listed.complete) {
      return { status: 'ambiguous', message: 'Repository creation could not be reconciled. It was not retried.', ...BLOCKED }
    }
    const name = input.form.name.trim()
    const wantedPrivate = (input.form.visibility ?? 'private') !== 'public'
    const fresh = listed.repos.filter((repo) => !snapshot.ids.has(repo.id) && repo.name === name && repo.ownerLogin === input.confirmation.ownerLogin && repo.private === wantedPrivate)
    if (fresh.length === 1) return confirmCreated(host, accountId, fresh[0], initialCommitRequested, input.confirmation.ownerLogin, name, wantedPrivate)
    if (fresh.length === 0) return { status: 'not_applied', message: 'The repository was not created. The request was not retried.', ...BLOCKED }
    return { status: 'ambiguous', message: 'More than one new repository matched. Nothing was retried.', ...BLOCKED }
  } catch {
    return { status: 'ambiguous', message: 'Repository creation could not be read back. It was not retried.', ...BLOCKED }
  }
}

async function confirmCreated(
  host: LifecycleHost,
  accountId: string,
  created: GithubRepo,
  initialCommitRequested: boolean,
  ownerLogin: string,
  expectedName: string,
  expectedPrivate: boolean,
): Promise<RepoCreateResult> {
  if (!sameTarget(host, accountId)) {
    return { status: 'stale_target', message: 'The account or repository changed before the create result could be applied', ...BLOCKED }
  }
  try {
    const user = await host.request(api('GET', `${GITHUB_API_ORIGIN}/user`))
    if (user.status !== 200) return { status: 'ambiguous', message: 'The signed-in account could not be read back. The create was not retried.', ...BLOCKED }
    const userBody = parseJson(user.bodyText)
    if (String(userBody.id) !== accountId || userBody.login !== ownerLogin) {
      return { status: 'mismatch', code: 'target_mismatch', message: 'The signed-in account changed during repository creation', ...BLOCKED }
    }
    const repoResponse = await host.request(api('GET', repositoryUrl(created.id)))
    if (repoResponse.status !== 200) return { status: 'ambiguous', message: 'The new repository could not be read back. It was not retried.', ...BLOCKED }
    const repo = mapOwned(parseJson(repoResponse.bodyText), accountId)
    if (!repo || repo.ownerLogin !== ownerLogin || repo.name !== expectedName || repo.private !== expectedPrivate) {
      return { status: 'mismatch', code: 'target_mismatch', message: 'The repository readback did not match the requested owner, name, and privacy', ...BLOCKED }
    }
    const fullName = `${repo.ownerLogin}/${repo.name}`
    const branch = await readBranchState(host, repo)
    if (initialCommitRequested === branch.empty) {
      return { status: 'mismatch', code: 'target_mismatch', message: 'The repository readback did not match the requested initial content', ...BLOCKED }
    }
    if (!sameTarget(host, accountId)) {
      return { status: 'stale_target', message: 'The account changed during repository readback', ...BLOCKED }
    }
    host.rememberRepo(repo)
    const readback: RepoReadback = {
      id: repo.id,
      ownerLogin: repo.ownerLogin,
      fullName,
      private: repo.private,
      defaultBranch: branch.exists ? branch.name : null,
      branchExists: branch.exists,
      empty: branch.empty,
    }
    return {
      status: 'created',
      repo,
      readback,
      initialCommitRequested,
      appliedToActive: false,
      message: branch.empty ? EMPTY_INITIAL_BRANCH_NOTE : 'Repository created and read back.',
    }
  } catch (error) {
    if (isGithubError(error) && (error.code === 'timeout' || error.code === 'cancelled' || error.code === 'github_unavailable')) {
      return { status: 'ambiguous', message: 'Repository readback did not finish. It was not retried.', ...BLOCKED }
    }
    return transportCreate(error)
  }
}

async function readBranchState(host: LifecycleHost, repo: GithubRepo): Promise<{ exists: boolean; empty: boolean; name: string | null }> {
  const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/branches/${encodeURIComponent(repo.defaultBranch)}`
  const response = await host.request(api('GET', url))
  if (response.status === 200) {
    const body = parseJson(response.bodyText)
    const commit = body.commit
    const sha = commit && typeof commit === 'object' ? (commit as Record<string, unknown>).sha : null
    return { exists: typeof sha === 'string', empty: false, name: typeof sha === 'string' ? repo.defaultBranch : null }
  }
  if (response.status === 409 && isEmptyRepositoryMessage(response.bodyText)) {
    return { exists: false, empty: true, name: null }
  }
  if (response.status === 404) return { exists: false, empty: false, name: null }
  throw new GithubError('ambiguous_write', 'The initial branch could not be read back')
}

function transportCreate(error: unknown): RepoCreateResult {
  const pub = publicGithubError(error)
  if (pub.code === 'timeout' || pub.code === 'ambiguous_write' || pub.code === 'github_unavailable') {
    return { status: 'ambiguous', message: 'Repository creation did not finish. It was not retried.', ...BLOCKED }
  }
  if (pub.code === 'stale_target') return { status: 'stale_target', message: pub.message, ...BLOCKED }
  return blocked(pub.code, pub.message)
}

export async function captureDeleteSnapshot(host: LifecycleHost, repoId: string): Promise<RepoDeleteSnapshot> {
  const account = host.account()
  if (!account) throw new GithubError('signed_out', 'GitHub is not signed in')
  if (!(await host.hasAccess())) throw new GithubError('signed_out', 'GitHub is not signed in')
  const user = await host.request(api('GET', `${GITHUB_API_ORIGIN}/user`))
  if (user.status !== 200) throw statusError(user.status, undefined, user.bodyText)
  const userBody = parseJson(user.bodyText)
  if (String(userBody.id) !== account.id || userBody.login !== account.login) {
    throw new GithubError('target_mismatch', 'The signed-in account does not match this confirmation')
  }
  const scopes = scopesFrom(user.headers)
  const repoResponse = await host.request(api('GET', repositoryUrl(repoId)))
  if (repoResponse.status !== 200) throw statusError(repoResponse.status, undefined, repoResponse.bodyText)
  const body = parseJson(repoResponse.bodyText)
  const repo = mapOwned(body, account.id)
  if (!repo) throw new GithubError('personal_account_required', 'Only a personal repository owned by the signed-in account can be deleted')
  const permissions = body.permissions
  const admin = permissions && typeof permissions === 'object' && (permissions as Record<string, unknown>).admin === true
  if (!admin) throw new GithubError('forbidden', 'GitHub did not report administration permission for this repository')
  return {
    accountId: account.id,
    accountLogin: account.login,
    ownerId: repo.ownerId,
    ownerLogin: repo.ownerLogin,
    repoId: repo.id,
    repoName: repo.name,
    fullName: `${repo.ownerLogin}/${repo.name}`,
    private: repo.private,
    grantedScopes: scopes,
    permission: 'admin',
    capturedAt: host.now(),
  }
}

export async function deletePersonalRepo(host: LifecycleHost, confirmation: RepoDeleteConfirmation): Promise<RepoDeleteResult> {
  if (confirmation.confirm !== true) {
    return { status: 'blocked', code: 'confirmation_required', message: 'Permanent deletion requires an explicit confirmation', ...RETAINED }
  }
  const account = host.account()
  if (!account) return { status: 'blocked', code: 'signed_out', message: 'GitHub is not signed in', ...RETAINED }
  const snapshot = confirmation.snapshot
  if (snapshot.accountId !== account.id || snapshot.accountLogin !== account.login || confirmation.typedOwnerRepo !== snapshot.fullName) {
    return { status: 'mismatch', message: 'The typed owner/repo does not match the captured repository', ...RETAINED }
  }
  if (confirmation.aiDerived) {
    const proposal = confirmation.proposalId ? host.proposal(confirmation.proposalId) : null
    if (!proposal || proposal.kind !== 'delete' || proposal.accountId !== snapshot.accountId || proposal.repoId !== snapshot.repoId || proposal.repoName !== snapshot.repoName) {
      return { status: 'blocked', code: 'ai_mutation_unconfirmed', message: 'An AI deletion needs a fresh exact-target confirmation', ...RETAINED }
    }
  }
  if (!(await host.hasAccess())) return { status: 'blocked', code: 'signed_out', message: 'The native token is not available for this account', ...RETAINED }
  if (host.generation() !== host.capturedGeneration) {
    return { status: 'mismatch', message: 'The account or repository changed after the confirmation was captured', ...RETAINED }
  }
  let user: GithubTransportResponse
  let repoResponse: GithubTransportResponse
  try {
    user = await host.request(api('GET', `${GITHUB_API_ORIGIN}/user`))
    repoResponse = await host.request(api('GET', repositoryUrl(snapshot.repoId)))
  } catch (error) {
    return uncertain(error)
  }
  if (user.status === 401) return { status: 'blocked', code: 'auth_expired', message: 'GitHub authorization expired before deletion', ...RETAINED }
  if (user.status !== 200) return { status: 'uncertain', message: 'The signed-in account could not be verified. The repository was not deleted.', ...RETAINED }
  const userBody = parseJson(user.bodyText)
  if (String(userBody.id) !== snapshot.accountId || userBody.login !== snapshot.accountLogin) {
    return { status: 'mismatch', message: 'The signed-in user changed. The captured confirmation was not used.', ...RETAINED }
  }
  const scopes = scopesFrom(user.headers)
  if (!scopes.includes(GITHUB_PHASE1_SCOPE) || !scopes.includes(GITHUB_DELETE_SCOPE)) {
    return {
      status: 'needs_scope',
      requiredScopes: ['repo', 'delete_repo'],
      message: 'Permanent deletion needs a separate delete_repo device-flow grant. The repository was not deleted.',
      ...RETAINED,
    }
  }
  if (repoResponse.status === 404) {
    return { status: 'mismatch', message: 'The captured repository was not found. A missing target is not treated as a successful delete.', ...RETAINED }
  }
  if (repoResponse.status !== 200) return { status: 'uncertain', message: 'The repository could not be verified before deletion.', ...RETAINED }
  const live = parseJson(repoResponse.bodyText)
  const owner = live.owner && typeof live.owner === 'object' ? live.owner as Record<string, unknown> : null
  const permissions = live.permissions && typeof live.permissions === 'object' ? live.permissions as Record<string, unknown> : null
  if (String(live.id) !== snapshot.repoId || owner?.login !== snapshot.ownerLogin || String(owner?.id) !== snapshot.ownerId || live.name !== snapshot.repoName) {
    return { status: 'mismatch', message: 'The repository was renamed or moved after confirmation. It was not deleted.', ...RETAINED }
  }
  if (permissions?.admin !== true) {
    return { status: 'blocked', code: 'forbidden', message: 'GitHub did not report administration permission for this repository', ...RETAINED }
  }
  if (host.generation() !== host.capturedGeneration || host.account()?.id !== snapshot.accountId) {
    return { status: 'mismatch', message: 'The account changed during the deletion preflight', ...RETAINED }
  }
  let deleted: GithubTransportResponse
  try {
    deleted = await host.request(api('DELETE', `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(snapshot.ownerLogin)}/${encodeURIComponent(snapshot.repoName)}`))
  } catch (error) {
    return uncertain(error)
  }
  if (deleted.status === 401) return { status: 'blocked', code: 'auth_expired', message: 'GitHub authorization expired. Deletion was not confirmed.', ...RETAINED }
  if (deleted.status === 403) return { status: 'blocked', code: 'forbidden', message: 'GitHub refused to delete the repository', ...RETAINED }
  if (deleted.status === 429) return { status: 'uncertain', message: 'GitHub rate-limited the deletion. It was not retried and was not treated as deleted.', ...RETAINED }
  if (deleted.status >= 500) return { status: 'uncertain', message: 'GitHub did not confirm the deletion. It was not retried.', ...RETAINED }
  if (deleted.status === 404 || deleted.status === 307 || deleted.status === 301 || deleted.status === 302) {
    return { status: 'uncertain', message: 'GitHub did not return a definite deletion. A generic missing or redirect result is not success.', ...RETAINED }
  }
  if (deleted.status !== 204) return { status: 'uncertain', message: 'GitHub returned an unexpected deletion status. It was not retried.', ...RETAINED }
  return readbackAbsent(host, snapshot)
}

async function readbackAbsent(host: LifecycleHost, snapshot: RepoDeleteSnapshot): Promise<RepoDeleteResult> {
  try {
    const user = await host.request(api('GET', `${GITHUB_API_ORIGIN}/user`))
    if (user.status !== 200 || String(parseJson(user.bodyText).id) !== snapshot.accountId) {
      return { status: 'uncertain', message: 'Deletion could not be verified because the account readback failed. Drafts were kept.', ...RETAINED }
    }
    const repo = await host.request(api('GET', repositoryUrl(snapshot.repoId)))
    if (repo.status === 404) {
      return { status: 'deleted', repoId: snapshot.repoId, message: 'The repository is absent for the same signed-in account. Local drafts were kept.', ...RETAINED }
    }
    return { status: 'uncertain', message: 'The repository still exists or could not be proven absent. Drafts were kept.', ...RETAINED }
  } catch (error) {
    return uncertain(error)
  }
}

function uncertain(error: unknown): RepoDeleteResult {
  const pub = publicGithubError(error)
  if (pub.code === 'auth_expired') return { status: 'blocked', code: 'auth_expired', message: pub.message, ...RETAINED }
  if (pub.code === 'forbidden') return { status: 'blocked', code: 'forbidden', message: pub.message, ...RETAINED }
  return { status: 'uncertain', message: 'Deletion did not finish. It was not retried and drafts were kept.', ...RETAINED }
}

export async function listTemplateCatalog(host: LifecycleHost): Promise<RepoTemplateCatalog> {
  const gitignore = await host.request(api('GET', `${GITHUB_API_ORIGIN}/gitignore/templates`))
  const licenses = await host.request(api('GET', `${GITHUB_API_ORIGIN}/licenses`))
  if (gitignore.status !== 200 || licenses.status !== 200) {
    return { gitignore: [], licenses: [], complete: false, message: 'GitHub template catalogs could not be loaded' }
  }
  const names = parseJsonArray(gitignore.bodyText).filter((item): item is string => typeof item === 'string')
  const licenseRows = parseJsonArray(licenses.bodyText).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.key !== 'string' || typeof row.name !== 'string') return []
    return [{ key: row.key, name: row.name }]
  })
  return { gitignore: names, licenses: licenseRows, complete: true, message: null }
}

export function localDismissNote(): string {
  return LOCAL_REPO_DISMISS_NOTE
}
