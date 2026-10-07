import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { TabsDB } from '../db'
import { GITHUB_V1_STORES } from './schema'

const databases: Dexie[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
    await database.delete()
  }
})

describe('GitHub Dexie upgrade', () => {
  it('preserves an existing v19 database and adds empty GitHub tables', async () => {
    const name = `GithubSchema-${crypto.randomUUID()}`
    const existing = new Dexie(name)
    databases.push(existing)
    existing.version(19).stores({
      documents: 'id, title, updatedAt, order',
      workspaces: 'id, name, updatedAt, order',
      settings: 'key',
      clients: 'id, name, order',
    })
    await existing.open()
    const document = { id: 'doc-1', title: 'Docs stay', content: '{"type":"doc"}', createdAt: 1, updatedAt: 2, order: 0 }
    const workspace = { id: 'ws-1', name: 'Local', connectedFolders: [], activeFolderId: null, currentFile: null, createdAt: 1, updatedAt: 2, order: 0 }
    await existing.table('documents').put(document)
    await existing.table('workspaces').put(workspace)
    await existing.table('settings').put({ key: 'sentinel-setting', value: 'keep-me' })
    existing.close()

    const migrated = new TabsDB(name)
    databases.push(migrated)
    await migrated.open()
    expect(migrated.verno).toBe(20)
    expect(await migrated.documents.get('doc-1')).toMatchObject({ title: 'Docs stay' })
    expect(await migrated.workspaces.get('ws-1')).toMatchObject({ name: 'Local' })
    expect(await migrated.settings.get('sentinel-setting')).toEqual({ key: 'sentinel-setting', value: 'keep-me' })
    expect(await Promise.all(Object.keys(GITHUB_V1_STORES).map((store) => migrated.table(store).count()))).toEqual([0, 0, 0, 0])
    migrated.close()

    const reopened = new TabsDB(name)
    databases.push(reopened)
    await reopened.open()
    expect(await reopened.documents.get('doc-1')).toMatchObject(document)
    expect(await reopened.workspaces.get('ws-1')).toMatchObject(workspace)
  })

  it('does not import a fixture transport from the production entry', () => {
    const index = readFileSync('src/services/github/index.ts', 'utf8')
    const service = readFileSync('src/services/github/service.ts', 'utf8')
    const native = readFileSync('src/services/github/transport.ts', 'utf8')
    for (const source of [index, service, native]) {
      expect(source).not.toContain('fixtureTransport')
      expect(source).not.toContain('localStorage')
      expect(source).not.toContain('createMemorySecureStore')
    }
  })
})
