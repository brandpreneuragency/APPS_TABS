import type { GithubAiPurpose } from './types'
import { GITHUB_AI_RECALL_WARNING } from './types'

export interface ProviderHistoryItem {
  role: string
  content: string
  timestamp?: number
}

export interface ProviderAttachment {
  name?: string
  dataUrl?: string
  content?: string
}

export interface GithubDispatchContext {
  accountId: string
  repoId: string
  ref: string
  private: boolean
  purpose?: GithubAiPurpose
}

export interface ProviderDispatchInput {
  provider: 'cli' | 'codex' | 'mock'
  threadId?: string
  text: string
  context: string
  history: ProviderHistoryItem[]
  attachments: ProviderAttachment[]
  images?: string[]
  toolOutput?: string
  github?: GithubDispatchContext | null
}

export interface ProviderDispatchDecision {
  aborted: boolean
  reason: string | null
  warning: string
  text: string
  context: string
  history: ProviderHistoryItem[]
  attachments: ProviderAttachment[]
  images: string[]
  toolOutput: string
}

interface Consent {
  accountId: string
  repoId: string
  grantedAt: number
}

interface SensitiveRecord {
  accountId: string
  repoId: string
  ref: string
  private: boolean
  spans: string[]
}

interface PendingDispatch {
  id: string
  threadId: string | null
  accountId: string
  repoId: string
  ref: string
  generation: number
  aborted: boolean
  payload: string
}

interface ThreadWatch {
  threadId: string
  accountId: string
  repoId: string
  ref: string
  generation: number
}

const consents = new Map<string, Consent>()
const sensitive: SensitiveRecord[] = []
const pending = new Map<string, PendingDispatch>()
const watches = new Map<string, ThreadWatch>()
const taintedThreads = new Map<string, { accountId: string; repoId: string }>()
let generation = 0
let currentTarget: { accountId: string; repoId: string; ref: string } | null = null

function key(accountId: string, repoId: string): string {
  return `${accountId}:${repoId}`
}

export function resetGithubAiEgressForTests(): void {
  consents.clear()
  sensitive.splice(0, sensitive.length)
  pending.clear()
  watches.clear()
  taintedThreads.clear()
  generation = 0
  currentTarget = null
}

export function grantGithubAiConsent(accountId: string, repoId: string, grantedAt: number): void {
  consents.set(key(accountId, repoId), { accountId, repoId, grantedAt })
}

export function revokeGithubAiConsent(accountId: string, repoId: string): void {
  consents.delete(key(accountId, repoId))
  generation += 1
  for (const item of pending.values()) {
    if (item.accountId === accountId && item.repoId === repoId) {
      item.aborted = true
      item.payload = ''
    }
  }
  for (const [threadId, taint] of taintedThreads) {
    if (taint.accountId === accountId && taint.repoId === repoId) taintedThreads.set(threadId, taint)
  }
}

export function hasGithubAiConsent(accountId: string, repoId: string): boolean {
  return consents.has(key(accountId, repoId))
}

export function registerGithubMaterial(record: SensitiveRecord): void {
  const spans = record.spans.map((span) => span.trim()).filter((span) => span.length >= 8)
  sensitive.push({ ...record, spans })
}

export function noteGithubTarget(accountId: string, repoId: string, ref: string): void {
  const changed = !currentTarget || currentTarget.accountId !== accountId || currentTarget.repoId !== repoId || currentTarget.ref !== ref
  currentTarget = { accountId, repoId, ref }
  if (!changed) return
  generation += 1
  for (const item of pending.values()) {
    if (item.accountId === accountId && (item.repoId !== repoId || item.ref !== ref)) {
      item.aborted = true
      item.payload = ''
    }
  }
}

export function githubWorkspaceId(accountId: string, repoId: string, ref: string): string {
  return `github:${accountId}:${repoId}:${encodeURIComponent(ref)}`
}

export function persistedGithubDispatchAllowed(input: {
  accountId: string
  repoId: string
  ref: string
  requestedWorkspaceId?: string
  threadWorkspaceId?: string
  messageWorkspaceIds: Array<string | undefined>
}): boolean {
  const expected = githubWorkspaceId(input.accountId, input.repoId, input.ref)
  if (input.threadWorkspaceId !== expected) return false
  if (input.requestedWorkspaceId && input.requestedWorkspaceId !== expected) return false
  return input.messageWorkspaceIds.every((id) => id === undefined || id === expected)
}

export function watchProviderThread(threadId: string, target: { accountId: string; repoId: string; ref: string }): void {
  const existing = watches.get(threadId)
  if (existing && (existing.accountId !== target.accountId || existing.repoId !== target.repoId || existing.ref !== target.ref)) {
    watches.set(threadId, { ...existing, generation: -1 })
    return
  }
  watches.set(threadId, { threadId, ...target, generation })
}

export function isProviderThreadInaccessible(threadId: string): boolean {
  const taint = taintedThreads.get(threadId)
  if (taint && !hasGithubAiConsent(taint.accountId, taint.repoId)) return true
  const watch = watches.get(threadId)
  if (!watch) return false
  if (watch.generation !== generation) return true
  if (currentTarget && (currentTarget.repoId !== watch.repoId || currentTarget.ref !== watch.ref || currentTarget.accountId !== watch.accountId)) {
    return true
  }
  return false
}

function privateSpans(): string[] {
  const spans: string[] = []
  for (const record of sensitive) {
    if (!record.private) continue
    if (hasGithubAiConsent(record.accountId, record.repoId)) continue
    spans.push(...record.spans)
  }
  return spans
}

function containsSpan(value: string, spans: string[]): boolean {
  return spans.some((span) => value.includes(span))
}

function bundle(input: ProviderDispatchInput): string {
  return [
    input.text,
    input.context,
    input.toolOutput ?? '',
    ...input.history.map((item) => item.content),
    ...input.attachments.map((item) => `${item.name ?? ''}\n${item.content ?? ''}\n${item.dataUrl ?? ''}`),
    ...(input.images ?? []),
  ].join('\n')
}

export function finalizeProviderDispatch(input: ProviderDispatchInput): ProviderDispatchDecision {
  const warning = GITHUB_AI_RECALL_WARNING
  const spans = privateSpans()
  const githubPrivate = input.github?.private === true
  const consented = input.github ? hasGithubAiConsent(input.github.accountId, input.github.repoId) : false
  const threadBlocked = input.threadId ? isProviderThreadInaccessible(input.threadId) : false
  const leaked = containsSpan(bundle(input), spans)
  const deny = threadBlocked || leaked || (githubPrivate && !consented)
  if (!deny) {
    if (input.github?.private && input.threadId && consented) {
      taintedThreads.set(input.threadId, { accountId: input.github.accountId, repoId: input.github.repoId })
    }
    return {
      aborted: false,
      reason: null,
      warning,
      text: input.text,
      context: input.context,
      history: input.history,
      attachments: input.attachments,
      images: input.images ?? [],
      toolOutput: input.toolOutput ?? '',
    }
  }
  const reason = githubPrivate && !consented
    ? 'Private GitHub content cannot be sent without repo consent.'
    : 'GitHub provider dispatch was stopped. Previously sent content cannot be recalled.'
  return {
    aborted: true,
    reason,
    warning,
    text: '',
    context: '',
    history: [],
    attachments: [],
    images: [],
    toolOutput: '',
  }
}

export function beginPendingDispatch(input: ProviderDispatchInput & { accountId: string; repoId: string; ref: string }): string {
  const id = crypto.randomUUID()
  pending.set(id, {
    id,
    threadId: input.threadId ?? null,
    accountId: input.accountId,
    repoId: input.repoId,
    ref: input.ref,
    generation,
    aborted: false,
    payload: bundle(input),
  })
  return id
}

export function pendingDispatchAborted(id: string): boolean {
  const item = pending.get(id)
  if (!item) return true
  if (item.generation !== generation) {
    item.aborted = true
    item.payload = ''
  }
  return item.aborted
}

export function clearPendingDispatch(id: string): void {
  const item = pending.get(id)
  if (item) item.payload = ''
  pending.delete(id)
}

export function providerDispatchBlockedMessage(): string {
  return `GitHub content was not sent. Private repository consent is required. ${GITHUB_AI_RECALL_WARNING}`
}
