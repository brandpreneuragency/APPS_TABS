import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyFile } from './api'
import { draftId } from './identity'
import { acknowledgeCommittedDraft, putDraft } from './persistence'
import { parseRefAdvertisement, parseRefAdvertisementBytes, advertisedRef, pktLine } from './gitPack'
import { inspectGithubRequest, nextLink } from './policy'
import { searchTreeAndDrafts } from './search'
import { runAtomicCommit } from './commit'
import { exactCommitMessage } from './gitProtocol'
import { createPersonalRepo } from './lifecycle'
import { GithubError } from './errors'

const databases: Dexie[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

function draftDb() {
  const database = new Dexie(`review-fixes-${crypto.randomUUID()}`)
  databases.push(database)
  database.version(1).stores({ githubDrafts: 'id, accountId, repoId, [accountId+repoId+ref], updatedAt' })
  return database
}

const seed = {
  accountId: '7',
  repoId: '42',
  ref: 'main',
  path: 'README.md',
  baseCommitSha: 'a'.repeat(40),
  baseBlobSha: 'b'.repeat(40),
  originalText: 'base',
  originalBinary: null,
  newText: 'seed',
  newBinary: null,
  binary: false,
  now: 1,
}

describe('review blocker regressions', () => {
  it('lets only one parallel CAS write win the same expected version', async () => {
    const database = draftDb()
    await database.open()
    await putDraft(database as never, seed)
    const writes = await Promise.allSettled([
      putDraft(database as never, { ...seed, expectedEditVersion: 1, newText: 'edit A', now: 2 }),
      putDraft(database as never, { ...seed, expectedEditVersion: 1, newText: 'edit B', now: 3 }),
    ])
    const fulfilled = writes.filter((item) => item.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    const stored = await database.table('githubDrafts').toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(draftId('7', '42', 'main', 'README.md'))
    expect(stored[0].editVersion).toBe(2)
  })

  it('does not delete a newer edit when acknowledging the committed version', async () => {
    const database = draftDb()
    await database.open()
    await putDraft(database as never, seed)
    await putDraft(database as never, { ...seed, expectedEditVersion: 1, newText: 'later instruction', now: 4 })
    const outcome = await acknowledgeCommittedDraft(database as never, {
      confirm: true,
      accountId: '7',
      repoId: '42',
      ref: 'main',
      path: 'README.md',
      expectedEditVersion: 1,
    })
    expect(outcome).toBe('kept')
    const stored = await database.table('githubDrafts').toArray()
    expect(stored[0].newText).toBe('later instruction')
    expect(stored[0].originalText).toBe('base')
    expect(stored[0].newBinary).toBeNull()
  })

  it('keeps an in-flight newer edit when acknowledgement races the same version', async () => {
    const database = draftDb()
    await database.open()
    await putDraft(database as never, seed)
    const [ack, write] = await Promise.allSettled([
      acknowledgeCommittedDraft(database as never, {
        confirm: true, accountId: '7', repoId: '42', ref: 'main', path: 'README.md', expectedEditVersion: 1,
      }),
      putDraft(database as never, { ...seed, expectedEditVersion: 1, newText: 'inflight', now: 5 }),
    ])
    const stored = await database.table('githubDrafts').toArray()
    if (write.status === 'fulfilled') {
      expect(stored).toHaveLength(1)
      expect(stored[0].newText).toBe('inflight')
    } else {
      expect(ack.status === 'fulfilled' ? ack.value : null).toBe('cleared')
      expect(stored).toHaveLength(0)
    }
  })

  it('reads ref advertisements after the service flush and rejects truncated packets', () => {
    const parsed = parseRefAdvertisement(advertisedRef('main', 'a'.repeat(40)))
    expect(parsed.empty).toBe(false)
    expect(parsed.refs).toEqual([{ sha: 'a'.repeat(40), name: 'refs/heads/main' }])
    expect(() => parseRefAdvertisement(`${pktLine('# service=git-receive-pack\n')}0000ffff`)).toThrow(GithubError)
    expect(() => parseRefAdvertisementBytes(Uint8Array.from([0xff, 0xfe, 0xfd, 0xfc]))).toThrow(GithubError)
  })

  it('does not treat source text that mentions client_secret or force as a transport field', () => {
    expect(() => inspectGithubRequest({
      method: 'POST',
      url: 'https://api.github.com/repos/octocat/notes/git/blobs',
      headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'client_secret appears here and "force":true is text', encoding: 'utf-8' }),
    })).not.toThrow()
    expect(() => inspectGithubRequest({
      method: 'PATCH',
      url: 'https://api.github.com/repos/octocat/notes/git/refs/heads/main',
      headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: 'a'.repeat(40), force: true }),
    })).toThrow(GithubError)
  })

  it('selects rel=next instead of the first link', () => {
    expect(nextLink('<https://api.github.com/repos/octocat/notes/commits?page=1>; rel="prev", <https://api.github.com/repos/octocat/notes/commits?page=3>; rel="next"'))
      .toBe('https://api.github.com/repos/octocat/notes/commits?page=3')
  })

  it('preserves unknown binary bytes and an existing executable mode', async () => {
    const classified = classifyFile({
      type: 'file',
      path: 'sample.dat',
      encoding: 'base64',
      content: btoa(String.fromCharCode(255, 254, 253)),
      size: 3,
      sha: 'b'.repeat(40),
    })
    expect(classified.kind).toBe('binary')
    expect(classified.text).toBeNull()
    expect(classified.text ?? '').not.toContain('\uFFFD')

    const commitId = 'f'.repeat(32)
    const observed: { tree: Array<{ path: string; mode: string }> | null } = { tree: null }
    let head = 'a'.repeat(40)
    const result = await runAtomicCommit({
      generation: () => 0,
      capturedGeneration: 0,
      owner: 'octocat',
      repo: 'notes',
      ref: 'main',
      sentMessage: exactCommitMessage('fixture commit', commitId),
      commitId,
      signal: new AbortController().signal,
      authorName: 'Fixture',
      authorEmail: 'fixture@example.invalid',
      authoredAt: 1_000_000,
      empty: false,
      expectedBaseSha: 'a'.repeat(40),
      snapshots: [{
        path: 'run.sh', editVersion: 1, operation: 'edit', newPath: null, binary: false,
        newText: '#!/bin/sh\nprintf fixture\n', newBinary: null, baseBlobSha: 'c'.repeat(40), baseCommitSha: 'a'.repeat(40),
      }],
      send: async (request) => {
        const url = new URL(request.url)
        let body: Record<string, unknown>
        if (request.method === 'GET' && url.pathname.includes('/branches/')) body = { commit: { sha: head } }
        else if (request.method === 'GET' && url.pathname.includes('/git/commits/')) body = { tree: { sha: 'b'.repeat(40) }, message: request.url.includes('/git/commits/') ? '' : '', parents: [{ sha: 'a'.repeat(40) }] }
        else if (request.method === 'GET' && url.pathname.includes('/git/trees/')) body = { tree: [{ path: 'run.sh', mode: '100755', type: 'blob', sha: 'c'.repeat(40) }], truncated: false }
        else if (request.method === 'POST' && url.pathname.endsWith('/git/blobs')) body = { sha: 'd'.repeat(40) }
        else if (request.method === 'POST' && url.pathname.endsWith('/git/trees')) {
          observed.tree = JSON.parse(request.body ?? '{}').tree
          body = { sha: 'd'.repeat(40) }
        } else if (request.method === 'POST' && url.pathname.endsWith('/git/commits')) body = { sha: 'e'.repeat(40) }
        else if (request.method === 'PATCH') {
          head = 'e'.repeat(40)
          body = { object: { sha: head } }
        }
        else throw new Error(`unexpected ${request.method} ${url.pathname}`)
        return { status: 200, headers: {}, bodyText: JSON.stringify(body) }
      },
    })
    expect(result.status).toBe('sent')
    expect(observed.tree?.find((item) => item.path === 'run.sh')?.mode).toBe('100755')
  })

  it('accepts an empty text file and does not treat null content as empty', async () => {
    const commitId = 'e'.repeat(32)
    let calls = 0
    const sent = await runAtomicCommit({
      generation: () => 0,
      capturedGeneration: 0,
      owner: 'octocat',
      repo: 'notes',
      ref: 'main',
      sentMessage: exactCommitMessage('fixture commit', commitId),
      commitId,
      signal: new AbortController().signal,
      authorName: 'Fixture',
      authorEmail: 'fixture@example.invalid',
      authoredAt: 1_000_000,
      empty: true,
      expectedBaseSha: '',
      snapshots: [{
        path: '.gitkeep', editVersion: 1, operation: 'add', newPath: null, binary: false,
        newText: '', newBinary: null, baseBlobSha: null, baseCommitSha: '',
      }],
      send: async () => {
        calls += 1
        return { status: 200, headers: {}, bodyText: JSON.stringify({ commit: { sha: 'e'.repeat(40) } }) }
      },
    })
    expect(sent.status).toBe('sent')
    expect(calls).toBeGreaterThan(0)
    const absent = await runAtomicCommit({
      generation: () => 0,
      capturedGeneration: 0,
      owner: 'octocat',
      repo: 'notes',
      ref: 'main',
      sentMessage: exactCommitMessage('fixture commit', commitId),
      commitId,
      signal: new AbortController().signal,
      authorName: 'Fixture',
      authorEmail: 'fixture@example.invalid',
      authoredAt: 1_000_000,
      empty: true,
      expectedBaseSha: '',
      snapshots: [{
        path: '.gitkeep', editVersion: 1, operation: 'add', newPath: null, binary: false,
        newText: null, newBinary: null, baseBlobSha: null, baseCommitSha: '',
      }],
      send: async () => {
        throw new Error('null content must not be sent')
      },
    })
    expect(absent.status).toBe('blocked')
  })

  it('shadows every draft path and does not match a deletion', async () => {
    const overlay = await searchTreeAndDrafts({
      query: 'removed-secret',
      entries: [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'b'.repeat(40), byteLength: 14 }],
      truncated: false,
      drafts: [{
        id: 'draft', accountId: '7', repoId: '42', ref: 'main', path: 'README.md', operation: 'edit',
        binary: false, newText: 'clean draft', newBinary: null, baseCommitSha: 'a'.repeat(40), baseBlobSha: null,
        originalText: 'removed-secret', originalBinary: null, newPath: null, conflict: null, editVersion: 2, updatedAt: 1,
      }],
      fetchText: async () => ({ text: 'removed-secret', unsupported: false }),
      signal: new AbortController().signal,
    })
    expect(overlay.items).toEqual([])
    const deleted = await searchTreeAndDrafts({
      query: 'removed-secret',
      entries: [],
      truncated: false,
      drafts: [{
        id: 'draft', accountId: '7', repoId: '42', ref: 'main', path: 'README.md', operation: 'delete',
        binary: false, newText: 'removed-secret', newBinary: null, baseCommitSha: 'a'.repeat(40), baseBlobSha: null,
        originalText: null, originalBinary: null, newPath: null, conflict: null, editVersion: 2, updatedAt: 1,
      }],
      fetchText: async () => ({ text: null, unsupported: true }),
      signal: new AbortController().signal,
    })
    expect(deleted.items).toEqual([])
  })

  it('does not mark a wrong public create response as created', async () => {
    const wrong = { id: 99, name: 'wrong', private: false, default_branch: 'main', owner: { id: 7, login: 'octocat', type: 'User' } }
    const response = (status: number, body: unknown) => ({ status, headers: { 'x-oauth-scopes': 'repo' }, bodyText: JSON.stringify(body) })
    const created = await createPersonalRepo({
      signal: new AbortController().signal,
      now: () => 1,
      generation: () => 0,
      capturedGeneration: 0,
      account: () => ({ id: '7', login: 'octocat' }),
      rememberRepo: () => undefined,
      proposal: () => null,
      hasAccess: async () => true,
      request: async (req) => {
        const url = new URL(req.url)
        if (req.method === 'POST' && url.pathname === '/user/repos') return response(201, wrong)
        if (url.pathname === '/user/repos') return response(200, [])
        if (url.pathname === '/user') return response(200, { id: 7, login: 'octocat', type: 'User' })
        if (url.pathname === '/repositories/99') return response(200, wrong)
        throw new Error(`unexpected ${url.pathname}`)
      },
    }, {
      form: { name: 'wanted', visibility: 'private', readme: false },
      confirmation: { confirm: true, accountId: '7', ownerLogin: 'octocat', repoName: 'wanted', aiDerived: false },
    })
    expect(created.status).not.toBe('created')
  })
})
