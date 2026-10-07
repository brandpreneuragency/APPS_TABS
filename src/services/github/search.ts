import { publicGithubError, isGithubError } from './errors'
import { GITHUB_SEARCH_BLOB_BYTE_CAP, GITHUB_SEARCH_FETCH_CAP, GITHUB_TREE_BYTE_CAP, GITHUB_TREE_ENTRY_CAP } from './gitProtocol'
import type { GithubDraft, GithubSearchMatch, GithubSearchResult } from './types'

export interface SearchTreeEntry {
  path: string
  mode: string
  type: string
  sha: string | null
  byteLength: number | null
}

export function mapGitTree(body: Record<string, unknown>): { truncated: boolean; entries: SearchTreeEntry[] } {
  const rows = Array.isArray(body.tree) ? body.tree : []
  const entries: SearchTreeEntry[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.path !== 'string') continue
    entries.push({
      path: item.path.replace(/^\/+/, ''),
      mode: typeof item.mode === 'string' ? item.mode : '',
      type: typeof item.type === 'string' ? item.type : '',
      sha: typeof item.sha === 'string' ? item.sha : null,
      byteLength: typeof item.size === 'number' ? item.size : null,
    })
  }
  return { truncated: body.truncated === true, entries }
}

function unsupported(entry: SearchTreeEntry): boolean {
  return entry.mode === '120000' || entry.mode === '160000' || entry.type === 'commit' || entry.type === 'symlink'
}

function lineMatch(text: string, query: string): { line: number; preview: string } | null {
  const needle = query.toLowerCase()
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().includes(needle)) {
      return { line: index + 1, preview: lines[index].slice(0, 180) }
    }
  }
  return null
}

export async function searchTreeAndDrafts(args: {
  query: string
  entries: SearchTreeEntry[]
  truncated: boolean
  drafts: GithubDraft[]
  fetchText: (sha: string, byteLength: number | null) => Promise<{ text: string | null; unsupported: boolean }>
  signal: AbortSignal
  rateLimited?: boolean
}): Promise<GithubSearchResult> {
  const query = args.query.trim()
  const progress = {
    scannedBlobs: 0,
    skippedBySize: 0,
    skippedUnsupported: 0,
    draftCount: args.drafts.length,
    treeTruncated: args.truncated,
    fetchCapReached: false,
    rateLimited: args.rateLimited === true,
  }
  const matches: GithubSearchMatch[] = []
  const hidden = new Set<string>()
  for (const draft of args.drafts) {
    hidden.add(draft.path)
    if (draft.newPath) hidden.add(draft.newPath)
    if (draft.operation === 'delete' || draft.newText === null) continue
    const text = draft.binary ? null : draft.newText
    const path = draft.newPath || draft.path
    if (text !== null && lineMatch(text, query)) {
      const hit = lineMatch(text, query)
      if (hit) matches.push({ path, source: 'draft', line: hit.line, preview: hit.preview })
    }
  }
  let error: GithubSearchResult['error'] = null
  for (const entry of args.entries) {
    if (args.signal.aborted) break
    if (entry.type !== 'blob') continue
    if (unsupported(entry)) {
      progress.skippedUnsupported += 1
      continue
    }
    if (hidden.has(entry.path)) continue
    if ((entry.byteLength ?? 0) > GITHUB_SEARCH_BLOB_BYTE_CAP) {
      progress.skippedBySize += 1
      continue
    }
    if (progress.scannedBlobs >= GITHUB_SEARCH_FETCH_CAP) {
      progress.fetchCapReached = true
      break
    }
    try {
      const fetched = await args.fetchText(entry.sha ?? '', entry.byteLength)
      progress.scannedBlobs += 1
      if (fetched.unsupported || fetched.text === null) {
        progress.skippedUnsupported += 1
        continue
      }
      const hit = lineMatch(fetched.text, query)
      if (hit) matches.push({ path: entry.path, source: 'remote', line: hit.line, preview: hit.preview })
    } catch (cause) {
      if (isGithubError(cause) && cause.code === 'rate_limited') {
        progress.rateLimited = true
        error = publicGithubError(cause)
        break
      }
      throw cause
    }
  }
  const incomplete = progress.treeTruncated || progress.fetchCapReached || progress.rateLimited || progress.skippedBySize > 0 || !args.signal.aborted && error !== null
  const notes = [
    progress.treeTruncated ? `GitHub tree was truncated (limit ${GITHUB_TREE_ENTRY_CAP} entries / ${GITHUB_TREE_BYTE_CAP} bytes).` : '',
    progress.fetchCapReached ? `Search stopped after ${GITHUB_SEARCH_FETCH_CAP} blob reads.` : '',
    progress.skippedBySize ? `${progress.skippedBySize} files exceeded the ${GITHUB_SEARCH_BLOB_BYTE_CAP} byte search limit.` : '',
    progress.skippedUnsupported ? `${progress.skippedUnsupported} symlink, submodule, or LFS entries were not followed.` : '',
    progress.rateLimited ? 'GitHub rate limit stopped the search.' : '',
    `Draft overlay covered ${progress.draftCount} local drafts.`,
  ].filter(Boolean)
  const complete = !incomplete && error === null && !args.signal.aborted
  return {
    items: matches,
    complete,
    progress,
    message: complete
      ? (progress.skippedUnsupported ? notes.join(' ') : null)
      : `Search is incomplete. ${notes.join(' ')}`,
    error,
  }
}
