import { isTauriRuntime } from '../runtime'
import { GithubError, isGithubError } from './errors'
import { inspectGithubRequest, isRedirect } from './policy'
import { GITHUB_API_VERSION, GITHUB_SECURE_ACCOUNTS, type GithubErrorCode, type GithubSecureStore, type GithubTransport, type GithubTransportRequest, type GithubTransportResponse } from './types'

const SAFE_ACCEPT = new Set([
  'application/vnd.github+json',
  'application/vnd.github.raw+json',
  'application/x-git-receive-pack-result',
  'application/json',
])
const SAFE_CONTENT_TYPE = new Set([
  'application/json',
  'application/x-git-receive-pack-request',
])

const NATIVE_ERROR_CODES: Record<string, GithubErrorCode> = {
  timeout: 'timeout',
  rate_limited: 'rate_limited',
  forbidden: 'forbidden',
  auth_expired: 'auth_expired',
  signed_out: 'signed_out',
  too_large: 'too_large',
  stale_session: 'stale_target',
  stale_auth: 'stale_target',
  host_rejected: 'host_rejected',
  redirect_rejected: 'redirect_rejected',
  token_leak_rejected: 'token_leak_rejected',
  force_rejected: 'validation',
  ambiguous_write: 'ambiguous_write',
  github_unavailable: 'github_unavailable',
  validation: 'validation',
  native_http_not_linked: 'native_http_not_linked',
}

function nativeTransportError(error: unknown): GithubError {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.trim()
  if (code.includes('native_http_not_linked')) return new GithubError('native_http_not_linked', 'GitHub native HTTP is not linked in this build')
  const mapped = NATIVE_ERROR_CODES[code]
  if (mapped === 'timeout') return new GithubError('timeout', 'GitHub request timed out')
  if (mapped === 'rate_limited') return new GithubError('rate_limited', 'GitHub rate limit was reached')
  if (mapped === 'forbidden') return new GithubError('forbidden', 'GitHub refused this request')
  if (mapped === 'auth_expired' || mapped === 'signed_out') return new GithubError(mapped, 'GitHub authorization is not available')
  if (mapped === 'too_large') return new GithubError('too_large', 'GitHub response exceeded the size limit')
  if (mapped === 'stale_target') return new GithubError('stale_target', 'The repository changed before this request was sent')
  if (mapped === 'github_unavailable') return new GithubError('ambiguous_write', 'GitHub request failed and was not retried')
  if (mapped) return new GithubError(mapped, 'GitHub native request was rejected')
  return new GithubError('ambiguous_write', 'GitHub request failed and was not retried')
}

export function safeTransportFields(headers: Record<string, string>): { accept?: string; contentType?: string; apiVersion?: string; headers: Record<string, string> } {
  const out: Record<string, string> = {}
  let accept: string | undefined
  let contentType: string | undefined
  let apiVersion: string | undefined
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (key === 'authorization' || key === 'cookie' || key === 'proxy-authorization') {
      throw new GithubError('token_leak_rejected', 'Caller cannot attach credentials to a GitHub request')
    }
    if (key === 'accept') {
      if (!SAFE_ACCEPT.has(value)) throw new GithubError('host_rejected', 'GitHub Accept header was rejected')
      accept = value
      out.Accept = value
    } else if (key === 'content-type') {
      if (!SAFE_CONTENT_TYPE.has(value)) throw new GithubError('host_rejected', 'GitHub Content-Type was rejected')
      contentType = value
      out['Content-Type'] = value
    } else if (key === 'x-github-api-version') {
      if (value !== GITHUB_API_VERSION) throw new GithubError('host_rejected', 'GitHub API version was rejected')
      apiVersion = value
      out['X-GitHub-Api-Version'] = value
    }
  }
  return { accept, contentType, apiVersion, headers: out }
}

export function createUnavailableSecureStore(): GithubSecureStore {
  const fail = () => Promise.reject(new GithubError('native_unavailable', 'GitHub credentials require the TABS desktop app'))
  return { has: fail, get: fail, set: fail, delete: fail }
}

export function createNativeSecureStore(): GithubSecureStore {
  if (!isTauriRuntime()) return createUnavailableSecureStore()
  const call = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(command, args)
  }
  return {
    has: (account) => call<boolean>('github_credential_status', { account }),
    get: () => Promise.reject(new GithubError('native_http_not_linked', 'GitHub tokens stay in native storage')),
    set: () => Promise.reject(new GithubError('token_leak_rejected', 'Credentials cannot be written from the webview')),
    delete: async (account) => { await call('github_credential_delete', { account }) },
  }
}

export function createNativeGithubTransport(): GithubTransport {
  return {
    async request(input) {
      if (!isTauriRuntime()) throw new GithubError('native_unavailable', 'GitHub requires the TABS desktop app')
      inspectGithubRequest(input)
      if (input.url.includes('/login/oauth/') || input.url.includes('/login/device/code')) {
        throw new GithubError('host_rejected', 'OAuth token endpoints are not sent through the generic transport')
      }
      const safe = safeTransportFields(input.headers)
      const { invoke } = await import('@tauri-apps/api/core')
      try {
        return await invoke<GithubTransportResponse>('github_transport_request', {
          request: {
            method: input.method,
            url: input.url,
            timeoutMs: input.timeoutMs,
            body: input.body ?? '',
            auth: input.auth,
            bodyEncoding: input.bodyEncoding ?? 'utf8',
            accept: safe.accept ?? '',
            contentType: safe.contentType ?? '',
            apiVersion: safe.apiVersion ?? '',
            headers: safe.headers,
            callerEpoch: input.callerEpoch ?? null,
            authorityToken: input.authorityToken ?? '',
          },
        })
      } catch (error) {
        throw nativeTransportError(error)
      }
    },
  }
}

export function createPolicyTransport(
  inner: GithubTransport,
  getAccessToken: () => Promise<string | null>,
): GithubTransport {
  return {
    async request(input: GithubTransportRequest, signal: AbortSignal): Promise<GithubTransportResponse> {
      if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
      inspectGithubRequest(input)
      if (input.auth === 'bearer' && !(await getAccessToken())) {
        throw new GithubError('signed_out', 'GitHub is not signed in')
      }
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), input.timeoutMs)
      const onAbort = () => timeout.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const response = await inner.request({ ...input, headers: { ...input.headers } }, timeout.signal)
        if (signal.aborted || timeout.signal.aborted) {
          throw new GithubError(signal.aborted ? 'cancelled' : 'timeout', signal.aborted ? 'Cancelled' : 'GitHub request timed out')
        }
        if (isRedirect(response.status)) {
          throw new GithubError('redirect_rejected', 'GitHub redirect was not followed')
        }
        return response
      } catch (error) {
        if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
        if (timeout.signal.aborted) throw new GithubError('timeout', 'GitHub request timed out')
        if (isGithubError(error)) throw error
        throw new GithubError('github_unavailable', 'GitHub request failed')
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

export function assertSecureAccount(account: string): asserts account is (typeof GITHUB_SECURE_ACCOUNTS)[keyof typeof GITHUB_SECURE_ACCOUNTS] {
  if (!Object.values(GITHUB_SECURE_ACCOUNTS).includes(account as never)) {
    throw new GithubError('validation', 'Credential account was rejected')
  }
}
