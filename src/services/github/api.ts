import { GithubError, redact } from './errors'
import { encodeRepoPath, safeName, safeRef } from './identity'
import { classifyBytes } from './binary'
import {
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  GITHUB_INLINE_BYTE_CAP,
  GITHUB_OAUTH_ORIGIN,
  GITHUB_PHASE1_SCOPE,
  type GithubAccount,
  type GithubBranch,
  type GithubEntry,
  type GithubFileKind,
  type GithubRepo,
  type GithubTransportRequest,
} from './types'

const TIMEOUT = 20_000

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

export function deviceCodeRequest(clientId: string, scope = GITHUB_PHASE1_SCOPE): GithubTransportRequest {
  return {
    method: 'POST',
    url: `${GITHUB_OAUTH_ORIGIN}/login/device/code`,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId, scope }),
    auth: 'none',
    timeoutMs: TIMEOUT,
  }
}

export function devicePollRequest(clientId: string, deviceCode: string): GithubTransportRequest {
  return {
    method: 'POST',
    url: `${GITHUB_OAUTH_ORIGIN}/login/oauth/access_token`,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    auth: 'none',
    timeoutMs: TIMEOUT,
  }
}

export function refreshRequest(clientId: string, refreshToken: string): GithubTransportRequest {
  return {
    method: 'POST',
    url: `${GITHUB_OAUTH_ORIGIN}/login/oauth/access_token`,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
    auth: 'none',
    timeoutMs: TIMEOUT,
  }
}

export function apiGet(pathname: string, query?: Record<string, string>): GithubTransportRequest {
  const url = new URL(pathname, GITHUB_API_ORIGIN)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
  return {
    method: 'GET',
    url: url.toString(),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'TABS',
    },
    auth: 'bearer',
    timeoutMs: TIMEOUT,
  }
}

export function parseJson(bodyText: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new GithubError('validation', 'GitHub returned an unexpected response')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof GithubError) throw error
    throw new GithubError('validation', 'GitHub returned an unreadable response')
  }
}

export function parseJsonArray(bodyText: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!Array.isArray(parsed)) throw new GithubError('validation', 'GitHub returned an unexpected list')
    return parsed
  } catch (error) {
    if (error instanceof GithubError) throw error
    throw new GithubError('validation', 'GitHub returned an unreadable list')
  }
}

export function readDeviceStart(body: Record<string, unknown>, now: number): {
  deviceCode: string
  userCode: string
  expiresAt: number
  intervalSeconds: number
} {
  const deviceCode = body.device_code
  const userCode = body.user_code
  const expiresIn = body.expires_in
  const interval = body.interval
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof expiresIn !== 'number') {
    throw new GithubError('validation', 'GitHub device response was incomplete')
  }
  const intervalSeconds = typeof interval === 'number' && interval >= 1 ? interval : 5
  return { deviceCode, userCode, expiresAt: now + expiresIn * 1000, intervalSeconds }
}

export function oauthErrorCode(body: Record<string, unknown>): string | null {
  return typeof body.error === 'string' ? body.error : null
}

export function mapAccount(body: Record<string, unknown>, scopes: string[], expiresAt: number | null): GithubAccount {
  if (body.type !== 'User' || typeof body.id !== 'number' || typeof body.login !== 'string') {
    throw new GithubError('personal_account_required', 'GitHub mode only connects a personal user account')
  }
  safeName(body.login)
  const avatar = typeof body.avatar_url === 'string' ? body.avatar_url : null
  let avatarUrl: string | null = null
  if (avatar) {
    try {
      const url = new URL(avatar)
      if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com') avatarUrl = url.toString()
    } catch {
      avatarUrl = null
    }
  }
  return {
    id: String(body.id),
    login: body.login,
    displayName: typeof body.name === 'string' ? body.name : null,
    avatarUrl,
    grantedScopes: scopes,
    expiresAt,
  }
}

export function mapRepos(rows: unknown[], accountId: string): { personal: GithubRepo[]; rejectedOrganization: boolean } {
  const personal: GithubRepo[] = []
  let rejectedOrganization = false
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const repo = row as Record<string, unknown>
    const owner = repo.owner
    if (!owner || typeof owner !== 'object') continue
    const ownerRecord = owner as Record<string, unknown>
    if (ownerRecord.type !== 'User' || String(ownerRecord.id) !== accountId) {
      rejectedOrganization = true
      continue
    }
    if (typeof repo.id !== 'number' || typeof repo.name !== 'string' || typeof ownerRecord.login !== 'string') continue
    const html = typeof repo.html_url === 'string' ? repo.html_url : ''
    if (html && !html.startsWith('https://github.com/')) continue
    personal.push({
      id: String(repo.id),
      ownerId: String(ownerRecord.id),
      ownerLogin: safeName(ownerRecord.login),
      name: safeName(repo.name),
      private: repo.private === true,
      defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch : 'main',
      description: typeof repo.description === 'string' ? repo.description : null,
    })
  }
  return { personal, rejectedOrganization }
}

export function mapBranches(rows: unknown[]): GithubBranch[] {
  const branches: GithubBranch[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const branch = row as Record<string, unknown>
    const commit = branch.commit
    const sha = commit && typeof commit === 'object' ? (commit as Record<string, unknown>).sha : null
    if (typeof branch.name !== 'string' || typeof sha !== 'string') continue
    branches.push({ name: safeRef(branch.name), commitSha: sha, protected: branch.protected === true })
  }
  return branches
}

function entryKind(row: Record<string, unknown>): GithubEntry['kind'] {
  const type = row.type
  const mode = row.mode
  if (type === 'symlink' || mode === '120000') return 'symlink'
  if (type === 'submodule' || type === 'commit' || mode === '160000') return 'submodule'
  if (type === 'dir' || type === 'tree') return 'dir'
  if (type === 'file' || type === 'blob') return 'file'
  return 'unsupported'
}

export function mapEntries(rows: unknown[]): GithubEntry[] {
  const entries: GithubEntry[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.name !== 'string' || typeof item.path !== 'string') continue
    entries.push({
      name: item.name,
      path: item.path.replace(/^\/+/, ''),
      kind: entryKind(item),
      sha: typeof item.sha === 'string' ? item.sha : null,
      byteLength: typeof item.size === 'number' ? item.size : null,
    })
  }
  return entries
}

export function classifyFile(body: Record<string, unknown>): {
  kind: GithubFileKind
  text: string | null
  binaryBase64: string | null
  byteLength: number
  blobSha: string | null
  message: string | null
  mediaKind: 'text' | 'image' | 'pdf' | 'binary'
} {
  const type = body.type
  if (type === 'dir') {
    return { kind: 'directory', text: null, binaryBase64: null, byteLength: 0, blobSha: null, message: 'This path is a directory', mediaKind: 'binary' }
  }
  if (type === 'symlink' || body.mode === '120000') {
    return { kind: 'symlink', text: null, binaryBase64: null, byteLength: 0, blobSha: null, message: 'Symlinks are not followed', mediaKind: 'binary' }
  }
  if (type === 'submodule' || type === 'commit' || body.mode === '160000') {
    return { kind: 'submodule', text: null, binaryBase64: null, byteLength: 0, blobSha: null, message: 'Submodules are not followed', mediaKind: 'binary' }
  }
  const size = typeof body.size === 'number' ? body.size : 0
  const sha = typeof body.sha === 'string' ? body.sha : null
  const path = typeof body.path === 'string' ? body.path : ''
  if (size > GITHUB_INLINE_BYTE_CAP || body.encoding !== 'base64' || typeof body.content !== 'string') {
    return {
      kind: 'too_large',
      text: null,
      binaryBase64: null,
      byteLength: size,
      blobSha: sha,
      message: 'File exceeds the inline limit. Use an authenticated blob download for files up to 25 MB.',
      mediaKind: 'binary',
    }
  }
  const decoded = decodeBase64Bytes(body.content.replace(/\s/g, ''))
  const mediaKind = classifyBytes(decoded, path)
  if (mediaKind !== 'text') {
    return { kind: 'binary', text: null, binaryBase64: body.content.replace(/\s/g, ''), byteLength: decoded.length, blobSha: sha, message: null, mediaKind }
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  if (text.startsWith('version https://git-lfs.github.com/spec/v1')) {
    return { kind: 'lfs_pointer', text: null, binaryBase64: null, byteLength: decoded.length, blobSha: sha, message: 'Git LFS pointers are not treated as file contents', mediaKind: 'text' }
  }
  return { kind: 'text', text, binaryBase64: null, byteLength: decoded.length, blobSha: sha, message: null, mediaKind: 'text' }
}

function decodeBase64Bytes(value: string): Uint8Array {
  let binary = ''
  try {
    binary = atob(value)
  } catch {
    throw new GithubError('validation', 'GitHub file content could not be decoded')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function repositoryUrl(repoId: string): string {
  if (!/^[0-9]+$/.test(repoId)) throw new GithubError('validation', 'Repository id is not numeric')
  return `${GITHUB_API_ORIGIN}/repositories/${repoId}`
}

export function contentsUrl(owner: string, repo: string, path: string, ref: string): string {
  const encodedPath = encodeRepoPath(path)
  const suffix = encodedPath ? `/${encodedPath}` : ''
  const url = new URL(`${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(safeName(owner))}/${encodeURIComponent(safeName(repo))}/contents${suffix}`)
  url.searchParams.set('ref', safeRef(ref))
  return url.toString()
}

export function branchesUrl(owner: string, repo: string, page: number): string {
  const url = new URL(`${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(safeName(owner))}/${encodeURIComponent(safeName(repo))}/branches`)
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(page))
  return url.toString()
}

export function branchUrl(owner: string, repo: string, ref: string): string {
  return `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(safeName(owner))}/${encodeURIComponent(safeName(repo))}/branches/${encodeURIComponent(safeRef(ref))}`
}

export function reposPageUrl(page: number): string {
  const url = new URL(`${GITHUB_API_ORIGIN}/user/repos`)
  url.searchParams.set('affiliation', 'owner')
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(page))
  return url.toString()
}

export function statusError(status: number, retryAfterMs?: number, bodyText = ''): GithubError {
  const detail = redact(readGithubMessage(bodyText))
  if ((status === 422 || status === 409) && /protected|status check|pull request/i.test(detail)) {
    return new GithubError('protected_branch', detail || 'GitHub branch protection refused the update')
  }
  if (status === 401) return new GithubError('auth_expired', 'GitHub authorization expired')
  if (status === 403) return new GithubError('forbidden', detail || 'GitHub refused this request')
  if (status === 404) return new GithubError('not_found', detail || 'GitHub could not find that target')
  if (status === 409) return new GithubError('conflict', detail || 'GitHub reported a conflict')
  if (status === 422) return new GithubError('validation', detail || 'GitHub rejected the request')
  if (status === 429) return new GithubError('rate_limited', 'GitHub rate limit was reached', retryAfterMs)
  if (status >= 500) return new GithubError('github_unavailable', detail || 'GitHub is unavailable')
  return new GithubError('github_unavailable', redact(`GitHub returned status ${status}`))
}

function readGithubMessage(bodyText: string): string {
  if (!bodyText) return ''
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
    const message = (parsed as Record<string, unknown>).message
    return typeof message === 'string' ? message : ''
  } catch {
    return ''
  }
}
