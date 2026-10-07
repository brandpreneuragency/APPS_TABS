import type { TabsDB } from '../db'
import { GithubError } from './errors'
import { accountWorkspaceId, branchWorkspaceId, clampPanel, draftId, normalizeRepoPath } from './identity'
import type { GithubAccountRecord, GithubDraftRecord, GithubPrivateCacheRecord, GithubWorkspaceRecord } from './schema'
import {
  DEFAULT_GITHUB_PANEL,
  GITHUB_CLIENT_ID_SETTING,
  type DraftDeletionRequest,
  type GithubAccountWorkspace,
  type GithubBranchWorkspace,
  type GithubDraft,
  type SaveDraftInput,
} from './types'

export async function readClientId(database: TabsDB): Promise<string | null> {
  const row = await database.settings.get(GITHUB_CLIENT_ID_SETTING)
  return typeof row?.value === 'string' && row.value ? row.value : null
}

export async function writeClientId(database: TabsDB, clientId: string): Promise<void> {
  await database.settings.put({ key: GITHUB_CLIENT_ID_SETTING, value: clientId })
}

export async function clearClientId(database: TabsDB): Promise<void> {
  await database.settings.delete(GITHUB_CLIENT_ID_SETTING)
}

export async function putAccount(database: TabsDB, account: GithubAccountRecord): Promise<void> {
  const stored: GithubAccountRecord = {
    id: account.id,
    login: account.login,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    grantedScopes: account.grantedScopes,
    expiresAt: account.expiresAt,
    connectedAt: account.connectedAt,
  }
  await database.githubAccounts.put(stored)
}

export async function getAccount(database: TabsDB, id: string): Promise<GithubAccountRecord | undefined> {
  return database.githubAccounts.get(id)
}

const draftQueues = new Map<string, Promise<unknown>>()

function enqueueDraft<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = draftQueues.get(id) ?? Promise.resolve()
  const run = previous.then(work, work)
  draftQueues.set(id, run.then(() => undefined, () => undefined))
  return run
}

function keptValue<T>(retarget: boolean | undefined, existing: GithubDraftRecord | undefined, stored: T | undefined, incoming: T): T {
  if (retarget || !existing) return incoming
  return stored as T
}

export async function putDraft(database: TabsDB, input: SaveDraftInput & { accountId: string; now: number }): Promise<GithubDraft> {
  const path = normalizeRepoPath(input.path)
  const id = draftId(input.accountId, input.repoId, input.ref, path)
  return enqueueDraft(id, () => database.transaction('rw', database.githubDrafts, async () => {
    const existing = await database.githubDrafts.get(id)
    if (input.expectedEditVersion !== undefined && (!existing || existing.editVersion !== input.expectedEditVersion)) {
      throw new GithubError('conflict', 'Draft changed before this edit could be applied')
    }
    const draft: GithubDraftRecord = {
      id,
      accountId: input.accountId,
      repoId: input.repoId,
      ref: input.ref,
      path,
      baseCommitSha: keptValue(input.retargetBase, existing, existing?.baseCommitSha, input.baseCommitSha),
      baseBlobSha: keptValue(input.retargetBase, existing, existing?.baseBlobSha, input.baseBlobSha),
      originalText: keptValue(input.retargetBase, existing, existing?.originalText, input.originalText),
      originalBinary: keptValue(input.retargetBase, existing, existing?.originalBinary, input.originalBinary),
      newText: input.binary ? null : input.newText === undefined ? null : input.newText,
      newBinary: input.binary ? input.newBinary === undefined ? null : input.newBinary : null,
      binary: input.binary,
      operation: input.operation ?? existing?.operation ?? 'edit',
      newPath: input.newPath === undefined ? existing?.newPath ?? null : input.newPath,
      conflict: input.conflict === undefined ? existing?.conflict ?? null : input.conflict,
      editVersion: (existing?.editVersion ?? 0) + 1,
      updatedAt: input.now,
    }
    await database.githubDrafts.put(draft)
    return draft
  }))
}

export async function acknowledgeCommittedDraft(
  database: TabsDB,
  request: DraftDeletionRequest & { path: string; expectedEditVersion: number },
): Promise<'cleared' | 'kept'> {
  if (request.confirm !== true) throw new GithubError('draft_delete_unconfirmed', 'Draft deletion requires an explicit confirmation')
  if (!request.accountId || !request.repoId || !request.ref) {
    throw new GithubError('validation', 'A committed draft can only be cleared for its exact account, repository, and ref')
  }
  const path = normalizeRepoPath(request.path)
  const id = draftId(request.accountId, request.repoId, request.ref, path)
  return enqueueDraft(id, () => database.transaction('rw', database.githubDrafts, async () => {
    const current = await database.githubDrafts.get(id)
    if (!current || current.editVersion !== request.expectedEditVersion) return 'kept' as const
    if (current.accountId !== request.accountId || current.repoId !== request.repoId || current.ref !== request.ref || current.path !== path) {
      return 'kept' as const
    }
    await database.githubDrafts.delete(id)
    return 'cleared' as const
  }))
}

export async function listDraftRecords(database: TabsDB, filter: { accountId?: string; repoId?: string; ref?: string } = {}): Promise<GithubDraft[]> {
  const rows = filter.accountId
    ? await database.githubDrafts.where('accountId').equals(filter.accountId).toArray()
    : await database.githubDrafts.toArray()
  return rows.filter((row) => (
    (filter.repoId === undefined || row.repoId === filter.repoId)
    && (filter.ref === undefined || row.ref === filter.ref)
  ))
}

export async function deleteDraftRecords(database: TabsDB, request: DraftDeletionRequest): Promise<number> {
  if (request.confirm !== true) throw new GithubError('draft_delete_unconfirmed', 'Draft deletion requires an explicit confirmation')
  const rows = await listDraftRecords(database, request)
  const matched = request.path
    ? rows.filter((row) => row.path === normalizeRepoPath(request.path ?? ''))
    : rows
  await database.githubDrafts.bulkDelete(matched.map((row) => row.id))
  return matched.length
}

export async function readAccountWorkspace(database: TabsDB, accountId: string): Promise<GithubAccountWorkspace | null> {
  const row = await database.githubWorkspaces.get(accountWorkspaceId(accountId))
  if (!row) return null
  return {
    id: row.id,
    accountId: row.accountId,
    openRepoIds: row.openRepoIds,
    activeRepoId: row.activeRepoId,
    activeRefByRepo: row.activeRefByRepo,
    updatedAt: row.updatedAt,
  }
}

export async function writeAccountWorkspace(database: TabsDB, workspace: GithubAccountWorkspace): Promise<void> {
  const row: GithubWorkspaceRecord = {
    id: workspace.id,
    accountId: workspace.accountId,
    repoId: '',
    ref: '',
    openRepoIds: workspace.openRepoIds,
    activeRepoId: workspace.activeRepoId,
    activeRefByRepo: workspace.activeRefByRepo,
    openPaths: [],
    selectedPath: null,
    panel: DEFAULT_GITHUB_PANEL,
    updatedAt: workspace.updatedAt,
  }
  await database.githubWorkspaces.put(row)
}

export async function readBranchWorkspace(database: TabsDB, accountId: string, repoId: string, ref: string): Promise<GithubBranchWorkspace | null> {
  const row = await database.githubWorkspaces.get(branchWorkspaceId(accountId, repoId, ref))
  if (!row) return null
  return {
    id: row.id,
    accountId,
    repoId,
    ref,
    openPaths: row.openPaths,
    selectedPath: row.selectedPath,
    panel: clampPanel(row.panel),
    updatedAt: row.updatedAt,
  }
}

export async function writeBranchWorkspace(database: TabsDB, workspace: GithubBranchWorkspace): Promise<void> {
  const row: GithubWorkspaceRecord = {
    id: workspace.id,
    accountId: workspace.accountId,
    repoId: workspace.repoId,
    ref: workspace.ref,
    openRepoIds: [],
    activeRepoId: null,
    activeRefByRepo: {},
    openPaths: workspace.openPaths,
    selectedPath: workspace.selectedPath,
    panel: clampPanel(workspace.panel),
    updatedAt: workspace.updatedAt,
  }
  await database.githubWorkspaces.put(row)
}

export async function putPrivateCache(database: TabsDB, record: GithubPrivateCacheRecord): Promise<void> {
  await database.githubPrivateCache.put(record)
}

export async function getPrivateCache(database: TabsDB, id: string): Promise<GithubPrivateCacheRecord | undefined> {
  return database.githubPrivateCache.get(id)
}
