import { GithubError } from './errors'
import { DEFAULT_GITHUB_PANEL, type GithubPanelLayout } from './types'

export function normalizeRepoPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed.includes('\0') || trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new GithubError('validation', 'File path contains an unsupported character')
  }
  if (trimmed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new GithubError('validation', 'File path cannot contain relative segments')
  }
  return trimmed
}

export function encodeRepoPath(path: string): string {
  const rootPath = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!rootPath) return ''
  const normalized = normalizeRepoPath(path)
  return normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

export function draftId(accountId: string, repoId: string, ref: string, path: string): string {
  return `ghdraft:v1:${accountId}:${repoId}:${encodeURIComponent(ref)}:${encodeURIComponent(normalizeRepoPath(path))}`
}

export function accountWorkspaceId(accountId: string): string {
  return `ghws:v1:${accountId}`
}

export function branchWorkspaceId(accountId: string, repoId: string, ref: string): string {
  return `ghws:v1:${accountId}:${repoId}:${encodeURIComponent(ref)}`
}

export function privateCacheId(accountId: string, repoId: string, kind: string, extra = ''): string {
  return `ghcache:v1:${accountId}:${repoId}:${kind}:${encodeURIComponent(extra)}`
}

export function clampPanel(panel: Partial<GithubPanelLayout> | null | undefined): GithubPanelLayout {
  const nav = panel?.navWidthPx
  const navWidthPx = typeof nav === 'number' && Number.isFinite(nav)
    ? Math.min(480, Math.max(120, Math.round(nav)))
    : DEFAULT_GITHUB_PANEL.navWidthPx
  const leftView = panel?.leftView === 'changes' || panel?.leftView === 'history' ? panel.leftView : 'files'
  const editorView = panel?.editorView === 'preview' || panel?.editorView === 'diff' ? panel.editorView : 'source'
  const diffLayout = panel?.diffLayout === 'inline' ? 'inline' : 'side_by_side'
  return { leftView, navWidthPx, editorView, diffLayout }
}

export function safeName(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new GithubError('validation', 'GitHub owner or repository name is not usable')
  }
  return value
}

export function isGithubDocumentPath(path: string): boolean {
  return path.startsWith('github:') || path.startsWith('ghrepo:')
}

export function safeRef(value: string): string {
  if (!value || value.length > 250 || /[\0\r\n]/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new GithubError('validation', 'Branch name is not usable')
  }
  return value
}
