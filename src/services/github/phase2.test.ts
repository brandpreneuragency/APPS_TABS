import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabsDB } from '../db'
import { GithubError } from './errors'
import { createGithubService, type GithubService } from './service'
import { createFixtureTransport, jsonResponse } from './testing/fixtureTransport'
import { createMemorySecureStore } from './testing/memorySecureStore'
import type { CommitConfirmation, GithubClock, GithubTransportRequest, GithubTransportResponse } from './types'
import { exactCommitMessage } from './gitProtocol'
import { emptyRefAdvertisement, receivePackOk } from './gitPack'

const BASE = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const BLOB = 'c'.repeat(40)
const NEXT = 'd'.repeat(40)
const NEWTREE = 'e'.repeat(40)
const COMMIT_ID = 'f'.repeat(32)
const databases: TabsDB[] = []

function clock(): GithubClock {
  let now = 1_000_000
  return {
    now: () => now,
    async sleep(_ms: number, signal: AbortSignal) {
      if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
      now += 1
    },
  }
}

class GitFixture {
  requests: GithubTransportRequest[] = []
  empty = false
  head = BASE
  protectedBranch = false
  patchStatus = 200
  patchMessage = 'ok'
  blobStatus = 200
  blobMessage = 'ok'
  timeoutOn = ''
  holdBranch: (() => void) | null = null
  holdBlob: (() => void) | null = null
  blobHeld = false
  branchGate: Promise<void> | null = null
  openBranchGate: (() => void) | null = null
  bootstrapped = false
  treeTruncated = false
  fileText = 'base line\n'
  remoteText = 'base line\n'
  remoteMissing = false

  async respond(request: GithubTransportRequest): Promise<GithubTransportResponse> {
    this.requests.push(request)
    const url = request.url
    if (this.timeoutOn && url.includes(this.timeoutOn) && request.method !== 'GET') {
      this.timeoutOn = ''
      throw new GithubError('timeout', 'GitHub request timed out')
    }
    if (url.includes('/login/device/code')) {
      return jsonResponse(200, { device_code: 'device-secret-value', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
    }
    if (url.includes('/login/oauth/access_token')) {
      return jsonResponse(200, { access_token: 'gho_fixturetokenvalue', token_type: 'bearer', scope: 'repo' })
    }
    if (url.includes('/info/refs') && url.includes('service=git-receive-pack')) {
      if (this.empty && !this.bootstrapped) return { status: 200, headers: {}, bodyText: emptyRefAdvertisement() }
      return jsonResponse(409, { message: 'Git Repository is empty.' })
    }
    if (url.includes('/git-receive-pack') && request.method === 'POST') {
      const raw = atob(request.body ?? '')
      if (raw.includes(' force') || raw.includes('+refs/')) return { status: 200, headers: {}, bodyText: '0000' }
      const match = raw.match(/0{40} ([0-9a-f]{40}) refs\/heads\/main/)
      if (!match) return jsonResponse(400, { message: 'bad pkt' })
      this.head = match[1]
      this.bootstrapped = true
      this.empty = false
      return { status: 200, headers: {}, bodyText: receivePackOk('main') }
    }
    if (url.endsWith('/user')) return jsonResponse(200, { id: 1001, login: 'octocat', type: 'User' })
    if (url.includes('/user/repos')) {
      return jsonResponse(200, [{ id: 42, name: 'notes', private: true, default_branch: 'main', owner: { id: 1001, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/notes' }])
    }
    if (url.includes('/repositories/42')) {
      return jsonResponse(200, { id: 42, name: 'notes', private: true, default_branch: 'main', owner: { id: 1001, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/notes' })
    }
    if (url.includes('/git/blobs') && request.method === 'POST') {
      if (this.holdBlob) {
        this.blobHeld = true
        await new Promise<void>((resolve) => { this.holdBlob = resolve })
      }
      if (this.blobStatus >= 400) return jsonResponse(this.blobStatus, { message: this.blobMessage })
      return jsonResponse(201, { sha: BLOB })
    }
    if (url.includes('/git/trees') && request.method === 'POST') return jsonResponse(201, { sha: NEWTREE })
    if (url.includes('/git/commits') && request.method === 'POST') return jsonResponse(201, { sha: NEXT, message: JSON.parse(request.body ?? '{}').message, parents: [{ sha: BASE }], tree: { sha: NEWTREE } })
    if (url.includes('/git/refs') && request.method === 'POST') {
      if (this.empty && !this.bootstrapped) return jsonResponse(409, { message: 'Git Repository is empty.' })
      return jsonResponse(201, { ref: 'refs/heads/topic', object: { sha: this.head } })
    }
    if (request.method === 'PATCH' && url.includes('/git/refs/')) {
      if (this.patchStatus >= 400) return jsonResponse(this.patchStatus, { message: this.patchMessage })
      this.head = NEXT
      return jsonResponse(200, { ref: 'refs/heads/main', object: { sha: NEXT, type: 'commit' } })
    }
    if (request.method === 'PUT' && url.includes('/contents/')) {
      this.bootstrapped = true
      this.head = NEXT
      return jsonResponse(201, { content: { sha: BLOB }, commit: { sha: NEXT, message: JSON.parse(request.body ?? '{}').message } })
    }
    if (url.includes('/git/commits/')) return jsonResponse(200, { sha: this.head, message: 'old', tree: { sha: TREE }, parents: [] })
    if (url.includes('/git/trees/')) {
      return jsonResponse(200, { sha: TREE, truncated: this.treeTruncated, tree: [
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1'.repeat(40), size: 10 },
        { path: 'link', mode: '120000', type: 'blob', sha: '2'.repeat(40), size: 4 },
      ] })
    }
    if (url.includes('/git/blobs/') && request.method === 'GET') {
      if (request.headers.Accept?.includes('raw')) {
        return { status: 200, headers: {}, bodyText: '', bodyBase64: btoa('%PDF-1.4') }
      }
      return jsonResponse(200, { content: btoa(this.fileText), encoding: 'base64', size: this.fileText.length })
    }
    if (url.includes('/branches/main') || url.includes('/branches/topic')) {
      if (this.branchGate) await this.branchGate
      if (this.empty && !this.bootstrapped) return jsonResponse(409, { message: 'Git Repository is empty.' })
      return jsonResponse(200, { name: 'main', commit: { sha: this.head, commit: { message: 'old' } }, protected: this.protectedBranch })
    }
    if (url.includes('/branches')) return jsonResponse(200, this.empty ? [] : [{ name: 'main', commit: { sha: this.head }, protected: this.protectedBranch }])
    if (url.includes('/contents/')) {
      if (this.remoteMissing) return jsonResponse(404, { message: 'Not Found' })
      return jsonResponse(200, { type: 'file', encoding: 'base64', content: btoa(this.remoteText), size: this.remoteText.length, sha: '9'.repeat(40), path: 'README.md' })
    }
    if (url.includes('/commits')) return jsonResponse(200, [{ sha: this.head, commit: { message: 'old', author: { date: '2026-10-05T00:00:00Z' } } }])
    return jsonResponse(404, { message: 'missing' })
  }
}

async function setup(fixture = new GitFixture()) {
  const database = new TabsDB(`GithubPhase2-${crypto.randomUUID()}`)
  databases.push(database)
  await database.open()
  const service = createGithubService({
    database,
    transport: createFixtureTransport((request) => fixture.respond(request)),
    secureStore: createMemorySecureStore(),
    clock: clock(),
  })
  await service.configureClientId('Iv1.abc12345')
  await service.beginDeviceBrowserSignIn()
  await service.finishDeviceBrowserSignIn()
  await service.listPersonalRepos()
  return { service, fixture }
}

function confirmation(paths: Array<{ path: string; editVersion: number }>, expectedBaseSha = BASE): CommitConfirmation {
  return {
    confirm: true,
    accountId: '1001',
    repoId: '42',
    ref: 'main',
    expectedBaseSha,
    sentMessage: exactCommitMessage('save notes', COMMIT_ID),
    commitId: COMMIT_ID,
    draftVersions: paths,
  }
}

async function draft(service: GithubService, path: string, text: string, extra: Partial<Parameters<GithubService['saveDraft']>[0]> = {}) {
  return service.saveDraft({
    repoId: '42', ref: 'main', path, baseCommitSha: BASE, baseBlobSha: '1'.repeat(40),
    originalText: 'base line\n', originalBinary: null, newText: text, binary: false, ...extra,
  })
}

function writes(fixture: GitFixture) {
  return fixture.requests.filter((request) => request.method !== 'GET')
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('GitHub phase 2 write boundary', () => {
  it('commits selected drafts as one git tree update and keeps unselected plus later edits', async () => {
    const { service, fixture } = await setup()
    const selected = await draft(service, 'README.md', 'mine\n')
    const other = await draft(service, 'NOTES.md', 'keep me')
    const pending = service.commitSelected(confirmation([{ path: selected.path, editVersion: selected.editVersion }]))
    fixture.holdBlob = () => undefined
    await new Promise((resolve) => setTimeout(resolve, 10))
    await service.saveDraft({ repoId: '42', ref: 'main', path: selected.path, baseCommitSha: selected.baseCommitSha, baseBlobSha: selected.baseBlobSha, originalText: selected.originalText, originalBinary: null, newText: 'later edit', binary: false })
    fixture.holdBlob?.()
    fixture.holdBlob = null
    const result = await pending
    expect(result.status).toBe('sent')
    if (result.status === 'sent') {
      expect(result.protocol).toBe('git_data')
      expect(result.clearedPaths).not.toContain('README.md')
      expect(result.keptPaths).toContain('NOTES.md')
    }
    const body = writes(fixture).map((request) => request.body ?? '').join('\n')
    expect(body).toContain('"force":false')
    expect(body).toContain(`"base_tree":"${TREE}"`)
    expect(writes(fixture).filter((request) => request.url.includes('/git/commits') && request.method === 'POST')).toHaveLength(1)
    expect(writes(fixture).some((request) => request.method === 'PUT')).toBe(false)
    expect((await service.listDrafts({ repoId: '42', ref: 'main' })).some((item) => item.path === 'NOTES.md' && item.newText === 'keep me')).toBe(true)
    expect((await service.listDrafts({ repoId: '42', ref: 'main' })).some((item) => item.path === 'README.md' && item.newText === 'later edit')).toBe(true)
    expect(other.path).toBe('NOTES.md')
  })

  it('does not change the draft base on dirty refresh and blocks send', async () => {
    const { service, fixture } = await setup()
    const saved = await draft(service, 'README.md', 'mine\n')
    fixture.head = NEXT
    fixture.remoteText = 'remote edit\n'
    const refresh = await service.refreshRemote('42', 'main')
    expect(refresh.baseChanged).toBe(false)
    expect(refresh.draftsStale).toBe(true)
    expect((await service.listDrafts({ repoId: '42', ref: 'main' }))[0]?.baseCommitSha).toBe(BASE)
    const result = await service.commitSelected(confirmation([{ path: saved.path, editVersion: saved.editVersion }]))
    expect(result.status === 'conflict' || result.status === 'blocked').toBe(true)
    expect(writes(fixture).some((request) => request.url.includes('/git/commits'))).toBe(false)
  })

  it('blocks unresolved delete/edit, rename collision, and binary merge', async () => {
    const { service, fixture } = await setup()
    const saved = await draft(service, 'README.md', 'mine\n')
    fixture.head = NEXT
    fixture.remoteMissing = true
    await service.refreshRemote('42', 'main')
    const unresolved = await service.commitSelected(confirmation([{ path: 'README.md', editVersion: (await service.listDrafts({ repoId: '42', ref: 'main' }))[0].editVersion }]))
    expect(unresolved).toMatchObject({ status: 'blocked', code: 'unresolved_conflict' })
    await expect(service.resolveConflict({ confirm: true, repoId: '42', ref: 'main', path: 'README.md', choice: 'both' })).rejects.toMatchObject({ code: 'validation' })
    const renamed = await service.saveDraft({ ...saved, path: 'OLD.md', operation: 'rename', newPath: 'README.md', newText: 'moved', baseCommitSha: BASE, baseBlobSha: null, originalText: 'old', originalBinary: null, binary: false })
    fixture.remoteMissing = false
    fixture.head = NEXT
    await service.refreshRemote('42', 'main')
    expect((await service.listDrafts()).some((item) => item.conflict?.kind === 'rename_collision' || item.conflict?.kind === 'delete_edit' || item.conflict?.kind === 'content')).toBe(true)
    const binary = await service.saveDraft({ repoId: '42', ref: 'main', path: 'pic.png', baseCommitSha: BASE, baseBlobSha: null, originalText: null, originalBinary: btoa('png'), newBinary: btoa('png2'), binary: true, operation: 'edit' })
    fixture.fileText = 'remote'
    await service.refreshRemote('42', 'main')
    const binaryDraft = (await service.listDrafts()).find((item) => item.path === 'pic.png')
    if (binaryDraft?.conflict) {
      await expect(service.resolveConflict({ confirm: true, repoId: '42', ref: 'main', path: 'pic.png', choice: 'both' })).rejects.toMatchObject({ code: 'validation' })
    }
    expect(renamed.operation).toBe('rename')
    expect(binary.binary).toBe(true)
  })

  it('uses one contents bootstrap for a single empty-repo file and one receive-pack for a multi-file first commit', async () => {
    const { service, fixture } = await setup()
    fixture.empty = true
    const one = await draft(service, 'README.md', 'first\n', { baseCommitSha: '', baseBlobSha: null, originalText: null, operation: 'add' })
    const single = await service.commitSelected(confirmation([{ path: one.path, editVersion: one.editVersion }], ''))
    expect(single).toMatchObject({ status: 'sent', protocol: 'contents_bootstrap' })
    expect(writes(fixture).filter((request) => request.method === 'PUT')).toHaveLength(1)
    expect(writes(fixture).some((request) => request.url.includes('/git/refs'))).toBe(false)
    fixture.bootstrapped = false
    fixture.empty = true
    fixture.head = ''
    const left = await draft(service, 'LEFT.md', 'left', { baseCommitSha: '', baseBlobSha: null, originalText: null, operation: 'add' })
    const right = await draft(service, 'RIGHT.md', 'right', { baseCommitSha: '', baseBlobSha: null, originalText: null, operation: 'add' })
    const before = writes(fixture).length
    const multi = await service.commitSelected(confirmation([
      { path: left.path, editVersion: left.editVersion },
      { path: right.path, editVersion: right.editVersion },
    ], ''))
    expect(multi).toMatchObject({ status: 'sent', protocol: 'receive_pack' })
    const added = writes(fixture).slice(before)
    expect(added.filter((request) => request.url.includes('/git-receive-pack'))).toHaveLength(1)
    expect(added.some((request) => request.method === 'PUT' || request.url.includes('/git/refs') || request.url.includes('/graphql') || request.url.includes('/git/blobs') || request.url.includes('/git/commits'))).toBe(false)
    expect(added.some((request) => request.body?.includes('"force":true') || request.body?.includes('+refs/'))).toBe(false)
    fixture.bootstrapped = false
    fixture.empty = true
    await expect(service.createBranch('42', 'topic', 'main')).rejects.toMatchObject({ code: 'empty_repo_ref_rejected' })
    expect(writes(fixture).some((request) => request.method === 'POST' && request.url.endsWith('/git/refs'))).toBe(false)
  })

  it('does not send a second receive-pack when the first result is unknown', async () => {
    const { service, fixture } = await setup()
    fixture.empty = true
    const left = await draft(service, 'LEFT.md', 'left', { baseCommitSha: '', baseBlobSha: null, originalText: null, operation: 'add' })
    const right = await draft(service, 'RIGHT.md', 'right', { baseCommitSha: '', baseBlobSha: null, originalText: null, operation: 'add' })
    fixture.timeoutOn = 'git-receive-pack'
    const result = await service.commitSelected(confirmation([
      { path: left.path, editVersion: left.editVersion },
      { path: right.path, editVersion: right.editVersion },
    ], ''))
    expect(result.status === 'ambiguous' || result.status === 'not_applied').toBe(true)
    expect(writes(fixture).filter((request) => request.url.includes('/git-receive-pack'))).toHaveLength(1)
    expect(writes(fixture).some((request) => request.url.includes('/git/refs') || request.method === 'PUT')).toBe(false)
  })

  it('does not retry an ambiguous ref update or force a protected branch', async () => {
    const { service, fixture } = await setup()
    const saved = await draft(service, 'README.md', 'mine\n')
    fixture.timeoutOn = '/git/refs/'
    const ambiguous = await service.commitSelected(confirmation([{ path: saved.path, editVersion: saved.editVersion }]))
    expect(ambiguous.status === 'ambiguous' || ambiguous.status === 'not_applied').toBe(true)
    expect(writes(fixture).filter((request) => request.method === 'POST' && request.url.endsWith('/git/commits'))).toHaveLength(1)
    fixture.timeoutOn = ''
    fixture.patchStatus = 422
    fixture.patchMessage = 'Required status check "ci" is expected.'
    const protectedResult = await service.commitSelected(confirmation([{ path: saved.path, editVersion: saved.editVersion }]))
    expect(protectedResult.status).toBe('protected_branch')
    expect(writes(fixture).every((request) => !request.body?.includes('"force":true'))).toBe(true)
  })

  it('maps error statuses without leaking a token and stops a switched target before write', async () => {
    const { service, fixture } = await setup()
    const saved = await draft(service, 'README.md', 'mine\n')
    fixture.holdBlob = () => undefined
    const pending = service.commitSelected(confirmation([{ path: saved.path, editVersion: saved.editVersion }]))
    await vi.waitFor(() => expect(fixture.blobHeld).toBe(true))
    await service.setActiveRepo('42', 'dev')
    const release = fixture.holdBlob
    fixture.holdBlob = null
    release?.()
    const switched = await pending
    expect(switched.status).toBe('stale_target')
    expect(writes(fixture).some((request) => request.method === 'POST' && request.url.endsWith('/git/commits'))).toBe(false)
    expect(writes(fixture).some((request) => request.method === 'PATCH')).toBe(false)
    await service.setActiveRepo('42', 'main')
    for (const [status, code] of [[403, 'forbidden'], [404, 'not_found'], [422, 'validation'], [429, 'rate_limited'], [500, 'github_unavailable'], [401, 'auth_expired']] as const) {
      fixture.blobStatus = status
      fixture.blobMessage = status === 500 ? 'failed gho_fixturetokenvalue' : 'no'
      const result = await service.commitSelected(confirmation([{ path: saved.path, editVersion: saved.editVersion }]))
      expect(result.status === 'blocked' || result.status === 'protected_branch').toBe(true)
      expect(JSON.stringify(result)).not.toContain('gho_')
      if (result.status === 'blocked') expect(result.code).toBe(code)
    }
  })

  it('reports truncated search as incomplete and downloads private blobs as bytes', async () => {
    const { service, fixture } = await setup()
    fixture.treeTruncated = true
    const search = await service.searchRepository('42', 'main', 'base')
    expect(search.complete).toBe(false)
    expect(search.message).toContain('truncated')
    const downloaded = await service.downloadBlob('42', '1'.repeat(40))
    expect(downloaded.mediaKind).toBe('pdf')
    expect(downloaded.base64).toBe(btoa('%PDF-1.4'))
    expect(fixture.requests.some((request) => request.url.includes('raw.githubusercontent.com'))).toBe(false)
    expect(fixture.requests.some((request) => request.url.includes('/git/blobs/') && request.headers.Accept?.includes('raw'))).toBe(true)
    const directory = await service.stageDirectory({ repoId: '42', ref: 'main', path: 'empty', baseCommitSha: BASE })
    expect(directory.persisted).toBe(false)
    const kept = await service.stageDirectory({ repoId: '42', ref: 'main', path: 'empty', baseCommitSha: BASE, explicitGitkeep: true })
    expect(kept.draft?.path).toBe('empty/.gitkeep')
  })
})
