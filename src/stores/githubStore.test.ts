import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { TabsDB } from '../services/db'
import { createGithubService } from '../services/github/service'
import { GithubError } from '../services/github/errors'
import { createFixtureTransport, jsonResponse } from '../services/github/testing/fixtureTransport'
import { createMemorySecureStore } from '../services/github/testing/memorySecureStore'
import type { GithubClock, GithubTransportRequest } from '../services/github/types'
import { createGithubStore } from './githubStore'

const databases: TabsDB[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

function respond(request: GithubTransportRequest) {
  const url = request.url
  if (url.includes('/login/device/code')) {
    return jsonResponse(200, {
      device_code: 'device-secret-value', user_code: 'WDJB-MJHT',
      verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
    })
  }
  if (url.includes('/login/oauth/access_token')) {
    return jsonResponse(200, { access_token: 'gho_storetokenvalue', token_type: 'bearer', scope: 'repo' })
  }
  if (url.endsWith('/user')) return jsonResponse(200, { id: 7, login: 'octocat', type: 'User' })
  if (url.includes('/user/repos')) {
    return jsonResponse(200, [
      { id: 42, name: 'notes', private: false, default_branch: 'main', owner: { id: 7, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/notes' },
      { id: 43, name: 'other', private: false, default_branch: 'main', owner: { id: 7, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/other' },
    ])
  }
  if (url.includes('/repositories/42')) return jsonResponse(200, { id: 42, name: 'notes', private: false, default_branch: 'main', owner: { id: 7, login: 'octocat', type: 'User' }, html_url: 'https://github.com/octocat/notes' })
  if (url.includes('/branches/main')) return jsonResponse(200, { name: 'main', commit: { sha: 'abc123' }, protected: false })
  if (url.includes('/contents/README.md')) {
    return jsonResponse(200, { type: 'file', encoding: 'base64', content: btoa('# remote'), size: 8, sha: 'blob1', path: 'README.md', name: 'README.md' })
  }
  return jsonResponse(404, {})
}

function fastClock(): GithubClock {
  let now = 1_000_000
  return {
    now: () => now,
    async sleep(ms: number, signal: AbortSignal) {
      if (signal.aborted) throw new GithubError('cancelled', 'Cancelled')
      now += ms
    },
  }
}

describe('GitHub store contract', () => {
  it('restores the same draft and selection after the store and database are recreated', async () => {
    const name = `GithubStore-${crypto.randomUUID()}`
    const database = new TabsDB(name)
    databases.push(database)
    await database.open()
    const secure = createMemorySecureStore()
    const time = fastClock()
    const first = createGithubStore(createGithubService({
      database, secureStore: secure, transport: createFixtureTransport(respond), clock: time,
    }))
    await first.getState().configureClientId('Iv1.abc12345')
    await first.getState().beginDeviceBrowserSignIn()
    await first.getState().finishDeviceBrowserSignIn()
    await first.getState().refreshRepos()
    await first.getState().selectRepo('42', 'main')
    await first.getState().openPath('README.md')
    await first.getState().saveOpenedDraft({ text: 'same draft' })
    expect(first.getState().drafts[0]?.newText).toBe('same draft')
    database.close()

    const reopened = new TabsDB(name)
    databases.push(reopened)
    await reopened.open()
    const second = createGithubStore(createGithubService({
      database: reopened, secureStore: secure, transport: createFixtureTransport(respond), clock: time,
    }))
    await second.getState().restore()
    expect(second.getState().connection).toMatchObject({ status: 'connected', account: { id: '7' } })
    expect(second.getState().drafts.map((draft) => draft.newText)).toEqual(['same draft'])
    expect(second.getState().accountWorkspace?.activeRepoId).toBe('42')
    expect(second.getState().branchWorkspace?.selectedPath).toBe('README.md')
    await second.getState().selectRepo('43', 'main')
    await second.getState().selectRepo('42', 'main')
    expect(second.getState().branchWorkspace?.selectedPath).toBe('README.md')
    expect(await reopened.documents.count()).toBe(0)
    expect(await reopened.workspaces.count()).toBe(0)
  })
})
