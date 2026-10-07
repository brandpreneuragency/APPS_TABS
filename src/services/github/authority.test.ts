import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { TabsDB } from '../db'
import { createGithubService } from './service'
import { createMemoryNativeSession, createSharedWriteAuthority } from './nativeSession'
import { createFixtureTransport, jsonResponse } from './testing/fixtureTransport'
import { createMemorySecureStore } from './testing/memorySecureStore'
import type { GithubClock, GithubTransportRequest, GithubTransportResponse } from './types'
import { exactCommitMessage } from './gitProtocol'

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
    async sleep(_ms, signal) {
      if (signal.aborted) throw new Error('cancelled')
      now += 1
    },
  }
}

class RestoreFixture {
  requests: GithubTransportRequest[] = []
  head = BASE

  async respond(request: GithubTransportRequest): Promise<GithubTransportResponse> {
    this.requests.push(request)
    const url = request.url
    if (url.includes('/user/repos') && request.method === 'GET') {
      return jsonResponse(200, [{ id: 42, name: 'notes', private: false, default_branch: 'main', owner: { id: 1001, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/notes' }])
    }
    if (url.includes('/repositories/42')) {
      return jsonResponse(200, { id: 42, name: 'notes', private: false, default_branch: 'main', owner: { id: 1001, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/notes' })
    }
    if (url.includes('/contents/')) {
      return jsonResponse(200, { type: 'file', encoding: 'base64', content: btoa('restored line\n'), size: 14, sha: '9'.repeat(40), path: 'README.md' })
    }
    if (url.includes('/branches?')) return jsonResponse(200, [{ name: 'main', commit: { sha: this.head }, protected: false }])
    if (url.includes('/branches/main')) return jsonResponse(200, { name: 'main', commit: { sha: this.head, commit: { message: 'old' } }, protected: false })
    if (url.includes('/git/commits/') && request.method === 'GET') return jsonResponse(200, { sha: this.head, message: 'old', tree: { sha: TREE }, parents: [] })
    if (url.includes('/git/trees/')) return jsonResponse(200, { sha: TREE, truncated: false, tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: '1'.repeat(40), size: 14 }] })
    if (url.includes('/git/blobs') && request.method === 'POST') return jsonResponse(201, { sha: BLOB })
    if (url.includes('/git/trees') && request.method === 'POST') return jsonResponse(201, { sha: NEWTREE })
    if (url.includes('/git/commits') && request.method === 'POST') return jsonResponse(201, { sha: NEXT, message: 'save notes', parents: [{ sha: BASE }], tree: { sha: NEWTREE } })
    if (request.method === 'PATCH' && url.includes('/git/refs/')) {
      this.head = NEXT
      return jsonResponse(200, { ref: 'refs/heads/main', object: { sha: NEXT, type: 'commit' } })
    }
    return jsonResponse(404, { message: 'missing' })
  }
}

async function connect(service: ReturnType<typeof createGithubService>) {
  await service.configureClientId('Iv1.abc12345')
  await service.beginDeviceBrowserSignIn()
  await service.finishDeviceBrowserSignIn()
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('shared native write authority', () => {
  it('accepts a recreated service and keeps an old queued request off the transport', async () => {
    const authority = createSharedWriteAuthority()
    const database1 = new TabsDB(`GithubAuthorityA-${crypto.randomUUID()}`)
    const database2 = new TabsDB(`GithubAuthorityB-${crypto.randomUUID()}`)
    databases.push(database1, database2)
    await database1.open()
    await database2.open()
    const fixture1 = new RestoreFixture()
    const fixture2 = new RestoreFixture()
    const native1 = createMemoryNativeSession({ authority, user: { id: '1001', login: 'octocat' } })
    const native2 = createMemoryNativeSession({ authority, user: { id: '1001', login: 'octocat' } })
    const service1 = createGithubService({
      database: database1,
      transport: createFixtureTransport((request) => fixture1.respond(request)),
      secureStore: createMemorySecureStore(),
      clock: clock(),
      nativeSession: native1,
    })
    await connect(service1)
    await service1.listPersonalRepos()
    await service1.setActiveRepo('42', 'main')
    const authGeneration = await native1.generation()
    expect(authGeneration).toBe(1)
    const switched = await native1.currentWriteAuthority()
    expect(switched.epoch).toBeGreaterThan(1)

    let release: (value?: void) => void = () => undefined
    let waiting = false
    const original = native1.currentWriteAuthority.bind(native1)
    native1.currentWriteAuthority = async () => {
      waiting = true
      await new Promise<void>((resolve) => { release = resolve })
      return original()
    }
    const before = fixture1.requests.length
    const queued = service1.openFile('42', 'main', 'README.md')
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (waiting) {
          clearInterval(timer)
          resolve()
        }
      }, 1)
    })

    const service2 = createGithubService({
      database: database2,
      transport: createFixtureTransport((request) => fixture2.respond(request)),
      secureStore: createMemorySecureStore(),
      clock: clock(),
      nativeSession: native2,
    })
    await connect(service2)
    const repos = await service2.listPersonalRepos()
    expect(repos.items.map((item) => item.name)).toContain('notes')
    const file = await service2.openFile('42', 'main', 'README.md')
    expect(file.text).toBe('restored line\n')
    const draft = await service2.saveDraft({
      repoId: '42', ref: 'main', path: 'README.md', baseCommitSha: BASE, baseBlobSha: '1'.repeat(40),
      originalText: 'restored line\n', originalBinary: null, newText: 'saved line\n', binary: false,
    })
    const committed = await service2.commitSelected({
      confirm: true,
      accountId: '1001',
      repoId: '42',
      ref: 'main',
      expectedBaseSha: BASE,
      sentMessage: exactCommitMessage('save notes', COMMIT_ID),
      commitId: COMMIT_ID,
      draftVersions: [{ path: draft.path, editVersion: draft.editVersion }],
    })
    expect(committed.status).toBe('sent')
    expect(await native2.generation()).toBe(1)
    const replacement = await native2.currentWriteAuthority()
    expect(replacement.token).not.toBe(switched.token)
    expect(replacement.epoch).toBeGreaterThan(switched.epoch)

    release()
    await expect(queued).rejects.toMatchObject({ code: 'stale_target' })
    expect(fixture1.requests).toHaveLength(before)
    expect(fixture2.requests.some((request) => request.method !== 'GET')).toBe(true)
  })
})
