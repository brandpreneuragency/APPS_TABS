import type { TabsDB } from '../db'
import { parseJson, parseJsonArray } from './api'
import { classifyBytes, decodeBase64 } from './binary'
import { runAtomicCommit, type CommitSnapshot } from './commit'
import { mergeTexts } from './conflict'
import { GithubError, isGithubError } from './errors'
import {
  GITHUB_DOWNLOAD_BYTE_CAP,
  createRefBody,
  createRefUrl,
  exactCommitMessage,
  gitBlobUrl,
  gitCommitUrl,
  gitTreeUrl,
  githubRead,
  githubWrite,
  historyDetailUrl,
  historyUrl,
  isEmptyRepositoryMessage,
} from './gitProtocol'
import { normalizeRepoPath } from './identity'
import { listDraftRecords, putDraft, acknowledgeCommittedDraft } from './persistence'
import { nextLink } from './policy'
import { mapGitTree, searchTreeAndDrafts } from './search'
import {
  GITHUB_AI_RECALL_WARNING,
  GITHUB_EMPTY_DIRECTORY_NOTE,
  type AiDraftProposal,
  type CommitConfirmation,
  type CommitResult,
  type DirectoryStageResult,
  type GithubAccount,
  type GithubAiPreparation,
  type GithubAiPurpose,
  type GithubBranch,
  type GithubClock,
  type GithubCommitDetail,
  type GithubCommitSummary,
  type GithubConflictChoice,
  type GithubDraft,
  type GithubDraftConflict,
  type GithubPage,
  type GithubRepo,
  type GithubSearchResult,
  type GithubTransportRequest,
  type GithubTransportResponse,
  type GithubTreeMark,
  type RemoteRefresh,
} from './types'

export interface Phase2Host {
  database: TabsDB
  clock: GithubClock
  requireAccount: () => GithubAccount
  resolveRepo: (repoId: string, signal: AbortSignal) => Promise<GithubRepo>
  send: (request: GithubTransportRequest, signal: AbortSignal) => Promise<GithubTransportResponse>
  listBranches: (repoId: string, signal: AbortSignal) => Promise<GithubPage<GithubBranch>>
  generation: () => number
  repoPrivate: (repoId: string) => boolean
}

export function treeMarks(drafts: GithubDraft[]): GithubTreeMark[] {
  const marks: GithubTreeMark[] = []
  for (const draft of drafts) {
    if (draft.operation === 'add') marks.push({ path: draft.path, indicator: 'added' })
    else if (draft.operation === 'delete') marks.push({ path: draft.path, indicator: 'deleted' })
    else if (draft.operation === 'rename' || draft.operation === 'move') {
      marks.push({ path: draft.path, indicator: 'renamed' })
      if (draft.newPath) marks.push({ path: draft.newPath, indicator: 'added' })
    } else marks.push({ path: draft.path, indicator: 'modified' })
  }
  return marks
}

async function draftsFor(host: Phase2Host, repoId: string, ref: string): Promise<GithubDraft[]> {
  const account = host.requireAccount()
  return listDraftRecords(host.database, { accountId: account.id, repoId, ref })
}

export async function stageDirectory(
  host: Phase2Host,
  input: { repoId: string; ref: string; path: string; explicitGitkeep?: boolean; baseCommitSha: string },
): Promise<DirectoryStageResult> {
  if (input.explicitGitkeep !== true) {
    return { persisted: false, note: GITHUB_EMPTY_DIRECTORY_NOTE, draft: null }
  }
  const path = normalizeRepoPath(`${normalizeRepoPath(input.path)}/.gitkeep`)
  const draft = await putDraft(host.database, {
    accountId: host.requireAccount().id,
    repoId: input.repoId,
    ref: input.ref,
    path,
    baseCommitSha: input.baseCommitSha,
    baseBlobSha: null,
    originalText: null,
    originalBinary: null,
    newText: '',
    binary: false,
    operation: 'add',
    now: host.clock.now(),
  })
  return { persisted: true, note: 'A .gitkeep file was staged because that was explicitly requested. Git still does not store an empty directory.', draft }
}

export async function stageUpload(
  host: Phase2Host,
  input: { repoId: string; ref: string; path: string; bytesBase64: string; baseCommitSha: string },
): Promise<GithubDraft> {
  const bytes = decodeBase64(input.bytesBase64)
  if (bytes.byteLength > 1_000_000) throw new GithubError('too_large', 'Upload exceeds the 1 MB draft limit')
  const kind = classifyBytes(bytes, input.path)
  const text = kind === 'text'
  return putDraft(host.database, {
    accountId: host.requireAccount().id,
    repoId: input.repoId,
    ref: input.ref,
    path: normalizeRepoPath(input.path),
    baseCommitSha: input.baseCommitSha,
    baseBlobSha: null,
    originalText: null,
    originalBinary: null,
    newText: text ? new TextDecoder().decode(bytes) : null,
    newBinary: text ? null : input.bytesBase64.replace(/\s/g, ''),
    binary: !text,
    operation: 'add',
    now: host.clock.now(),
  })
}

function conflictOf(remoteCommitSha: string, remoteBlobSha: string | null, remoteText: string | null, remoteBinary: string | null, remoteDeleted: boolean, kind: GithubDraftConflict['kind']): GithubDraftConflict {
  return {
    kind,
    remoteCommitSha,
    remoteBlobSha,
    remoteText,
    remoteBinary,
    remoteDeleted,
    choice: 'unresolved',
    resultText: null,
    resultBinary: null,
    resolved: false,
  }
}

export async function refreshRemote(host: Phase2Host, repoId: string, ref: string, signal: AbortSignal): Promise<RemoteRefresh> {
  const repo = await host.resolveRepo(repoId, signal)
  const before = await draftsFor(host, repoId, ref)
  let empty = false
  let remoteCommitSha: string | null = null
  let remoteMessage: string | null = null
  let protectedBranch = false
  try {
    const response = await host.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/branches/${encodeURIComponent(ref)}`), signal)
    const body = parseJson(response.bodyText)
    protectedBranch = body.protected === true
    const commit = body.commit && typeof body.commit === 'object' ? body.commit as Record<string, unknown> : null
    remoteCommitSha = typeof commit?.sha === 'string' ? commit.sha : null
    const nested = commit?.commit && typeof commit.commit === 'object' ? commit.commit as Record<string, unknown> : null
    remoteMessage = typeof nested?.message === 'string' ? nested.message : null
  } catch (error) {
    if (isGithubError(error) && error.code === 'conflict' && isEmptyRepositoryMessage(error.message)) empty = true
    else throw error
  }
  const conflicts: GithubDraft[] = []
  for (const draft of before) {
    if (!remoteCommitSha || draft.baseCommitSha === remoteCommitSha) continue
    const remote = await readRemoteFile(host, repo, ref, draft.path, signal)
    const renamedOnto = draft.newPath ? await readRemoteFile(host, repo, ref, draft.newPath, signal) : null
    const kind = draft.binary || remote.binary
      ? 'binary'
      : remote.missing
        ? 'delete_edit'
        : renamedOnto && !renamedOnto.missing
          ? 'rename_collision'
          : 'content'
    const next = await putDraft(host.database, {
      ...draft,
      accountId: draft.accountId,
      now: host.clock.now(),
      conflict: conflictOf(remoteCommitSha, remote.blobSha, remote.text, remote.binaryBase64, remote.missing, kind),
    })
    conflicts.push(next)
  }
  const after = await draftsFor(host, repoId, ref)
  if (after.some((draft, index) => draft.baseCommitSha !== before[index]?.baseCommitSha)) {
    throw new GithubError('validation', 'Refresh changed a draft base')
  }
  return {
    repoId,
    ref,
    remoteCommitSha,
    remoteMessage,
    protected: protectedBranch,
    empty,
    draftsStale: before.some((draft) => remoteCommitSha !== null && draft.baseCommitSha !== remoteCommitSha),
    baseChanged: false,
    conflicts,
  }
}

async function readRemoteFile(host: Phase2Host, repo: GithubRepo, ref: string, path: string, signal: AbortSignal): Promise<{ missing: boolean; text: string | null; binaryBase64: string | null; blobSha: string | null; binary: boolean }> {
  try {
    const response = await host.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`), signal)
    const body = parseJson(response.bodyText)
    if (body.type === 'symlink' || body.type === 'submodule' || body.type === 'commit') {
      return { missing: false, text: null, binaryBase64: null, blobSha: null, binary: true }
    }
    const sha = typeof body.sha === 'string' ? body.sha : null
    if (typeof body.content !== 'string') return { missing: false, text: null, binaryBase64: null, blobSha: sha, binary: true }
    const bytes = decodeBase64(body.content)
    const kind = classifyBytes(bytes, path)
    if (kind === 'text') return { missing: false, text: new TextDecoder().decode(bytes), binaryBase64: null, blobSha: sha, binary: false }
    return { missing: false, text: null, binaryBase64: body.content.replace(/\s/g, ''), blobSha: sha, binary: true }
  } catch (error) {
    if (isGithubError(error) && error.code === 'not_found') return { missing: true, text: null, binaryBase64: null, blobSha: null, binary: false }
    throw error
  }
}

export async function resolveConflict(
  host: Phase2Host,
  input: {
    confirm: true
    repoId: string
    ref: string
    path: string
    choice: GithubConflictChoice
    resultText?: string | null
    resultBinary?: string | null
    resultPath?: string | null
  },
): Promise<GithubDraft> {
  if (input.confirm !== true) throw new GithubError('confirmation_required', 'Conflict resolution requires confirmation')
  const draft = (await draftsFor(host, input.repoId, input.ref)).find((item) => item.path === normalizeRepoPath(input.path))
  if (!draft?.conflict) throw new GithubError('validation', 'That draft has no conflict')
  const conflict = draft.conflict
  if (conflict.kind === 'binary' && input.choice === 'both') {
    throw new GithubError('validation', 'Binary conflicts require a version choice, not a text merge')
  }
  if ((conflict.kind === 'delete_edit' || conflict.kind === 'edit_delete' || conflict.kind === 'rename_collision') && input.choice === 'both') {
    throw new GithubError('validation', 'This conflict cannot be merged as text')
  }
  let newText = draft.newText
  let newBinary = draft.newBinary
  let operation = draft.operation
  let newPath = draft.newPath ?? null
  let resolved = true
  if (input.choice === 'mine') {
    newText = draft.newText
    newBinary = draft.newBinary
  } else if (input.choice === 'theirs') {
    if (conflict.remoteDeleted) {
      operation = 'delete'
      newText = null
      newBinary = null
    } else {
      newText = conflict.remoteText
      newBinary = conflict.remoteBinary
      operation = 'edit'
      newPath = null
    }
  } else if (input.choice === 'both') {
    const merged = mergeTexts(draft.originalText ?? '', draft.newText ?? '', conflict.remoteText ?? '')
    newText = merged.text
    resolved = merged.clean
  } else if (input.choice === 'custom') {
    if (input.resultPath) newPath = normalizeRepoPath(input.resultPath)
    newText = input.resultText === undefined ? draft.newText : input.resultText
    newBinary = input.resultBinary === undefined ? draft.newBinary : input.resultBinary
  } else {
    resolved = false
  }
  return putDraft(host.database, {
    ...draft,
    accountId: draft.accountId,
    now: host.clock.now(),
    operation,
    newPath,
    newText,
    newBinary,
    binary: draft.binary,
    retargetBase: resolved,
    baseCommitSha: resolved ? conflict.remoteCommitSha : draft.baseCommitSha,
    baseBlobSha: resolved ? conflict.remoteBlobSha : draft.baseBlobSha,
    originalText: resolved && !draft.binary ? conflict.remoteText ?? draft.originalText : draft.originalText,
    conflict: { ...conflict, choice: input.choice, resultText: newText, resultBinary: newBinary, resolved },
  })
}

export async function repositoryIsEmpty(host: Phase2Host, repoId: string, ref: string, signal: AbortSignal): Promise<boolean> {
  const page = await host.listBranches(repoId, signal)
  if (page.complete && page.items.length === 0) return true
  try {
    await host.send(githubRead(`https://api.github.com/repos/${encodeURIComponent((await host.resolveRepo(repoId, signal)).ownerLogin)}/${encodeURIComponent((await host.resolveRepo(repoId, signal)).name)}/branches/${encodeURIComponent(ref)}`), signal)
    return false
  } catch (error) {
    if (isGithubError(error) && error.code === 'conflict' && isEmptyRepositoryMessage(error.message)) return true
    throw error
  }
}

export async function commitSelected(host: Phase2Host, confirmation: CommitConfirmation, signal: AbortSignal): Promise<CommitResult> {
  if (confirmation?.confirm !== true) return { status: 'blocked', code: 'confirmation_required', message: 'Commit requires an explicit confirmation of the target snapshot' }
  const account = host.requireAccount()
  if (confirmation.accountId !== account.id) return { status: 'blocked', code: 'confirmation_required', message: 'Confirmation account does not match the signed-in account' }
  let sentMessage = ''
  try {
    sentMessage = exactCommitMessage(confirmation.sentMessage, confirmation.commitId)
  } catch (error) {
    return { status: 'blocked', code: 'validation', message: error instanceof Error ? error.message : 'Commit message was rejected' }
  }
  if (sentMessage !== confirmation.sentMessage) {
    return { status: 'blocked', code: 'confirmation_required', message: 'Confirm the exact commit message, including its commit id' }
  }
  const drafts = await draftsFor(host, confirmation.repoId, confirmation.ref)
  const selected = confirmation.draftVersions.map((version) => {
    const draft = drafts.find((item) => item.path === version.path)
    return { version, draft }
  })
  if (selected.some((item) => !item.draft || item.draft.editVersion !== item.version.editVersion)) {
    return { status: 'blocked', code: 'conflict', message: 'A selected draft changed. Confirm the current snapshot.' }
  }
  const snapshots: CommitSnapshot[] = selected.map((item) => item.draft as GithubDraft).map((draft) => ({
    path: draft.path,
    editVersion: draft.editVersion,
    operation: draft.operation,
    newPath: draft.newPath ?? null,
    binary: draft.binary,
    newText: draft.newText,
    newBinary: draft.newBinary,
    baseBlobSha: draft.baseBlobSha,
    baseCommitSha: draft.baseCommitSha,
  }))
  if (snapshots.some((item) => item.baseCommitSha !== confirmation.expectedBaseSha)) {
    return { status: 'blocked', code: 'mixed_base', message: 'Selected drafts do not share the confirmed base' }
  }
  if (selected.some((item) => item.draft?.conflict && !item.draft.conflict.resolved)) {
    return { status: 'blocked', code: 'unresolved_conflict', message: 'Resolve every selected conflict before sending' }
  }
  const repo = await host.resolveRepo(confirmation.repoId, signal)
  const empty = await repositoryIsEmpty(host, confirmation.repoId, confirmation.ref, signal)
  const captured = host.generation()
  const result = await runAtomicCommit({
    send: host.send,
    generation: host.generation,
    capturedGeneration: captured,
    owner: repo.ownerLogin,
    repo: repo.name,
    ref: confirmation.ref,
    expectedBaseSha: confirmation.expectedBaseSha,
    sentMessage,
    commitId: confirmation.commitId,
    snapshots,
    empty,
    signal,
    authorName: account.login,
    authorEmail: `${account.id}+${account.login}@users.noreply.github.com`,
    authoredAt: host.clock.now(),
  })
  if (result.status !== 'sent') return result
  const cleared: string[] = []
  const kept: string[] = []
  for (const snap of snapshots) {
    const outcome = await acknowledgeCommittedDraft(host.database, {
      confirm: true,
      accountId: account.id,
      repoId: confirmation.repoId,
      ref: confirmation.ref,
      path: snap.path,
      expectedEditVersion: snap.editVersion,
    })
    if (outcome === 'cleared') cleared.push(snap.path)
    else kept.push(snap.path)
  }
  const unselected = drafts.filter((draft) => !snapshots.some((snap) => snap.path === draft.path)).map((draft) => draft.path)
  return { ...result, clearedPaths: cleared, keptPaths: [...kept, ...unselected] }
}

export async function createBranch(host: Phase2Host, repoId: string, name: string, fromRef: string, signal: AbortSignal): Promise<GithubBranch> {
  const empty = await repositoryIsEmpty(host, repoId, fromRef, signal)
  if (empty) {
    throw new GithubError('empty_repo_ref_rejected', 'GitHub cannot create a reference in an empty repository, even if a commit SHA exists. Empty means the repository has no branches.')
  }
  const repo = await host.resolveRepo(repoId, signal)
  const captured = host.generation()
  const head = await host.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/branches/${encodeURIComponent(fromRef)}`), signal)
  if (host.generation() !== captured) throw new GithubError('stale_target', 'The repository or branch changed before the branch could be created')
  const sha = (parseJson(head.bodyText).commit as Record<string, unknown> | undefined)?.sha
  if (typeof sha !== 'string') throw new GithubError('validation', 'The source branch has no commit')
  await host.send(githubWrite('POST', createRefUrl(repo.ownerLogin, repo.name), createRefBody(name, sha)), signal)
  const created = await host.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/branches/${encodeURIComponent(name)}`), signal)
  const body = parseJson(created.bodyText)
  const createdSha = (body.commit as Record<string, unknown> | undefined)?.sha
  if (createdSha !== sha) throw new GithubError('ambiguous_write', 'The new branch could not be read back')
  return { name, commitSha: sha, protected: body.protected === true }
}

export async function commitHistory(host: Phase2Host, repoId: string, ref: string, signal: AbortSignal): Promise<GithubPage<GithubCommitSummary>> {
  const repo = await host.resolveRepo(repoId, signal)
  const items: GithubCommitSummary[] = []
  let url: string | null = historyUrl(repo.ownerLogin, repo.name, ref, 1)
  let pages = 0
  while (url) {
    pages += 1
    if (pages > 20) {
      return { items, complete: false, message: 'Commit history stopped before the final page', error: { code: 'rate_limited', message: 'GitHub list stopped before the final page' } }
    }
    const response = await host.send(githubRead(url), signal)
    for (const row of parseJsonArray(response.bodyText)) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const commit = item.commit && typeof item.commit === 'object' ? item.commit as Record<string, unknown> : null
      if (typeof item.sha !== 'string' || !commit || typeof commit.message !== 'string') continue
      const author = commit.author && typeof commit.author === 'object' ? commit.author as Record<string, unknown> : null
      items.push({ sha: item.sha, message: commit.message, date: typeof author?.date === 'string' ? author.date : null })
    }
    const link = response.headers.link ?? response.headers.Link
    url = nextLink(link)
    if (url && !url.startsWith('https://api.github.com/')) {
      return { items, complete: false, message: 'GitHub next page was rejected', error: { code: 'host_rejected', message: 'GitHub next page was rejected' } }
    }
  }
  return { items, complete: true, message: null, error: null }
}

export async function commitDetail(host: Phase2Host, repoId: string, sha: string, signal: AbortSignal): Promise<GithubCommitDetail> {
  const repo = await host.resolveRepo(repoId, signal)
  const response = await host.send(githubRead(historyDetailUrl(repo.ownerLogin, repo.name, sha)), signal)
  const body = parseJson(response.bodyText)
  const commit = body.commit && typeof body.commit === 'object' ? body.commit as Record<string, unknown> : null
  const files = Array.isArray(body.files) ? body.files : []
  return {
    sha,
    message: commit && typeof commit.message === 'string' ? commit.message : '',
    date: null,
    parents: Array.isArray(body.parents) ? body.parents.flatMap((parent) => {
      if (!parent || typeof parent !== 'object') return []
      const value = (parent as Record<string, unknown>).sha
      return typeof value === 'string' ? [value] : []
    }) : [],
    files: files.flatMap((file) => {
      if (!file || typeof file !== 'object') return []
      const item = file as Record<string, unknown>
      if (typeof item.filename !== 'string') return []
      return [{ path: item.filename, status: typeof item.status === 'string' ? item.status : null, sha: typeof item.sha === 'string' ? item.sha : null }]
    }),
  }
}

export async function searchRepository(host: Phase2Host, repoId: string, ref: string, query: string, signal: AbortSignal): Promise<GithubSearchResult> {
  const repo = await host.resolveRepo(repoId, signal)
  const branch = await host.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/branches/${encodeURIComponent(ref)}`), signal)
  const head = (parseJson(branch.bodyText).commit as Record<string, unknown> | undefined)?.sha
  if (typeof head !== 'string') throw new GithubError('validation', 'The branch has no commit to search')
  const commit = parseJson((await host.send(githubRead(gitCommitUrl(repo.ownerLogin, repo.name, head)), signal)).bodyText)
  const treeSha = commit.tree && typeof commit.tree === 'object' ? (commit.tree as Record<string, unknown>).sha : null
  if (typeof treeSha !== 'string') throw new GithubError('validation', 'The commit has no tree')
  const tree = parseJson((await host.send(githubRead(gitTreeUrl(repo.ownerLogin, repo.name, treeSha, true)), signal)).bodyText)
  const mapped = mapGitTree(tree)
  const drafts = await draftsFor(host, repoId, ref)
  return searchTreeAndDrafts({
    query,
    entries: mapped.entries,
    truncated: mapped.truncated,
    drafts,
    signal,
    fetchText: async (sha) => {
      if (!sha) return { text: null, unsupported: true }
      const response = await host.send(githubRead(gitBlobUrl(repo.ownerLogin, repo.name, sha)), signal)
      const body = parseJson(response.bodyText)
      if (typeof body.content !== 'string') return { text: null, unsupported: true }
      const bytes = decodeBase64(body.content)
      const kind = classifyBytes(bytes)
      if (kind !== 'text') return { text: null, unsupported: true }
      const text = new TextDecoder().decode(bytes)
      if (text.startsWith('version https://git-lfs.github.com/spec/v1')) return { text: null, unsupported: true }
      return { text, unsupported: false }
    },
  })
}

export async function downloadBlob(host: Phase2Host, repoId: string, sha: string, signal: AbortSignal): Promise<{ base64: string; byteLength: number; mediaKind: 'text' | 'image' | 'pdf' | 'binary' }> {
  const repo = await host.resolveRepo(repoId, signal)
  const response = await host.send({
    ...githubRead(gitBlobUrl(repo.ownerLogin, repo.name, sha), 'application/vnd.github.raw+json'),
  }, signal)
  const base64 = response.bodyBase64
  if (!base64) throw new GithubError('validation', 'Authenticated blob bytes were not returned')
  const bytes = decodeBase64(base64)
  if (bytes.byteLength > GITHUB_DOWNLOAD_BYTE_CAP) throw new GithubError('too_large', 'File exceeds the 25 MB authenticated download limit')
  return { base64, byteLength: bytes.byteLength, mediaKind: classifyBytes(bytes) }
}

const proposals = new Map<string, AiDraftProposal>()

export function prepareAiPacket(input: {
  purpose: GithubAiPurpose
  accountId: string
  repoId: string
  ref: string
  private: boolean
  fileText: string | null
  diffText: string | null
  consented: boolean
}): GithubAiPreparation {
  const warning = GITHUB_AI_RECALL_WARNING
  if (input.private && !input.consented) {
    return { ...input, blocked: true, warning, packet: null, proposalId: null, fileText: undefined, diffText: undefined } as GithubAiPreparation
  }
  const packet = [
    `GitHub ${input.purpose} for account ${input.accountId} repository ${input.repoId} ref ${input.ref}.`,
    input.fileText ? `[FILE]\n${input.fileText}` : '',
    input.diffText ? `[DIFF]\n${input.diffText}` : '',
    warning,
  ].filter(Boolean).join('\n\n')
  return { purpose: input.purpose, accountId: input.accountId, repoId: input.repoId, ref: input.ref, private: input.private, blocked: false, warning, packet, proposalId: null }
}

export function proposeDraftEdit(input: AiDraftProposal): AiDraftProposal {
  proposals.set(input.id, input)
  return input
}

export async function applyDraftProposal(host: Phase2Host, input: { confirm: true; proposalId: string }): Promise<GithubDraft> {
  if (input.confirm !== true) throw new GithubError('ai_mutation_unconfirmed', 'Applying an AI draft requires confirmation')
  const proposal = proposals.get(input.proposalId)
  if (!proposal) throw new GithubError('validation', 'That AI proposal is not available')
  proposals.delete(input.proposalId)
  return putDraft(host.database, {
    accountId: proposal.accountId,
    repoId: proposal.repoId,
    ref: proposal.ref,
    path: proposal.path,
    baseCommitSha: '',
    baseBlobSha: null,
    originalText: null,
    originalBinary: null,
    newText: proposal.text,
    binary: false,
    expectedEditVersion: proposal.baseEditVersion,
    now: host.clock.now(),
  })
}

export function rejectUnconfirmedRemoteMutation(confirm: unknown): CommitResult {
  if (confirm !== true) {
    return { status: 'blocked', code: 'confirmation_required', message: 'Remote commit, create, and delete always require an explicit target confirmation. AI tool settings cannot bypass it.' }
  }
  return { status: 'blocked', code: 'confirmation_required', message: 'Use the confirmed snapshot API. There is no inherited bypass.' }
}
