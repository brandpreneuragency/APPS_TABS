import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { TabsDB } from '../db'
import { GithubError, assertNoClientSecret } from './errors'
import { draftId } from './identity'
import { createGithubService, type GithubService } from './service'
import { createFixtureTransport, jsonResponse } from './testing/fixtureTransport'
import { createMemorySecureStore } from './testing/memorySecureStore'
import { createNativeGithubTransport } from './transport'
import { GITHUB_PHASE1_SCOPE, GITHUB_SECURE_ACCOUNTS, type GithubClock, type GithubTransportRequest } from './types'

const TOKEN = 'gho_fixturetokenvalue'
const DEVICE = 'device-secret-value'
const PRIVATE_TEXT = 'PRIVATE_SENTINEL_do_not_leak'
const databases: TabsDB[] = []

function clock(): GithubClock & { advance(ms: number): void; sleeps: number[] } {
  let now = 1_000_000
  const sleeps: number[] = []
  return {
    now: () => now,
    sleeps,
    advance(ms: number) { now += ms },
    async sleep(ms: number, signal: AbortSignal) {
      if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
      sleeps.push(ms)
      now += ms
    },
  }
}

function personalRepo(name = 'notes', id = 42) {
  return {
    id, name, private: true, default_branch: 'main', description: null,
    owner: { id: 1001, login: 'octocat', type: 'User' },
    html_url: `https://github.com/octocat/${name}`,
  }
}

function fileBody(text: string) {
  return {
    type: 'file', encoding: 'base64', content: btoa(text), size: text.length,
    sha: 'blob1', path: 'README.md', name: 'README.md',
  }
}

class Fixture {
  polls = 0
  urls: string[] = []
  bodies: string[] = []
  userType = 'User'
  scope = 'repo'
  verificationUri = 'https://github.com/login/device'
  repos = [personalRepo(), {
    id: 9, name: 'org-repo', private: true,
    owner: { id: 50, login: 'acme', type: 'Organization' },
    html_url: 'https://github.com/acme/org-repo',
  }]
  fileText = '# hello'
  holdRepos: Promise<void> | null = null
  repoStatus = 200
  refreshSeen = ''

  async respond(request: GithubTransportRequest): Promise<ReturnType<typeof jsonResponse>> {
    this.urls.push(request.url)
    this.bodies.push(request.body ?? '')
    const url = request.url
    if (url.includes('/login/device/code')) {
      return jsonResponse(200, {
        device_code: DEVICE, user_code: 'WDJB-MJHT', verification_uri: this.verificationUri,
        expires_in: 900, interval: 5,
      })
    }
    if (url.includes('/login/oauth/access_token')) {
      this.refreshSeen = request.body ?? ''
      if (request.body?.includes('grant_type=refresh_token')) {
        return jsonResponse(200, { access_token: 'gho_refreshedtokenvalue', refresh_token: 'ghr_refreshedtokenvalue', expires_in: 28800, scope: 'repo', token_type: 'bearer' })
      }
      this.polls += 1
      if (this.polls === 1) return jsonResponse(200, { error: 'authorization_pending' })
      return jsonResponse(200, { access_token: TOKEN, refresh_token: 'ghr_initialtokenvalue', token_type: 'bearer', scope: this.scope, expires_in: 28800 })
    }
    if (url.includes('/user/repos')) {
      if (this.holdRepos) await this.holdRepos
      if (this.repoStatus === 401) return jsonResponse(401, { message: 'Bad credentials' })
      if (this.repoStatus === 429) return jsonResponse(429, { message: 'rate limit' }, { 'retry-after': '3' })
      const page = new URL(url).searchParams.get('page')
      if (page === '1') {
        return jsonResponse(200, this.repos, { link: '<https://api.github.com/user/repos?page=2>; rel="next"' })
      }
      return jsonResponse(200, [personalRepo('extra', 43)])
    }
    if (url.endsWith('/user')) return jsonResponse(200, { id: 1001, login: 'octocat', type: this.userType, name: 'Octo' })
    if (url.includes('/repositories/42')) return jsonResponse(200, personalRepo())
    if (url.includes('/branches/main')) return jsonResponse(200, { name: 'main', commit: { sha: 'abc123' }, protected: false })
    if (url.includes('/branches')) return jsonResponse(200, [{ name: 'main', commit: { sha: 'abc123' }, protected: false }, { name: 'dev', commit: { sha: 'def456' }, protected: true }])
    if (url.includes('/contents/README.md')) return jsonResponse(200, fileBody(this.fileText))
    if (url.includes('/contents/link')) return jsonResponse(200, { type: 'symlink', name: 'link', path: 'link', target: '../secret', sha: 's1', size: 0 })
    if (url.includes('/contents/mod')) return jsonResponse(200, { type: 'submodule', name: 'mod', path: 'mod', sha: 'm1', size: 0 })
    if (url.includes('/contents/lfs')) return jsonResponse(200, fileBody('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n'))
    if (url.includes('/contents/big')) return jsonResponse(200, { type: 'file', size: 2_000_000, path: 'big', name: 'big', sha: 'big' })
    if (url.includes('/contents')) return jsonResponse(200, [])
    return jsonResponse(404, { message: 'missing' })
  }
}

async function setup(fixture = new Fixture()) {
  const name = `GithubService-${crypto.randomUUID()}`
  const database = new TabsDB(name)
  databases.push(database)
  await database.open()
  const secure = createMemorySecureStore()
  const time = clock()
  const service = createGithubService({
    database,
    transport: createFixtureTransport((request) => fixture.respond(request)),
    secureStore: secure,
    clock: time,
  })
  return { database, secure, time, service, fixture }
}

async function connect(service: GithubService) {
  await service.configureClientId('Iv1.abc12345')
  const challenge = await service.beginDeviceBrowserSignIn()
  const account = await service.finishDeviceBrowserSignIn()
  return { challenge, account }
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('GitHub phase 1 service', () => {
  it('stays in setup until a public client ID exists and never accepts a secret', async () => {
    const { service, secure } = await setup()
    expect(service.getConnection().status).toBe('needs_setup')
    await expect(service.beginDeviceBrowserSignIn()).rejects.toMatchObject({ code: 'needs_setup' })
    expect(() => assertNoClientSecret({ client_secret: 'nope' })).toThrowError(expect.objectContaining({ code: 'client_secret_forbidden' }))
    await expect(service.configureClientId('gho_notaclient')).rejects.toMatchObject({ code: 'invalid_client_id' })
    expect(secure.dump()).toEqual({})
  })

  it('signs in with the device-browser flow and does not persist the token or device code', async () => {
    const ctx = await setup()
    const { challenge, account } = await connect(ctx.service)
    expect(challenge.browserUrl).toBe('https://github.com/login/device')
    expect(challenge).not.toHaveProperty('deviceCode')
    expect(ctx.time.sleeps[0]).toBeGreaterThanOrEqual(5000)
    expect(ctx.fixture.bodies.some((body) => body.includes(`scope=${GITHUB_PHASE1_SCOPE}`) && !body.includes('delete_repo') && !body.includes('client_secret'))).toBe(true)
    expect(account).toMatchObject({ id: '1001', login: 'octocat' })
    expect(ctx.service.getConnection()).toMatchObject({ status: 'connected', account: { id: '1001' } })
    const dumped = JSON.stringify(await Promise.all(ctx.database.tables.map((table) => table.toArray())))
    expect(dumped).not.toContain(TOKEN)
    expect(dumped).not.toContain(DEVICE)
    expect(ctx.secure.peek(GITHUB_SECURE_ACCOUNTS.access)).toBe(TOKEN)
    await expect(ctx.service.beginDeviceBrowserSignIn()).rejects.toMatchObject({ code: 'already_connected' })
  })

  it('drops organization repos, keeps drafts isolated, and restores the same draft after reopen', async () => {
    const ctx = await setup()
    await connect(ctx.service)
    const page = await ctx.service.listPersonalRepos()
    expect(page.items.map((repo) => repo.name)).toEqual(['notes', 'extra'])
    expect(page.complete).toBe(true)
    expect(ctx.fixture.urls.some((url) => url.includes('/orgs'))).toBe(false)
    expect(ctx.fixture.urls.some((url) => url.includes('raw.githubusercontent.com'))).toBe(false)
    const opened = await ctx.service.openFile('42', 'main', 'README.md')
    const draft = await ctx.service.saveDraft({
      repoId: '42', ref: 'main', path: 'README.md', baseCommitSha: opened.baseCommitSha ?? '',
      baseBlobSha: opened.baseBlobSha, originalText: opened.text, originalBinary: null,
      newText: 'edited draft', binary: false,
    })
    const other = await ctx.service.saveDraft({
      repoId: '42', ref: 'dev', path: 'README.md', baseCommitSha: 'def456', baseBlobSha: null,
      originalText: 'dev', originalBinary: null, newText: 'other branch', binary: false,
    })
    expect(draft.id).toBe(draftId('1001', '42', 'main', 'README.md'))
    expect(draft.id).not.toContain('notes')
    expect(other.id).not.toBe(draft.id)
    await ctx.service.setActiveRepo('43', 'main')
    await ctx.service.setActiveRepo('42', 'main')
    expect((await ctx.service.getBranchWorkspace('42', 'main'))?.selectedPath).toBe('README.md')
    ctx.database.close()
    const reopened = new TabsDB(ctx.database.name)
    databases.push(reopened)
    await reopened.open()
    const again = createGithubService({
      database: reopened,
      transport: createFixtureTransport((request) => ctx.fixture.respond(request)),
      secureStore: ctx.secure,
      clock: ctx.time,
    })
    const hydration = await again.hydrate()
    expect(hydration.connection).toMatchObject({ status: 'connected', account: { id: '1001' } })
    expect(hydration.drafts.find((item) => item.ref === 'main')?.newText).toBe('edited draft')
    expect(hydration.accountWorkspace?.activeRepoId).toBe('42')
  })

  it('closes repository tabs in local workspace state without a remote mutation', async () => {
    const ctx = await setup()
    await connect(ctx.service)
    await ctx.service.setActiveRepo('42', 'main')
    await ctx.service.setActiveRepo('43', 'dev')
    const requestCount = ctx.fixture.urls.length

    const afterActiveClose = await ctx.service.closeRepoTab('43')
    expect(afterActiveClose.openRepoIds).toEqual(['42'])
    expect(afterActiveClose.activeRepoId).toBe('42')
    expect(afterActiveClose.activeRefByRepo['43']).toBe('dev')
    expect(ctx.fixture.urls).toHaveLength(requestCount)

    const afterLastClose = await ctx.service.closeRepoTab('42')
    expect(afterLastClose.openRepoIds).toEqual([])
    expect(afterLastClose.activeRepoId).toBeNull()
    expect(ctx.fixture.urls).toHaveLength(requestCount)
  })

  it('seals private cache on logout, keeps drafts until an explicit delete, and rejects a late list', async () => {
    const ctx = await setup()
    ctx.fixture.fileText = PRIVATE_TEXT
    await connect(ctx.service)
    await ctx.service.listPersonalRepos()
    await ctx.service.openFile('42', 'main', 'README.md')
    await ctx.service.saveDraft({
      repoId: '42', ref: 'main', path: 'README.md', baseCommitSha: 'abc123', baseBlobSha: 'blob1',
      originalText: PRIVATE_TEXT, originalBinary: null, newText: 'keep me', binary: false,
    })
    const cacheRows = await ctx.database.githubPrivateCache.toArray()
    expect(JSON.stringify(cacheRows)).not.toContain(PRIVATE_TEXT)
    expect((await ctx.service.readPrivateCache('42', 'file', 'main:README.md')).status).toBe('available')
    await ctx.service.signOut()
    expect(ctx.secure.dump()).toEqual({})
    expect((await ctx.service.readPrivateCache('42', 'file', 'main:README.md')).status).toBe('sealed')
    expect((await ctx.service.listDrafts()).map((item) => item.newText)).toContain('keep me')
    await expect(ctx.service.deleteDrafts({ confirm: false as unknown as true, accountId: '1001' })).rejects.toMatchObject({ code: 'draft_delete_unconfirmed' })
    expect(await ctx.service.deleteDrafts({ confirm: true, accountId: '1001', repoId: '42', ref: 'main', path: 'README.md' })).toBe(1)
    expect(await ctx.service.listDrafts({ accountId: '999' })).toEqual([])

    const held = await setup()
    let release: () => void = () => undefined
    held.fixture.holdRepos = new Promise((resolve) => { release = resolve })
    await connect(held.service)
    const controller = new AbortController()
    const pending = held.service.listPersonalRepos(controller.signal)
    controller.abort()
    release()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(await held.database.githubPrivateCache.count()).toBe(0)
  })

  it('refreshes a device-flow token without a client secret and seals the session on expiry', async () => {
    const ctx = await setup()
    await ctx.service.configureClientId('Iv1.abc12345')
    await ctx.service.beginDeviceBrowserSignIn()
    await ctx.service.finishDeviceBrowserSignIn()
    ctx.time.advance(120_000)
    await ctx.database.githubAccounts.update('1001', { expiresAt: ctx.time.now() - 1000 })
    const hydrated = createGithubService({
      database: ctx.database, transport: createFixtureTransport((request) => ctx.fixture.respond(request)),
      secureStore: ctx.secure, clock: ctx.time,
    })
    await hydrated.hydrate()
    await hydrated.listPersonalRepos()
    expect(ctx.fixture.refreshSeen).toContain('grant_type=refresh_token')
    expect(ctx.fixture.refreshSeen).not.toContain('client_secret')
    ctx.fixture.repoStatus = 401
    await ctx.secure.delete(GITHUB_SECURE_ACCOUNTS.refresh)
    await expect(hydrated.listPersonalRepos()).rejects.toMatchObject({ code: 'auth_expired' })
    expect(hydrated.getConnection().status).toBe('auth_expired')
  })

  it('does not follow symlinks, submodules, or LFS pointers and reports empty directories', async () => {
    const ctx = await setup()
    await connect(ctx.service)
    await ctx.service.listPersonalRepos()
    expect((await ctx.service.listEntries('42', 'main', '')).items).toEqual([])
    expect((await ctx.service.openFile('42', 'main', 'link')).kind).toBe('symlink')
    expect((await ctx.service.openFile('42', 'main', 'mod')).kind).toBe('submodule')
    expect((await ctx.service.openFile('42', 'main', 'lfs')).kind).toBe('lfs_pointer')
    expect((await ctx.service.openFile('42', 'main', 'big')).kind).toBe('too_large')
    const empty = await ctx.service.listEntries('42', 'main', 'missing-dir')
    expect(empty.items).toEqual([])
    expect(empty.message).toContain('does not store empty directories')
    expect(ctx.fixture.urls.some((url) => url.includes('secret') || url.includes('raw.githubusercontent.com'))).toBe(false)
  })

  it('uses no fixture fallback outside Tauri', async () => {
    await expect(createNativeGithubTransport().request({
      method: 'GET', url: 'https://api.github.com/user', headers: {}, auth: 'bearer', timeoutMs: 1000,
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'native_unavailable' })
  })
})
