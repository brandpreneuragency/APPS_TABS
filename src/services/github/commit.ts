import { parseJson } from './api'
import { decodeBase64, textToBase64 } from './binary'
import { GithubError, isGithubError, publicGithubError } from './errors'
import { buildInitialReceivePack, parseReceivePackResult, parseRefAdvertisement } from './gitPack'
import {
  COMMIT_ID_LABEL,
  contentsPutUrl,
  createBlobUrl,
  createCommitUrl,
  createTreeUrl,
  exactCommitMessage,
  gitCommitUrl,
  gitTreeUrl,
  githubRead,
  githubWrite,
  isEmptyRepositoryMessage,
  receivePackInfoUrl,
  receivePackRequest,
  treeWriteBody,
  updateRefBody,
  updateRefUrl,
  type TreeChange,
} from './gitProtocol'
import type { CommitResult, GithubDraft, GithubErrorCode, GithubTransportRequest, GithubTransportResponse } from './types'

export interface CommitSnapshot {
  path: string
  editVersion: number
  operation: GithubDraft['operation']
  newPath: string | null
  binary: boolean
  newText: string | null
  newBinary: string | null
  baseBlobSha: string | null
  baseCommitSha: string
}

export interface AtomicCommitIO {
  send: (request: GithubTransportRequest, signal: AbortSignal) => Promise<GithubTransportResponse>
  generation: () => number
  capturedGeneration: number
  owner: string
  repo: string
  ref: string
  expectedBaseSha: string
  sentMessage: string
  commitId: string
  snapshots: CommitSnapshot[]
  empty: boolean
  signal: AbortSignal
  authorName: string
  authorEmail: string
  authoredAt: number
}

function blocked(code: GithubErrorCode, message: string, retryAfterMs?: number): CommitResult {
  return { status: 'blocked', code, message, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) }
}

function stale(): CommitResult {
  return { status: 'stale_target', message: 'The repository or branch changed before this commit could be sent.' }
}

function assertCurrent(io: AtomicCommitIO): CommitResult | null {
  if (io.signal.aborted) return blocked('cancelled', 'Cancelled')
  if (io.generation() !== io.capturedGeneration) return stale()
  return null
}

async function readSha(response: GithubTransportResponse): Promise<string | null> {
  const body = parseJson(response.bodyText)
  if (typeof body.sha === 'string') return body.sha
  const object = body.object
  if (object && typeof object === 'object' && typeof (object as Record<string, unknown>).sha === 'string') {
    return (object as Record<string, unknown>).sha as string
  }
  const commit = body.commit
  if (commit && typeof commit === 'object' && typeof (commit as Record<string, unknown>).sha === 'string') {
    return (commit as Record<string, unknown>).sha as string
  }
  return null
}

async function mutating(
  io: AtomicCommitIO,
  request: GithubTransportRequest,
  counts: { commits: number; patches: number; puts: number; packs: number },
): Promise<GithubTransportResponse | 'ambiguous'> {
  const stopped = assertCurrent(io)
  if (stopped) throw new GithubError(stopped.status === 'stale_target' ? 'stale_target' : 'cancelled', stopped.status === 'stale_target' ? stopped.message : 'Cancelled')
  if (request.method === 'POST' && request.url.endsWith('/git/commits')) counts.commits += 1
  if (request.method === 'PATCH') counts.patches += 1
  if (request.method === 'PUT') counts.puts += 1
  if (request.url.includes('/git-receive-pack')) counts.packs += 1
  if (counts.commits > 1 || counts.patches > 1 || counts.puts > 1 || counts.packs > 1) {
    throw new GithubError('ambiguous_write', 'A commit write was not retried')
  }
  try {
    return await io.send(request, io.signal)
  } catch (error) {
    if (isGithubError(error) && (error.code === 'timeout' || error.code === 'ambiguous_write')) {
      return 'ambiguous'
    }
    throw error
  }
}

function outcomeFromError(error: unknown): CommitResult {
  const pub = publicGithubError(error)
  if (pub.code === 'protected_branch') return { status: 'protected_branch', message: pub.message }
  if (pub.code === 'stale_target') return { status: 'stale_target', message: pub.message }
  if (pub.code === 'conflict') return { status: 'conflict', remoteSha: null, message: pub.message }
  if (pub.code === 'ambiguous_write' || pub.code === 'timeout') {
    return { status: 'ambiguous', message: 'The commit result is unknown. It was not retried.' }
  }
  return blocked(pub.code, pub.message, pub.retryAfterMs)
}

async function readbackCommit(io: AtomicCommitIO, expectedSha: string | null): Promise<CommitResult | null> {
  try {
    const branch = await io.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(io.owner)}/${encodeURIComponent(io.repo)}/branches/${encodeURIComponent(io.ref)}`), io.signal)
    const body = parseJson(branch.bodyText)
    const commit = body.commit
    const sha = commit && typeof commit === 'object' ? (commit as Record<string, unknown>).sha : null
    if (typeof sha !== 'string') return { status: 'ambiguous', message: 'The branch could not be read back. The commit was not retried.' }
    if (expectedSha && sha === expectedSha) return null
    if (sha === io.expectedBaseSha) return { status: 'not_applied', message: 'The branch still points at the original commit. Nothing was retried.' }
    const detail = await io.send(githubRead(gitCommitUrl(io.owner, io.repo, sha)), io.signal)
    const commitBody = parseJson(detail.bodyText)
    const message = typeof commitBody.message === 'string' ? commitBody.message : ''
    const parents = Array.isArray(commitBody.parents) ? commitBody.parents : []
    const parent = parents[0] && typeof parents[0] === 'object' ? (parents[0] as Record<string, unknown>).sha : null
    if (message.includes(`${COMMIT_ID_LABEL} ${io.commitId}`) && parent === io.expectedBaseSha) {
      return {
        status: 'sent',
        protocol: 'git_data',
        commitSha: sha,
        ref: io.ref,
        sentMessage: io.sentMessage,
        clearedPaths: [],
        keptPaths: [],
      }
    }
    return { status: 'conflict', remoteSha: sha, message: 'The branch moved and does not contain this commit. The write was not retried.' }
  } catch (error) {
    if (isGithubError(error) && error.code === 'conflict' && isEmptyRepositoryMessage(error.message)) {
      return { status: 'not_applied', message: 'The repository is still empty. The commit was not retried.' }
    }
    return { status: 'ambiguous', message: 'The commit result could not be read back. It was not retried.' }
  }
}

export async function runAtomicCommit(io: AtomicCommitIO): Promise<CommitResult> {
  const stopped = assertCurrent(io)
  if (stopped) return stopped
  const message = exactCommitMessage(io.sentMessage, io.commitId)
  if (message !== io.sentMessage) return blocked('confirmation_required', 'Confirm the exact commit message, including its commit id')
  if (io.snapshots.length === 0) return blocked('validation', 'Select at least one draft')
  if (io.snapshots.some((item) => item.baseCommitSha !== io.expectedBaseSha)) {
    return blocked('mixed_base', 'Selected drafts do not share one base commit')
  }
  const counts = { commits: 0, patches: 0, puts: 0, packs: 0 }
  try {
    if (io.empty) return await bootstrapEmpty(io, counts)
    return await commitOnExisting(io, counts)
  } catch (error) {
    if (isGithubError(error) && (error.code === 'timeout' || error.code === 'ambiguous_write')) {
      const read = await readbackCommit(io, null)
      return read ?? { status: 'ambiguous', message: 'The commit result is unknown. It was not retried.' }
    }
    return outcomeFromError(error)
  }
}

async function bootstrapEmpty(io: AtomicCommitIO, counts: { commits: number; patches: number; puts: number; packs: number }): Promise<CommitResult> {
  const additions = io.snapshots.filter((item) => item.operation !== 'delete' && item.operation !== 'rename' && item.operation !== 'move')
  if (additions.length !== io.snapshots.length) {
    return blocked('empty_repo_atomic_unavailable', 'An empty repository can only bootstrap new files')
  }
  if (additions.length === 1) return bootstrapOneFile(io, counts, additions[0])
  return bootstrapReceivePack(io, counts, additions)
}

function snapshotContent(only: CommitSnapshot): string | null {
  if (only.binary) return only.newBinary
  if (only.newText === null) return null
  return textToBase64(only.newText)
}

async function bootstrapOneFile(
  io: AtomicCommitIO,
  counts: { commits: number; patches: number; puts: number; packs: number },
  only: CommitSnapshot,
): Promise<CommitResult> {
  const content = snapshotContent(only)
  if (content === null) return blocked('validation', 'The first file has no content')
  const request = githubWrite('PUT', contentsPutUrl(io.owner, io.repo, only.path), {
    message: io.sentMessage,
    content,
    branch: io.ref,
  })
  const response = await mutating(io, request, counts)
  if (response === 'ambiguous') return await readbackCommit(io, null) ?? { status: 'ambiguous', message: 'The first commit result is unknown. It was not retried.' }
  const sha = await readSha(response)
  const read = await readbackCommit(io, sha)
  if (read && read.status !== 'sent' && read.status !== 'not_applied') return read
  if (!sha) return { status: 'ambiguous', message: 'GitHub did not return the bootstrap commit. It was not retried.' }
  const confirmed = await readbackCommit(io, sha)
  if (confirmed && confirmed.status !== 'sent') return confirmed
  return {
    status: 'sent',
    protocol: 'contents_bootstrap',
    commitSha: sha,
    ref: io.ref,
    sentMessage: io.sentMessage,
    clearedPaths: [],
    keptPaths: [],
  }
}

async function bootstrapReceivePack(
  io: AtomicCommitIO,
  counts: { commits: number; patches: number; puts: number; packs: number },
  files: CommitSnapshot[],
): Promise<CommitResult> {
  const stopped = assertCurrent(io)
  if (stopped) return stopped
  let advertisement: GithubTransportResponse
  try {
    advertisement = await io.send(githubRead(receivePackInfoUrl(io.owner, io.repo)), io.signal)
  } catch (error) {
    return outcomeFromError(error)
  }
  let parsed: ReturnType<typeof parseRefAdvertisement>
  try {
    parsed = parseRefAdvertisement(advertisement.bodyText)
  } catch (error) {
    return outcomeFromError(error)
  }
  const target = `refs/heads/${io.ref}`
  if (!parsed.empty || parsed.refs.some((ref) => ref.name === target)) {
    return { status: 'conflict', remoteSha: parsed.refs[0]?.sha ?? null, message: 'The repository is no longer empty. The first push was not sent.' }
  }
  const packedFiles: Array<{ path: string; bytes: Uint8Array }> = []
  for (const item of files) {
    const bytes = item.binary
      ? item.newBinary === null ? null : decodeBase64(item.newBinary)
      : item.newText === null ? null : new TextEncoder().encode(item.newText)
    if (bytes === null) return blocked('validation', 'A new file is missing content')
    packedFiles.push({ path: item.path, bytes })
  }
  const pack = await buildInitialReceivePack({
    files: packedFiles,
    message: io.sentMessage,
    authorName: io.authorName,
    authorEmail: io.authorEmail,
    authoredAt: io.authoredAt,
    ref: io.ref,
  })
  const response = await mutating(io, receivePackRequest(io.owner, io.repo, pack.bodyBase64), counts)
  if (response === 'ambiguous') {
    const read = await readbackCommit(io, pack.commitSha)
    return read ?? { status: 'ambiguous', message: 'The first multi-file commit result is unknown. It was not retried.' }
  }
  const report = parseReceivePackResult(response.bodyText, io.ref)
  if (!report.unpackOk || !report.refOk) {
    const read = await readbackCommit(io, pack.commitSha)
    if (read?.status === 'sent') return { ...read, protocol: 'receive_pack' }
    if (read === null) {
      return {
        status: 'sent', protocol: 'receive_pack', commitSha: pack.commitSha, ref: io.ref,
        sentMessage: io.sentMessage, clearedPaths: [], keptPaths: [],
      }
    }
    if (read?.status === 'conflict') return read
    if (/protected|hook declined/i.test(report.message) && read?.status === 'not_applied') {
      return { status: 'protected_branch', message: 'GitHub branch protection refused the first push. No protection bypass or retry was attempted.' }
    }
    if (read?.status === 'not_applied') return read
    return read ?? { status: 'ambiguous', message: `${report.message} The push was not retried.` }
  }
  const read = await readbackCommit(io, pack.commitSha)
  if (read && read.status !== 'sent') return read
  return {
    status: 'sent',
    protocol: 'receive_pack',
    commitSha: pack.commitSha,
    ref: io.ref,
    sentMessage: io.sentMessage,
    clearedPaths: [],
    keptPaths: [],
  }
}

async function commitOnExisting(io: AtomicCommitIO, counts: { commits: number; patches: number; puts: number; packs: number }): Promise<CommitResult> {
  const head = await io.send(githubRead(`https://api.github.com/repos/${encodeURIComponent(io.owner)}/${encodeURIComponent(io.repo)}/branches/${encodeURIComponent(io.ref)}`), io.signal)
  const headBody = parseJson(head.bodyText)
  const headCommit = headBody.commit && typeof headBody.commit === 'object' ? headBody.commit as Record<string, unknown> : null
  const headSha = typeof headCommit?.sha === 'string' ? headCommit.sha : null
  if (!headSha) return blocked('validation', 'GitHub did not return the branch commit')
  if (headSha !== io.expectedBaseSha) {
    return { status: 'conflict', remoteSha: headSha, message: 'The remote branch moved. The draft base was not changed.' }
  }
  const commitResponse = await io.send(githubRead(gitCommitUrl(io.owner, io.repo, headSha)), io.signal)
  const commitBody = parseJson(commitResponse.bodyText)
  const tree = commitBody.tree && typeof commitBody.tree === 'object' ? commitBody.tree as Record<string, unknown> : null
  const baseTree = typeof tree?.sha === 'string' ? tree.sha : null
  if (!baseTree) return blocked('validation', 'GitHub did not return the base tree')
  const loaded = await loadTreeModes(io, baseTree)
  const modes = loaded.modes
  const changes: TreeChange[] = []
  for (const item of io.snapshots) {
    const stopped = assertCurrent(io)
    if (stopped) return stopped
    if (loaded.unsupported.has(item.path) || (item.newPath && loaded.unsupported.has(item.newPath))) {
      return blocked('unsupported_entry', 'Symlinks and submodules are not followed')
    }
    if (item.operation === 'delete') {
      changes.push({ path: item.path, sha: null, mode: writableMode(modes.get(item.path), true) })
      continue
    }
    if (item.operation === 'rename' || item.operation === 'move') {
      if (!item.newPath) return blocked('validation', 'A rename needs a destination path')
      const mode = writableMode(modes.get(item.path), false)
      changes.push({ path: item.path, sha: null, mode })
      const sha = await blobFor(io, item, counts)
      changes.push({ path: item.newPath, sha, mode })
      continue
    }
    const existing = modes.get(item.path)
    const mode = writableMode(existing, existing === undefined)
    const sha = await blobFor(io, item, counts)
    changes.push({ path: item.path, sha, mode })
  }
  const treeResponse = await mutating(io, githubWrite('POST', createTreeUrl(io.owner, io.repo), treeWriteBody(baseTree, changes)), counts)
  if (treeResponse === 'ambiguous') return await readbackCommit(io, null) ?? { status: 'ambiguous', message: 'The tree write result is unknown. It was not retried.' }
  const treeSha = await readSha(treeResponse)
  if (!treeSha) return blocked('validation', 'GitHub did not return the new tree')
  const commitWrite = await mutating(io, githubWrite('POST', createCommitUrl(io.owner, io.repo), {
    message: io.sentMessage,
    tree: treeSha,
    parents: [io.expectedBaseSha],
  }), counts)
  if (commitWrite === 'ambiguous') return await readbackCommit(io, null) ?? { status: 'ambiguous', message: 'The commit result is unknown. It was not retried.' }
  const newSha = await readSha(commitWrite)
  if (!newSha) return { status: 'ambiguous', message: 'GitHub did not return the new commit. It was not retried.' }
  const refWrite = await mutating(io, githubWrite('PATCH', updateRefUrl(io.owner, io.repo, io.ref), updateRefBody(newSha)), counts)
  if (refWrite === 'ambiguous') {
    const read = await readbackCommit(io, newSha)
    return read ?? { status: 'ambiguous', message: 'The reference update result is unknown. It was not retried.' }
  }
  const updated = await readSha(refWrite)
  if (updated !== newSha) return { status: 'ambiguous', message: 'The reference update did not echo the new commit. It was not retried.' }
  const read = await readbackCommit(io, newSha)
  if (read && read.status !== 'sent') return read
  return {
    status: 'sent',
    protocol: 'git_data',
    commitSha: newSha,
    ref: io.ref,
    sentMessage: io.sentMessage,
    clearedPaths: [],
    keptPaths: [],
  }
}

async function blobFor(io: AtomicCommitIO, item: CommitSnapshot, counts: { commits: number; patches: number; puts: number; packs: number }): Promise<string> {
  if (!item.binary && item.newText === null && item.baseBlobSha && (item.operation === 'rename' || item.operation === 'move')) {
    return item.baseBlobSha
  }
  if (item.binary ? item.newBinary === null : item.newText === null) {
    throw new GithubError('validation', 'The selected file has no content')
  }
  const body = item.binary
    ? { content: item.newBinary, encoding: 'base64' }
    : { content: item.newText, encoding: 'utf-8' }
  const response = await mutating(io, githubWrite('POST', createBlobUrl(io.owner, io.repo), body), counts)
  if (response === 'ambiguous') throw new GithubError('ambiguous_write', 'A blob write result is unknown. The commit was not retried.')
  const sha = await readSha(response)
  if (!sha) throw new GithubError('validation', 'GitHub did not return a blob SHA')
  return sha
}

async function loadTreeModes(io: AtomicCommitIO, baseTree: string): Promise<{ modes: Map<string, string>; unsupported: Set<string> }> {
  const response = await io.send(githubRead(gitTreeUrl(io.owner, io.repo, baseTree, true)), io.signal)
  const body = parseJson(response.bodyText)
  if (body.truncated === true) throw new GithubError('validation', 'The base tree was truncated, so file modes could not be preserved')
  const modes = new Map<string, string>()
  const unsupported = new Set<string>()
  const rows = Array.isArray(body.tree) ? body.tree : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.path !== 'string' || typeof item.mode !== 'string') continue
    if (item.mode === '120000' || item.mode === '160000' || item.type === 'commit' || item.type === 'symlink') {
      unsupported.add(item.path)
      continue
    }
    modes.set(item.path, item.mode)
  }
  return { modes, unsupported }
}

function writableMode(existing: string | undefined, isNew: boolean): '100644' | '100755' {
  if (existing === '120000' || existing === '160000') {
    throw new GithubError('unsupported_entry', 'Symlinks and submodules are not followed')
  }
  if (isNew || !existing) return '100644'
  if (existing === '100755') return '100755'
  if (existing === '100644') return '100644'
  throw new GithubError('unsupported_entry', 'This Git mode cannot be edited or followed')
}
