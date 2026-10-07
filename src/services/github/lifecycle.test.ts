import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { TabsDB } from '../db'
import { createGithubService, type GithubService } from './service'
import { createMemoryNativeSession } from './nativeSession'
import { buildRepoCreateBody } from './lifecycle'
import { createFixtureTransport, jsonResponse } from './testing/fixtureTransport'
import { createMemorySecureStore } from './testing/memorySecureStore'
import type { GithubClock, GithubTransportRequest, GithubTransportResponse, RepoDeleteSnapshot } from './types'
import { GITHUB_VERIFICATION_URI } from './types'

const databases: TabsDB[] = []

function clock(): GithubClock {
  let now = 1_000_000
  return {
    now: () => now,
    async sleep(_ms, signal) {
      if (signal.aborted) throw new Error('cancelled')
      now += 1
    },
  }
}

class LifeFixture {
  requests: GithubTransportRequest[] = []
  createStatus = 201
  createBody: Record<string, unknown> = {
    id: 77,
    name: 'notes',
    private: true,
    default_branch: 'main',
    owner: { id: 1001, login: 'octocat', type: 'User' },
    permissions: { admin: true },
    html_url: 'https://github.com/octocat/notes',
  }
  branchStatus = 409
  branchBody: Record<string, unknown> = { message: 'Git Repository is empty.' }
  deleteStatus = 204
  deleteReadback = 404
  userStatus = 200
  user = { id: 1001, login: 'octocat', type: 'User' }
  scopes = 'repo, delete_repo'
  repoName = 'notes'
  timeoutOn = ''
  posts = 0

  async respond(request: GithubTransportRequest): Promise<GithubTransportResponse> {
    this.requests.push(request)
    if (request.method === 'POST' && request.url.endsWith('/user/repos')) this.posts += 1
    if (request.method === 'DELETE') this.posts += 1
    if (this.timeoutOn && request.url.includes(this.timeoutOn) && request.method !== 'GET') {
      this.timeoutOn = ''
      throw Object.assign(new Error('timed out'), { code: 'timeout', name: 'GithubError' })
    }
    if (request.url.includes('/login/device/code')) {
      return jsonResponse(200, { device_code: 'device-secret-value', user_code: 'WDJB-MJHT', verification_uri: GITHUB_VERIFICATION_URI, expires_in: 900, interval: 5 })
    }
    if (request.url.includes('/login/oauth/access_token')) {
      return jsonResponse(200, { access_token: 'gho_fixturetokenvalue', token_type: 'bearer', scope: 'repo' })
    }
    if (request.url.endsWith('/user')) {
      return jsonResponse(this.userStatus, this.user, { 'x-oauth-scopes': this.scopes })
    }
    if (request.url.includes('/user/repos') && request.method === 'GET') return jsonResponse(200, [])
    if (request.url.includes('/gitignore/templates')) return jsonResponse(200, ['Node', 'Python'])
    if (request.url.endsWith('/licenses')) return jsonResponse(200, [{ key: 'mit', name: 'MIT License' }])
    if (request.method === 'POST' && request.url.endsWith('/user/repos')) {
      return jsonResponse(this.createStatus, this.createBody)
    }
    if (request.url.includes('/repositories/77') || request.url.includes('/repositories/42')) {
      if (request.method === 'GET' && this.deleteReadback === 404 && request.url.includes('/repositories/42') && this.posts > 0 && this.requests.some((item) => item.method === 'DELETE')) {
        return jsonResponse(404, { message: 'Not Found' })
      }
      return jsonResponse(200, {
        ...this.createBody,
        id: request.url.includes('/42') ? 42 : 77,
        name: this.repoName,
        permissions: { admin: true },
      })
    }
    if (request.url.includes('/branches/')) return jsonResponse(this.branchStatus, this.branchBody)
    if (request.method === 'DELETE') return jsonResponse(this.deleteStatus, {})
    return jsonResponse(404, { message: 'missing' })
  }
}

async function setup(fixture = new LifeFixture()) {
  const database = new TabsDB(`GithubPhase3-${crypto.randomUUID()}`)
  databases.push(database)
  await database.open()
  const secure = createMemorySecureStore()
  const service = createGithubService({
    database,
    transport: createFixtureTransport((request) => fixture.respond(request)),
    secureStore: secure,
    clock: clock(),
  })
  await service.configureClientId('Iv1.abc12345')
  await service.beginDeviceBrowserSignIn()
  await service.finishDeviceBrowserSignIn()
  return { service, fixture, secure }
}

function confirmation(name = 'notes') {
  return { confirm: true as const, accountId: '1001', ownerLogin: 'octocat', repoName: name, aiDerived: false, proposalId: null }
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('repository lifecycle', () => {
  it('sends private true by default and reads back owner, id, and an empty branch', async () => {
    const { service, fixture } = await setup()
    const result = await service.createRepository({ form: { name: 'notes', description: 'Notes' }, confirmation: confirmation() })
    expect(result.status).toBe('created')
    const body = JSON.parse(fixture.requests.find((request) => request.method === 'POST' && request.url.endsWith('/user/repos'))?.body ?? '{}') as Record<string, unknown>
    expect(body.private).toBe(true)
    expect(body.auto_init).toBe(false)
    expect(Object.hasOwn(body, 'private')).toBe(true)
    if (result.status === 'created') {
      expect(result.readback).toMatchObject({ id: '77', ownerLogin: 'octocat', fullName: 'octocat/notes', private: true, branchExists: false, empty: true })
      expect(result.appliedToActive).toBe(false)
    }
    expect(fixture.posts).toBe(1)
  })

  it('sends an explicit public option and template initial commit', () => {
    const built = buildRepoCreateBody({ name: 'notes', visibility: 'public', readme: false, gitignoreTemplate: 'Node', licenseTemplate: 'mit' })
    expect(built.body).toMatchObject({ private: false, auto_init: true, gitignore_template: 'Node', license_template: 'mit' })
    expect(built.initialCommitRequested).toBe(true)
  })

  it('does not apply a create after the account changes and does not retry a timed-out create', async () => {
    const { service, fixture } = await setup()
    fixture.timeoutOn = '/user/repos'
    const ambiguous = await service.createRepository({ form: { name: 'notes' }, confirmation: confirmation() })
    expect(ambiguous.status === 'ambiguous' || ambiguous.status === 'not_applied').toBe(true)
    expect(fixture.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/user/repos'))).toHaveLength(1)
    fixture.user = { id: 9, login: 'other', type: 'User' }
    fixture.createStatus = 201
    const switched = await service.createRepository({ form: { name: 'notes' }, confirmation: confirmation() })
    expect(switched.status === 'mismatch' || switched.status === 'stale_target' || switched.status === 'ambiguous').toBe(true)
    expect(switched.appliedToActive).toBe(false)
  })

  it('rejects a mismatched delete confirmation and does not call DELETE', async () => {
    const { service, fixture } = await setup()
    const snapshot = snapshotOf()
    const mismatch = await service.deleteRepository({
      confirm: true,
      typedOwnerRepo: 'octocat/other',
      snapshot,
      aiDerived: false,
    })
    expect(mismatch.status).toBe('mismatch')
    expect(fixture.requests.some((request) => request.method === 'DELETE')).toBe(false)
    expect(mismatch.draftsRetained).toBe(true)
    expect(mismatch.cacheDestroyed).toBe(false)
  })

  it('asks for delete_repo instead of deleting when the live scope header lacks it', async () => {
    const { service, fixture } = await setup()
    fixture.scopes = 'repo'
    const result = await service.deleteRepository({
      confirm: true,
      typedOwnerRepo: 'octocat/notes',
      snapshot: snapshotOf(),
      aiDerived: false,
    })
    expect(result.status).toBe('needs_scope')
    if (result.status === 'needs_scope') expect(result.requiredScopes).toEqual(['repo', 'delete_repo'])
    expect(fixture.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('treats 401, 403, 404, 429 and 5xx as not deleted and keeps drafts', async () => {
    const { service, fixture } = await setup()
    await service.saveDraft({
      repoId: '42', ref: 'main', path: 'README.md', baseCommitSha: 'a'.repeat(40), baseBlobSha: null,
      originalText: 'a', originalBinary: null, newText: 'b', binary: false,
    })
    for (const status of [401, 403, 404, 429, 500]) {
      fixture.deleteStatus = status
      fixture.posts = 0
      const result = await service.deleteRepository({
        confirm: true,
        typedOwnerRepo: 'octocat/notes',
        snapshot: snapshotOf(),
        aiDerived: false,
      })
      expect(result.status === 'deleted').toBe(false)
      expect(result.draftsRetained).toBe(true)
      expect(result.cacheDestroyed).toBe(false)
    }
    expect((await service.listDrafts()).length).toBeGreaterThan(0)
  })

  it('confirms deletion only after an authenticated absence readback', async () => {
    const { service, fixture } = await setup()
    fixture.deleteStatus = 204
    fixture.deleteReadback = 404
    const result = await service.deleteRepository({
      confirm: true,
      typedOwnerRepo: 'octocat/notes',
      snapshot: snapshotOf(),
      aiDerived: false,
    })
    expect(result).toMatchObject({ status: 'deleted', draftsRetained: true, cacheDestroyed: false })
    const dismissed = await service.dismissLocalRepo('42')
    expect(fixture.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
    expect(dismissed.openRepoIds).not.toContain('42')
  })

  it('does not put native device or access secrets on the sign-in challenge', async () => {
    const database = new TabsDB(`GithubNative-${crypto.randomUUID()}`)
    databases.push(database)
    await database.open()
    const native = createMemoryNativeSession()
    const service: GithubService = createGithubService({
      database,
      transport: createFixtureTransport(() => jsonResponse(404, { message: 'fixture transport must not see tokens' })),
      secureStore: createMemorySecureStore(),
      clock: clock(),
      nativeSession: native,
    })
    await service.configureClientId('Iv1.abc12345')
    const challenge = await service.beginDeviceBrowserSignIn()
    const visible = JSON.stringify({ challenge, connection: service.getConnection() })
    for (const secret of native.peekSecrets()) expect(visible).not.toContain(secret)
    expect(challenge.browserUrl).toBe(GITHUB_VERIFICATION_URI)
    const account = await service.finishDeviceBrowserSignIn()
    expect(account.id).toBe('1001')
    expect(JSON.stringify(account)).not.toContain('gho_')
    const sealed = await service.readPrivateCache('1', 'repos')
    expect(sealed.status).toBe('missing')
    await service.signOut()
    expect((await service.readPrivateCache('1', 'repos')).status).toBe('sealed')
  })
})

function snapshotOf(): RepoDeleteSnapshot {
  return {
    accountId: '1001',
    accountLogin: 'octocat',
    ownerId: '1001',
    ownerLogin: 'octocat',
    repoId: '42',
    repoName: 'notes',
    fullName: 'octocat/notes',
    private: true,
    grantedScopes: ['repo', 'delete_repo'],
    permission: 'admin',
    capturedAt: 1,
  }
}
