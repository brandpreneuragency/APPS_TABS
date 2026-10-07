import type { GithubErrorCode } from './types'

const SECRETISH = /(?:gho|ghu|ghs|ghr|ghp)_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+|access_token=[^&\s]+|refresh_token=[^&\s]+|device_code=[^&\s]+/gi

export function redact(text: string): string {
  return text.replace(SECRETISH, '[redacted]')
}

export class GithubError extends Error {
  readonly code: GithubErrorCode
  readonly retryAfterMs?: number

  constructor(code: GithubErrorCode, message: string, retryAfterMs?: number) {
    super(redact(message))
    this.name = 'GithubError'
    this.code = code
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

export function isGithubError(error: unknown): error is GithubError {
  return error instanceof GithubError
}

export function publicGithubError(error: unknown): { code: GithubErrorCode; message: string; retryAfterMs?: number } {
  if (isGithubError(error)) {
    return {
      code: error.code,
      message: redact(error.message),
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    }
  }
  return { code: 'github_unavailable', message: 'GitHub request failed' }
}

export function assertNoClientSecret(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const normalized = key.replace(/[_-]/g, '').toLowerCase()
    if (normalized.includes('secret') || normalized === 'accesstoken' || normalized === 'refreshtoken' || normalized === 'devicecode') {
      throw new GithubError('client_secret_forbidden', 'A client secret or token cannot be configured')
    }
  }
}

const TOKEN_PREFIX = /^(gho_|ghu_|ghs_|ghr_|ghp_|github_pat_)/i

export function assertPublicClientId(clientId: string): void {
  if (typeof clientId !== 'string') {
    throw new GithubError('invalid_client_id', 'GitHub client ID must be a string')
  }
  const trimmed = clientId.trim()
  if (trimmed !== clientId || !/^[A-Za-z0-9._-]{8,100}$/.test(trimmed) || TOKEN_PREFIX.test(trimmed) || /secret/i.test(trimmed)) {
    throw new GithubError('invalid_client_id', 'GitHub client ID is missing or not a public client ID')
  }
}
