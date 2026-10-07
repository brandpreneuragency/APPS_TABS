import { GithubError } from './errors'
import {
  GITHUB_API_ORIGIN,
  GITHUB_OAUTH_ORIGIN,
  GITHUB_VERIFICATION_URI,
  type GithubTransportRequest,
} from './types'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_PAGES = 20

const ALLOWED_QUERY = new Set(['affiliation', 'per_page', 'page', 'visibility', 'ref', 'sort', 'direction', 'sha', 'recursive', 'path'])

function rawUrlRejected(raw: string): boolean {
  return /%2f|%5c|%2e%2e|%00/i.test(raw)
}

function safeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..'
}

function gitRepoPath(pathname: string): boolean {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\.git$/)
  return Boolean(match && safeSegment(match[1]) && safeSegment(match[2]))
}

function isReceivePackInfo(url: URL): boolean {
  return gitRepoPath(url.pathname.slice(0, -'/info/refs'.length))
    && url.pathname.endsWith('/info/refs')
    && url.searchParams.get('service') === 'git-receive-pack'
    && [...url.searchParams.keys()].every((key) => key === 'service')
}

function isReceivePackPost(url: URL): boolean {
  return gitRepoPath(url.pathname.slice(0, -'/git-receive-pack'.length))
    && url.pathname.endsWith('/git-receive-pack')
    && url.search === ''
}

export function assertVerificationUri(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new GithubError('host_rejected', 'GitHub verification URL was rejected')
  }
  const path = url.pathname.replace(/\/$/, '')
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'github.com'
    || path !== '/login/device'
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.port
  ) {
    throw new GithubError('host_rejected', 'GitHub verification URL was rejected')
  }
}

export function canonicalVerification(): typeof GITHUB_VERIFICATION_URI {
  return GITHUB_VERIFICATION_URI
}

function assertSegments(pathname: string): void {
  for (const segment of pathname.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new GithubError('host_rejected', 'GitHub path was rejected')
    }
  }
}

function repoRestAllowed(rest: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'): boolean {
  if (method === 'DELETE') return rest === ''
  if (method === 'GET') {
    if (rest === '' || rest === '/branches' || rest.startsWith('/branches/')) return true
    if (rest === '/contents' || rest.startsWith('/contents/')) return true
    if (rest === '/commits' || rest.startsWith('/commits/')) return true
    if (rest.startsWith('/git/commits/') || rest.startsWith('/git/trees/') || rest.startsWith('/git/blobs/')) return true
    if (rest.startsWith('/git/ref/') || rest.startsWith('/git/refs/')) return true
    return false
  }
  if (method === 'POST') return rest === '/git/blobs' || rest === '/git/trees' || rest === '/git/commits' || rest === '/git/refs'
  if (method === 'PATCH') return rest.startsWith('/git/refs/')
  return rest.startsWith('/contents/')
}

function isApiPath(pathname: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'): boolean {
  if (method === 'GET' && (pathname === '/user' || pathname === '/user/repos' || /^\/repositories\/[0-9]+$/.test(pathname))) return true
  if (method === 'GET' && (pathname === '/gitignore/templates' || pathname === '/licenses')) return true
  if (method === 'GET' && /^\/gitignore\/templates\/[A-Za-z0-9._+-]+$/.test(pathname)) return true
  if (method === 'GET' && /^\/licenses\/[A-Za-z0-9._+-]+$/.test(pathname)) return true
  if (method === 'POST' && pathname === '/user/repos') return true
  const repo = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (!repo || !safeSegment(repo[1]) || !safeSegment(repo[2])) return false
  return repoRestAllowed(repo[3] ?? '', method)
}

export function inspectGithubUrl(raw: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new GithubError('host_rejected', 'GitHub URL was rejected')
  }
  if (rawUrlRejected(raw) || /gho_|ghr_|ghu_|ghs_|ghp_|github_pat_|Bearer\s+/i.test(raw)) {
    throw new GithubError('token_leak_rejected', 'Request would expose a credential')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new GithubError('host_rejected', 'GitHub URL was rejected')
  }
  assertSegments(url.pathname)
  const oauth = url.origin === GITHUB_OAUTH_ORIGIN
  const api = url.origin === GITHUB_API_ORIGIN
  if (!oauth && !api) throw new GithubError('host_rejected', 'GitHub host was rejected')
  if (oauth) {
    if (method === 'GET' && isReceivePackInfo(url)) return
    if (method === 'POST' && isReceivePackPost(url)) return
    if (method !== 'POST' || (url.pathname !== '/login/device/code' && url.pathname !== '/login/oauth/access_token')) {
      throw new GithubError('host_rejected', 'GitHub OAuth path was rejected')
    }
    if (url.search) throw new GithubError('token_leak_rejected', 'OAuth credentials cannot be placed in the URL')
    return
  }
  if (!isApiPath(url.pathname, method)) {
    throw new GithubError('host_rejected', 'GitHub API path was rejected')
  }
  if (method === 'DELETE' && url.search) throw new GithubError('host_rejected', 'GitHub delete URL was rejected')
  if (method === 'POST' && url.pathname === '/user/repos' && url.search) {
    throw new GithubError('host_rejected', 'GitHub create URL was rejected')
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY.has(key)) throw new GithubError('token_leak_rejected', 'GitHub query was rejected')
  }
}

function jsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function explicitForce(body: string): boolean {
  const record = jsonObject(body)
  if (record && record.force === true) return true
  return /(?:^|&)force=true(?:&|$)/.test(body)
}

function transportClientSecret(url: string, body: string): boolean {
  const oauth = url.includes('/login/oauth/') || url.includes('/login/device/')
  if (/(?:^|&)client_secret=/.test(body)) return true
  const record = jsonObject(body)
  if (!record) return oauth && /client_secret/i.test(body)
  return Object.keys(record).some((key) => key.replace(/[_-]/g, '').toLowerCase() === 'clientsecret')
}

export function inspectGithubRequest(request: Pick<GithubTransportRequest, 'method' | 'url' | 'body' | 'headers' | 'bodyEncoding'>): void {
  inspectGithubUrl(request.url, request.method)
  const headerNames = Object.keys(request.headers).map((name) => name.toLowerCase())
  if (headerNames.some((name) => name === 'authorization' || name === 'cookie')) {
    throw new GithubError('token_leak_rejected', 'Caller cannot attach credentials to a GitHub request')
  }
  const binary = request.bodyEncoding === 'base64'
  if (!binary && request.body && transportClientSecret(request.url, request.body)) {
    throw new GithubError('client_secret_forbidden', 'Client secret is not used by the public client')
  }
  if (!binary && request.body && explicitForce(request.body)) {
    throw new GithubError('validation', 'GitHub ref updates cannot be forced')
  }
  if (request.method === 'GET' && request.body) {
    throw new GithubError('validation', 'GitHub GET requests cannot have a body')
  }
}

export function nextLink(linkHeader: string | undefined): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (match?.[1]) return match[1]
  }
  return null
}

export function readRateLimit(status: number, headers: Record<string, string>): { limited: boolean; retryAfterMs?: number } {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  const remaining = normalized['x-ratelimit-remaining']
  const retryAfter = normalized['retry-after']
  const limited = status === 429 || ((status === 403 || status === 429) && (remaining === '0' || retryAfter !== undefined))
  if (!limited) return { limited: false }
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined
  return { limited: true, ...(seconds !== undefined ? { retryAfterMs: seconds * 1000 } : {}) }
}

export function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.min(60_000, Math.max(1_000, Math.round(timeoutMs)))
}

export function pageCap(): number {
  return MAX_PAGES
}

export function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}
