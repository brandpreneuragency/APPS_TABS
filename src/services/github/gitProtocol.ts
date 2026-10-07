import { GithubError } from './errors'
import { encodeRepoPath, safeName, safeRef } from './identity'
import { GITHUB_API_ORIGIN, GITHUB_API_VERSION, type GithubTransportRequest } from './types'

/**
 * GitHub Git database contract, checked against docs.github.com on 5 October 2026
 * (API version examples 2022-11-28 / 2026-03-10):
 *
 * - POST /repos/{owner}/{repo}/git/refs cannot create a reference in an empty
 *   repository, even if the commit SHA exists. Empty means no branches.
 *   https://docs.github.com/en/rest/git/refs
 * - PATCH /repos/{owner}/{repo}/git/refs/{ref} takes sha and force. force false
 *   (the default) refuses a non-fast-forward update. https://docs.github.com/en/rest/git/refs
 * - POST /git/trees uses base_tree so unspecified paths are kept. sha null deletes
 *   a path and errors if that path is missing. Omitting base_tree would delete
 *   every unspecified path. https://docs.github.com/en/rest/git/trees
 * - POST /git/commits writes a root commit only when parents is omitted or empty.
 *   https://docs.github.com/en/rest/git/commits
 * - Blobs accept utf-8 or base64. Raw media type returns bytes, not a text conversion.
 *   https://docs.github.com/en/rest/git/blobs
 * - Recursive trees set truncated when the 100,000 entry / 7 MB limit is hit.
 *   https://docs.github.com/en/rest/git/trees
 *
 * A single selected file on an empty repository uses one Contents API PUT. That is
 * one commit, and it is labeled contents_bootstrap. A multi-file first commit
 * cannot use git/refs or GraphQL createCommitOnBranch: both require an existing
 * branch. It is one in-memory pack sent with smart HTTP receive-pack on
 * github.com, labeled receive_pack. Contents calls are not repeated, and the
 * push is not a force update.
 */

export const COMMIT_ID_LABEL = 'TABS-Commit-Id:'
export const GITHUB_TREE_ENTRY_CAP = 100_000
export const GITHUB_TREE_BYTE_CAP = 7_000_000
export const GITHUB_SEARCH_BLOB_BYTE_CAP = 100_000
export const GITHUB_SEARCH_FETCH_CAP = 40
export const GITHUB_DOWNLOAD_BYTE_CAP = 25_000_000

const TIMEOUT = 20_000

export function exactCommitMessage(message: string, commitId: string): string {
  const trimmed = message.trim()
  if (!trimmed) throw new GithubError('validation', 'Commit message is required')
  if (!/^[a-f0-9]{32}$/.test(commitId)) throw new GithubError('validation', 'Commit id is not usable')
  const trailer = `${COMMIT_ID_LABEL} ${commitId}`
  if (trimmed.endsWith(trailer)) return trimmed
  return `${trimmed}\n\n${trailer}`
}

export function commitIdFromMessage(message: string): string | null {
  const match = message.match(/TABS-Commit-Id: ([a-f0-9]{32})\s*$/)
  return match?.[1] ?? null
}

function apiUrl(pathname: string, query?: Record<string, string>): string {
  const url = new URL(pathname, GITHUB_API_ORIGIN)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
  return url.toString()
}

function repoPath(owner: string, repo: string, suffix: string): string {
  return `/repos/${encodeURIComponent(safeName(owner))}/${encodeURIComponent(safeName(repo))}${suffix}`
}

function refPath(ref: string): string {
  return safeRef(ref).split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

export function githubWrite(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, accept = 'application/vnd.github+json'): GithubTransportRequest {
  return {
    method,
    url,
    headers: {
      Accept: accept,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'TABS',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    auth: 'bearer',
    timeoutMs: TIMEOUT,
  }
}

export function githubRead(url: string, accept = 'application/vnd.github+json'): GithubTransportRequest {
  return {
    method: 'GET',
    url,
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'TABS',
    },
    auth: 'bearer',
    timeoutMs: TIMEOUT,
  }
}

export function gitCommitUrl(owner: string, repo: string, sha: string): string {
  return apiUrl(repoPath(owner, repo, `/git/commits/${sha}`))
}

export function gitTreeUrl(owner: string, repo: string, sha: string, recursive = false): string {
  return apiUrl(repoPath(owner, repo, `/git/trees/${sha}`), recursive ? { recursive: '1' } : undefined)
}

export function gitBlobUrl(owner: string, repo: string, sha: string): string {
  return apiUrl(repoPath(owner, repo, `/git/blobs/${sha}`))
}

export function gitRefUrl(owner: string, repo: string, ref: string): string {
  return apiUrl(repoPath(owner, repo, `/git/ref/heads/${refPath(ref)}`))
}

export function updateRefUrl(owner: string, repo: string, ref: string): string {
  return apiUrl(repoPath(owner, repo, `/git/refs/heads/${refPath(ref)}`))
}

export function createRefUrl(owner: string, repo: string): string {
  return apiUrl(repoPath(owner, repo, '/git/refs'))
}

export function createBlobUrl(owner: string, repo: string): string {
  return apiUrl(repoPath(owner, repo, '/git/blobs'))
}

export function createTreeUrl(owner: string, repo: string): string {
  return apiUrl(repoPath(owner, repo, '/git/trees'))
}

export function createCommitUrl(owner: string, repo: string): string {
  return apiUrl(repoPath(owner, repo, '/git/commits'))
}

export function receivePackInfoUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(safeName(owner))}/${encodeURIComponent(safeName(repo))}.git/info/refs?service=git-receive-pack`
}

export function receivePackUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(safeName(owner))}/${encodeURIComponent(safeName(repo))}.git/git-receive-pack`
}

export function receivePackRequest(owner: string, repo: string, bodyBase64: string): GithubTransportRequest {
  return {
    method: 'POST',
    url: receivePackUrl(owner, repo),
    headers: {
      'Content-Type': 'application/x-git-receive-pack-request',
      Accept: 'application/x-git-receive-pack-result',
      'User-Agent': 'TABS',
    },
    body: bodyBase64,
    bodyEncoding: 'base64',
    auth: 'bearer',
    timeoutMs: 60_000,
  }
}

export function contentsPutUrl(owner: string, repo: string, path: string): string {
  return apiUrl(repoPath(owner, repo, `/contents/${encodeRepoPath(path)}`))
}

export function historyUrl(owner: string, repo: string, ref: string, page: number): string {
  return apiUrl(repoPath(owner, repo, '/commits'), {
    sha: safeRef(ref),
    per_page: '100',
    page: String(page),
  })
}

export function historyDetailUrl(owner: string, repo: string, sha: string): string {
  return apiUrl(repoPath(owner, repo, `/commits/${sha}`))
}

export function updateRefBody(sha: string): { sha: string; force: false } {
  return { sha, force: false }
}

export function createRefBody(ref: string, sha: string): { ref: string; sha: string } {
  return { ref: `refs/heads/${safeRef(ref)}`, sha }
}

export interface TreeChange {
  path: string
  sha: string | null
  mode: '100644' | '100755'
}

export function treeWriteBody(baseTree: string, changes: TreeChange[]): { base_tree: string; tree: Array<{ path: string; mode: '100644' | '100755'; type: 'blob'; sha: string | null }> } {
  if (!baseTree) throw new GithubError('validation', 'A tree update requires the current base tree')
  return {
    base_tree: baseTree,
    tree: changes.map((change) => ({
      path: change.path,
      mode: change.mode,
      type: 'blob',
      sha: change.sha,
    })),
  }
}

export function isEmptyRepositoryMessage(message: string): boolean {
  return /git repository is empty/i.test(message)
}
