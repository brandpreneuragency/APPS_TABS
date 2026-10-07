import { isTauriRuntime } from '../runtime'
import { GithubError } from './errors'
import { GITHUB_VERIFICATION_URI, type GithubSecureAccount } from './types'

export interface NativeDeviceStart {
  userCode: string
  expiresIn: number
  intervalSeconds: number
  flowId: string
}

export type NativeDevicePoll =
  | { status: 'pending' }
  | { status: 'slow_down'; intervalSeconds: number }
  | { status: 'authorized'; scopes: string[]; expiresIn: number | null }
  | { status: 'denied' | 'expired' | 'disabled' | 'error' }

export interface NativePendingUser {
  id: string
  login: string
  scopes: string[]
  flowId: string
}

export interface NativeWriteAuthority {
  epoch: number
  token: string
}

/**
 * Production OAuth, HTTP credential attachment, and cache crypto live behind
 * this boundary. Implementations must not put access tokens, refresh tokens,
 * or device codes on the returned objects.
 */
export interface GithubNativeSession {
  readonly kind: 'native'
  startDevice(clientId: string, scope: string, accountId?: string | null): Promise<NativeDeviceStart>
  pollDevice(clientId: string, flowId: string): Promise<NativeDevicePoll>
  cancelDevice(flowId: string): Promise<void>
  probePendingUser(flowId: string): Promise<NativePendingUser>
  commitPendingAuth(flowId: string, accountKey: string): Promise<void>
  discardPendingAuth(flowId: string): Promise<void>
  refresh(clientId: string): Promise<{ scopes: string[]; expiresIn: number | null } | null>
  hasAccess(): Promise<boolean>
  logout(): Promise<void>
  seal(plaintext: string): Promise<{ iv: string; ciphertext: string }>
  open(iv: string, ciphertext: string): Promise<string>
  openDeviceLogin(): Promise<void>
  generation(): Promise<number>
  allocateWriteAuthority(): Promise<NativeWriteAuthority>
  currentWriteAuthority(): Promise<NativeWriteAuthority>
  noteWriteEpoch(epoch: number, token: string): Promise<void>
}

export interface MemoryNativeSession extends GithubNativeSession {
  peekSecrets(): string[]
}

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauriRuntime()) throw new GithubError('native_unavailable', 'GitHub requires the TABS desktop app')
  const { invoke: call } = await import('@tauri-apps/api/core')
  try {
    return await call<T>(command, args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = message.trim()
    if (code === 'stale_auth' || code === 'stale_session') throw new GithubError('stale_target', 'GitHub authorization changed before it could be saved')
    if (code === 'account_mismatch' || code === 'delete_scope_elevation_rejected') throw new GithubError('target_mismatch', 'GitHub authorization did not match the signed-in account')
    if (code === 'auth_expired') throw new GithubError('auth_expired', 'GitHub authorization expired')
    if (code === 'insufficient_scope') throw new GithubError('insufficient_scope', 'GitHub did not grant the requested scope')
    throw error
  }
}

export function createTauriNativeSession(): GithubNativeSession {
  return {
    kind: 'native',
    startDevice: (clientId, scope, accountId) => invoke<NativeDeviceStart>('github_device_start', { clientId, scope, accountId: accountId ?? null }),
    pollDevice: (clientId, flowId) => invoke<NativeDevicePoll>('github_device_poll', { clientId, flowId }),
    cancelDevice: (flowId) => invoke('github_device_cancel', { flowId }),
    probePendingUser: (flowId) => invoke<NativePendingUser>('github_auth_probe_pending', { flowId }),
    commitPendingAuth: (flowId, accountKey) => invoke('github_auth_commit_pending', { flowId, accountKey }),
    discardPendingAuth: (flowId) => invoke('github_auth_discard_pending', { flowId }),
    refresh: (clientId) => invoke('github_auth_refresh', { clientId }),
    hasAccess: () => invoke<boolean>('github_auth_has_access'),
    logout: () => invoke('github_auth_logout'),
    seal: (plaintext) => invoke('github_cache_seal', { plaintext }),
    open: (iv, ciphertext) => invoke('github_cache_open', { iv, ciphertext }),
    openDeviceLogin: async () => {
      await invoke('github_open_device_login')
      if (GITHUB_VERIFICATION_URI !== 'https://github.com/login/device') {
        throw new GithubError('host_rejected', 'GitHub verification URL was rejected')
      }
    },
    generation: () => invoke<number>('github_session_generation'),
    allocateWriteAuthority: () => invoke<NativeWriteAuthority>('github_allocate_write_authority'),
    currentWriteAuthority: () => invoke<NativeWriteAuthority>('github_current_write_authority'),
    noteWriteEpoch: (epoch, token) => invoke('github_note_write_epoch', { epoch, token }),
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export interface SharedWriteAuthority {
  allocate(): NativeWriteAuthority
  current(): NativeWriteAuthority
  note(token: string, epoch: number): void
}

export function createSharedWriteAuthority(): SharedWriteAuthority {
  let epoch = 0
  let token = ''
  return {
    allocate() {
      epoch += 1
      token = `gha.${epoch}.${crypto.randomUUID()}`
      return { epoch, token }
    },
    current() {
      return { epoch, token }
    },
    note(nextToken, nextEpoch) {
      if (!token || nextToken !== token || nextEpoch < epoch) {
        throw new GithubError('stale_target', 'Write authority is stale')
      }
      if (nextEpoch > epoch) epoch = nextEpoch
    },
  }
}

/**
 * Explicit test double for the native secret boundary. Tokens stay inside the
 * object. Fixture HTTP transport is a different path and is not this session.
 */
export function createMemoryNativeSession(options: {
  user?: { id: string; login: string }
  scopes?: string[]
  poll?: NativeDevicePoll
  authority?: SharedWriteAuthority
} = {}): MemoryNativeSession {
  const secrets = {
    device: 'device-secret-native-fixture',
    pendingAccess: 'gho_native_pending_fixture',
    pendingRefresh: 'ghr_native_pending_fixture',
    access: null as string | null,
    refresh: null as string | null,
  }
  let cacheKey: string | null = null
  let generation = 1
  let flowId = ''
  let flowGeneration = 0
  let elevationAccount: string | null = null
  let deviceBound = false
  let pendingBound = false
  let probed = false
  let pendingAccount: string | null = null
  let pendingScopes: string[] = []
  const user = options.user ?? { id: '1001', login: 'octocat' }
  const scopes = options.scopes ?? ['repo']
  const poll = options.poll ?? { status: 'authorized' as const, scopes, expiresIn: 28_800 }
  const authority = options.authority ?? createSharedWriteAuthority()

  function rotateFlow() {
    flowId = `flow.${crypto.randomUUID()}`
    deviceBound = false
    pendingBound = false
    probed = false
    pendingAccount = null
    pendingScopes = []
    elevationAccount = null
  }

  function assertFlow(id: string) {
    if (!id || id !== flowId || flowGeneration !== generation) {
      throw new GithubError('stale_target', 'GitHub authorization changed before it could be saved')
    }
  }

  async function sealWith(keyB64: string, plaintext: string): Promise<{ iv: string; ciphertext: string }> {
    const key = await crypto.subtle.importKey('raw', base64ToBytes(keyB64), { name: 'AES-GCM' }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(cipher)) }
  }

  return {
    kind: 'native',
    async startDevice(clientId, scope, accountId) {
      if (!clientId) throw new GithubError('needs_setup', 'GitHub client ID is not configured')
      rotateFlow()
      flowGeneration = generation
      deviceBound = true
      if (scope.includes('delete_repo')) {
        if (!accountId) throw new GithubError('target_mismatch', 'Delete permission requires the signed-in account')
        elevationAccount = accountId
      }
      return { userCode: 'WDJB-MJHT', expiresIn: 900, intervalSeconds: 5, flowId }
    },
    async pollDevice(_clientId, requestedFlowId) {
      assertFlow(requestedFlowId)
      if (!deviceBound && !pendingBound) throw new GithubError('stale_target', 'GitHub device sign-in is no longer current')
      if (poll.status === 'authorized') {
        pendingBound = true
        deviceBound = false
        pendingScopes = poll.scopes
      }
      return poll
    },
    async cancelDevice(requestedFlowId) {
      if (requestedFlowId !== flowId) return
      rotateFlow()
    },
    async probePendingUser(requestedFlowId) {
      assertFlow(requestedFlowId)
      if (!pendingBound) throw new GithubError('auth_expired', 'GitHub authorization is not pending')
      const granted = poll.status === 'authorized' ? poll.scopes : scopes
      if (!granted.includes('repo')) throw new GithubError('insufficient_scope', 'GitHub did not grant the requested scope')
      pendingAccount = user.id
      pendingScopes = granted
      probed = true
      return { id: user.id, login: user.login, scopes: granted, flowId }
    },
    async commitPendingAuth(requestedFlowId, accountKey) {
      assertFlow(requestedFlowId)
      if (!probed || !pendingBound || !pendingAccount) throw new GithubError('auth_expired', 'GitHub authorization is not pending')
      if (elevationAccount && (accountKey !== elevationAccount || pendingAccount !== accountKey || !pendingScopes.includes('delete_repo'))) {
        rotateFlow()
        throw new GithubError('target_mismatch', 'Delete permission was not committed for this account')
      }
      if (pendingAccount !== accountKey) {
        rotateFlow()
        throw new GithubError('target_mismatch', 'GitHub authorization did not match the probed account')
      }
      secrets.access = secrets.pendingAccess
      secrets.refresh = secrets.pendingRefresh
      rotateFlow()
    },
    async discardPendingAuth(requestedFlowId) {
      if (requestedFlowId !== flowId) return
      rotateFlow()
    },
    async refresh() {
      const capturedGeneration = generation
      if (!secrets.refresh || capturedGeneration !== generation) return null
      secrets.access = 'gho_native_refreshed_fixture'
      return { scopes, expiresIn: 28_800 }
    },
    async hasAccess() {
      return secrets.access !== null
    },
    async logout() {
      secrets.access = null
      secrets.refresh = null
      cacheKey = null
      generation += 1
      rotateFlow()
      flowGeneration = generation
    },
    async seal(plaintext) {
      if (!cacheKey) {
        const raw = crypto.getRandomValues(new Uint8Array(32))
        cacheKey = bytesToBase64(raw)
      }
      return sealWith(cacheKey, plaintext)
    },
    async open(iv, ciphertext) {
      if (!cacheKey) throw new GithubError('persistence', 'Private cache is sealed')
      const key = await crypto.subtle.importKey('raw', base64ToBytes(cacheKey), { name: 'AES-GCM' }, false, ['decrypt'])
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext))
      return new TextDecoder().decode(plain)
    },
    async openDeviceLogin() {
      return undefined
    },
    async generation() {
      return generation
    },
    async allocateWriteAuthority() {
      return authority.allocate()
    },
    async currentWriteAuthority() {
      return authority.current()
    },
    async noteWriteEpoch(epoch, token) {
      authority.note(token, epoch)
    },
    peekSecrets() {
      return [secrets.device, secrets.pendingAccess, secrets.pendingRefresh, secrets.access ?? '', secrets.refresh ?? ''].filter(Boolean)
    },
  }
}

export function nativeSecretAccounts(): readonly GithubSecureAccount[] {
  return ['github.oauth.access', 'github.oauth.refresh', 'github.cache-key']
}
