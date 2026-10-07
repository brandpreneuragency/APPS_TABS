import type { GithubAccount, GithubDraft, GithubPanelLayout } from './types'

export const GITHUB_V1_STORES = {
  githubAccounts: 'id, login',
  githubDrafts: 'id, accountId, repoId, [accountId+repoId+ref], updatedAt',
  githubWorkspaces: 'id, accountId, repoId, [accountId+repoId+ref]',
  githubPrivateCache: 'id, accountId, repoId',
} as const

export interface GithubAccountRecord extends GithubAccount {
  connectedAt: number
}

export type GithubDraftRecord = GithubDraft

export interface GithubWorkspaceRecord {
  id: string
  accountId: string
  repoId: string
  ref: string
  openRepoIds: string[]
  activeRepoId: string | null
  activeRefByRepo: Record<string, string>
  openPaths: string[]
  selectedPath: string | null
  panel: GithubPanelLayout
  updatedAt: number
}

export interface GithubPrivateCacheRecord {
  id: string
  accountId: string
  repoId: string
  kind: 'file' | 'listing' | 'repos'
  iv: string
  ciphertext: string
  updatedAt: number
}
