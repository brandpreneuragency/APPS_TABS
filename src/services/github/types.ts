/** GitHub mode domain types. Identity is numeric account/repo id, never a display name. */

export const GITHUB_PHASE1_SCOPE = 'repo'
export const GITHUB_DELETE_SCOPE = 'delete_repo'
export const GITHUB_VERIFICATION_URI = 'https://github.com/login/device'
export const GITHUB_API_ORIGIN = 'https://api.github.com'
export const GITHUB_OAUTH_ORIGIN = 'https://github.com'
export const GITHUB_API_VERSION = '2022-11-28'
export const GITHUB_INLINE_BYTE_CAP = 1_000_000
export const GITHUB_CLIENT_ID_SETTING = 'githubOauthClientId'

/**
 * Classic OAuth has no read-only private-repo scope. `repo` is the minimum
 * that can list and read personal private repositories. `delete_repo` is a
 * separate grant and is not requested in this phase.
 */
export const GITHUB_SCOPE_NOTE =
  'Phase 1 requests only the repo scope. delete_repo is not requested; repository deletion needs a later elevation. repo is broader than read because GitHub OAuth has no private read-only scope.'

export const GITHUB_SECURE_ACCOUNTS = {
  access: 'github.oauth.access',
  refresh: 'github.oauth.refresh',
  cacheKey: 'github.cache-key',
} as const

export type GithubSecureAccount = (typeof GITHUB_SECURE_ACCOUNTS)[keyof typeof GITHUB_SECURE_ACCOUNTS]

export type GithubErrorCode =
  | 'needs_setup'
  | 'native_unavailable'
  | 'native_http_not_linked'
  | 'client_secret_forbidden'
  | 'invalid_client_id'
  | 'already_connected'
  | 'sign_in_in_progress'
  | 'cancelled'
  | 'timeout'
  | 'auth_expired'
  | 'access_denied'
  | 'device_expired'
  | 'device_flow_disabled'
  | 'insufficient_scope'
  | 'personal_account_required'
  | 'organization_rejected'
  | 'rate_limited'
  | 'host_rejected'
  | 'redirect_rejected'
  | 'token_leak_rejected'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'github_unavailable'
  | 'too_large'
  | 'unsupported_entry'
  | 'draft_delete_unconfirmed'
  | 'persistence'
  | 'signed_out'
  | 'protected_branch'
  | 'empty_repo_atomic_unavailable'
  | 'empty_repo_ref_rejected'
  | 'ambiguous_write'
  | 'stale_target'
  | 'unresolved_conflict'
  | 'confirmation_required'
  | 'ai_consent_required'
  | 'ai_mutation_unconfirmed'
  | 'commit_in_progress'
  | 'mixed_base'
  | 'target_mismatch'
  | 'needs_delete_scope'

export interface DeviceBrowserChallenge {
  userCode: string
  verificationUri: typeof GITHUB_VERIFICATION_URI
  browserUrl: typeof GITHUB_VERIFICATION_URI
  expiresAt: number
  intervalSeconds: number
}

export interface GithubAccount {
  id: string
  login: string
  displayName: string | null
  avatarUrl: string | null
  grantedScopes: string[]
  expiresAt: number | null
}

export type GithubConnection =
  | { status: 'needs_setup' }
  | { status: 'native_unavailable'; reason: 'desktop_required' | 'native_http_not_linked' }
  | { status: 'signed_out' }
  | { status: 'authorizing'; challenge: DeviceBrowserChallenge }
  | { status: 'connected'; account: GithubAccount }
  | { status: 'auth_expired'; accountId: string | null }

export interface GithubRepo {
  id: string
  ownerId: string
  ownerLogin: string
  name: string
  private: boolean
  defaultBranch: string
  description: string | null
}

export interface GithubBranch {
  name: string
  commitSha: string
  protected: boolean
}

export type GithubEntryKind = 'file' | 'dir' | 'symlink' | 'submodule' | 'lfs_pointer' | 'unsupported'

export interface GithubEntry {
  name: string
  path: string
  kind: GithubEntryKind
  sha: string | null
  byteLength: number | null
}

export interface GithubPage<T> {
  items: T[]
  complete: boolean
  message: string | null
  error: { code: GithubErrorCode; message: string; retryAfterMs?: number } | null
}

export type GithubFileKind = 'text' | 'binary' | 'lfs_pointer' | 'symlink' | 'submodule' | 'directory' | 'too_large'

export interface GithubOpenedFile {
  accountId: string
  repoId: string
  ref: string
  path: string
  kind: GithubFileKind
  /** Draft text when a draft exists, otherwise remote text. Null for non-text. */
  text: string | null
  binaryBase64: string | null
  baseCommitSha: string | null
  baseBlobSha: string | null
  remoteBlobSha: string | null
  draft: GithubDraft | null
  byteLength: number
  private: boolean
  message: string | null
  mediaKind?: 'text' | 'image' | 'pdf' | 'binary'
}

export type GithubDraftOperation = 'edit' | 'add' | 'delete' | 'rename' | 'move'

export type GithubConflictKind = 'content' | 'delete_edit' | 'edit_delete' | 'rename_collision' | 'binary'

export type GithubConflictChoice = 'unresolved' | 'mine' | 'theirs' | 'both' | 'custom'

export interface GithubDraftConflict {
  kind: GithubConflictKind
  remoteCommitSha: string
  remoteBlobSha: string | null
  remoteText: string | null
  remoteBinary: string | null
  remoteDeleted: boolean
  choice: GithubConflictChoice
  resultText: string | null
  resultBinary: string | null
  resolved: boolean
}

export interface GithubDraft {
  id: string
  accountId: string
  repoId: string
  ref: string
  path: string
  baseCommitSha: string
  baseBlobSha: string | null
  originalText: string | null
  originalBinary: string | null
  newText: string | null
  newBinary: string | null
  binary: boolean
  operation: GithubDraftOperation
  /** Destination path for rename/move. Identity stays on the source path. */
  newPath?: string | null
  conflict?: GithubDraftConflict | null
  editVersion: number
  updatedAt: number
}

export interface GithubPanelLayout {
  leftView: 'files' | 'changes' | 'history'
  navWidthPx: number
  editorView: 'source' | 'preview' | 'diff'
  diffLayout: 'side_by_side' | 'inline'
}

export const DEFAULT_GITHUB_PANEL: GithubPanelLayout = {
  leftView: 'files',
  navWidthPx: 240,
  editorView: 'source',
  diffLayout: 'side_by_side',
}

export const GITHUB_EMPTY_DIRECTORY_NOTE =
  'Git does not store empty directories. An empty listing is not a saved folder.'

export interface GithubBranchWorkspace {
  id: string
  accountId: string
  repoId: string
  ref: string
  openPaths: string[]
  selectedPath: string | null
  panel: GithubPanelLayout
  updatedAt: number
}

export interface GithubAccountWorkspace {
  id: string
  accountId: string
  openRepoIds: string[]
  activeRepoId: string | null
  activeRefByRepo: Record<string, string>
  updatedAt: number
}

export interface DraftDeletionRequest {
  confirm: true
  accountId: string
  repoId?: string
  ref?: string
  path?: string
}

export interface SaveDraftInput {
  repoId: string
  ref: string
  path: string
  baseCommitSha: string
  baseBlobSha: string | null
  originalText: string | null
  originalBinary: string | null
  newText?: string | null
  newBinary?: string | null
  binary: boolean
  operation?: GithubDraftOperation
  newPath?: string | null
  conflict?: GithubDraftConflict | null
  /** When set, the write is refused if the stored editVersion does not match. */
  expectedEditVersion?: number
  /** Explicit conflict resolution only. Refresh must not set this. */
  retargetBase?: boolean
}

export interface GithubHydration {
  connection: GithubConnection
  drafts: GithubDraft[]
  accountWorkspace: GithubAccountWorkspace | null
}

export interface PrivateCacheRead {
  status: 'available' | 'sealed' | 'missing'
  value: unknown
}

export interface GithubTransportRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: string
  /** Pack bytes are base64 so a binary body is not mistaken for a JSON credential. */
  bodyEncoding?: 'utf8' | 'base64'
  auth: 'none' | 'bearer'
  timeoutMs: number
  /** JS write generation captured before the native send. Stale writes are not sent. */
  callerEpoch?: number
  authorityToken?: string
}

export interface GithubTransportResponse {
  status: number
  headers: Record<string, string>
  bodyText: string
  /** Raw authenticated bytes. Required for image/PDF downloads; never a text conversion. */
  bodyBase64?: string
}

export interface GithubTransport {
  request(input: GithubTransportRequest, signal: AbortSignal): Promise<GithubTransportResponse>
}

export interface GithubSecureStore {
  has(account: string): Promise<boolean>
  /** Test and future native-HTTP paths only. Production desktop get refuses to copy a token into the webview. */
  get(account: string): Promise<string | null>
  set(account: string, value: string): Promise<void>
  delete(account: string): Promise<void>
}

export interface GithubClock {
  now(): number
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

export type GithubTreeIndicator = 'added' | 'modified' | 'deleted' | 'renamed'

export interface GithubTreeMark {
  path: string
  indicator: GithubTreeIndicator
}

export interface GithubCommitSummary {
  sha: string
  message: string
  date: string | null
}

export interface GithubCommitDetail extends GithubCommitSummary {
  parents: string[]
  files: Array<{ path: string; status: string | null; sha: string | null }>
}

export interface GithubSearchMatch {
  path: string
  source: 'remote' | 'draft'
  line: number | null
  preview: string
}

export interface GithubSearchProgress {
  scannedBlobs: number
  skippedBySize: number
  skippedUnsupported: number
  draftCount: number
  treeTruncated: boolean
  fetchCapReached: boolean
  rateLimited: boolean
}

export interface GithubSearchResult {
  items: GithubSearchMatch[]
  complete: boolean
  progress: GithubSearchProgress
  message: string | null
  error: GithubPage<never>['error']
}

export interface RemoteRefresh {
  repoId: string
  ref: string
  remoteCommitSha: string | null
  remoteMessage: string | null
  protected: boolean
  empty: boolean
  draftsStale: boolean
  baseChanged: false
  conflicts: GithubDraft[]
}

export interface CommitConfirmation {
  confirm: true
  accountId: string
  repoId: string
  ref: string
  expectedBaseSha: string
  sentMessage: string
  commitId: string
  draftVersions: Array<{ path: string; editVersion: number }>
}

export type CommitResult =
  | {
    status: 'sent'
    protocol: 'git_data' | 'contents_bootstrap' | 'receive_pack'
    commitSha: string
    ref: string
    sentMessage: string
    clearedPaths: string[]
    keptPaths: string[]
  }
  | { status: 'blocked'; code: GithubErrorCode; message: string; retryAfterMs?: number }
  | { status: 'conflict'; remoteSha: string | null; message: string }
  | { status: 'protected_branch'; message: string }
  | { status: 'ambiguous'; message: string }
  | { status: 'not_applied'; message: string }
  | { status: 'stale_target'; message: string }

export interface DirectoryStageResult {
  persisted: boolean
  note: string
  draft: GithubDraft | null
}

export type GithubAiPurpose = 'review_file' | 'review_diff' | 'suggest_commit_message' | 'edit_draft'

export interface GithubAiPreparation {
  purpose: GithubAiPurpose
  accountId: string
  repoId: string
  ref: string
  private: boolean
  blocked: boolean
  warning: string
  packet: string | null
  proposalId: string | null
}

export interface AiDraftProposal {
  id: string
  accountId: string
  repoId: string
  ref: string
  path: string
  baseEditVersion: number
  text: string
}

export const GITHUB_AI_RECALL_WARNING = 'Content already sent to a provider cannot be recalled.'

/**
 * Device-flow elevation scope. Space-delimited, as GitHub's device code
 * endpoint requires. `repo` stays; `delete_repo` is added only for permanent
 * deletion. No other scope is requested.
 */
export const GITHUB_ELEVATED_DELETE_SCOPE = 'repo delete_repo'

/**
 * GitHub's own scope text, checked 5 October 2026:
 * `repo` grants public and private repository access and also organization
 * resources the user can administer. This app still rejects organization
 * repositories. `delete_repo` grants deletion of adminable repositories and is
 * not part of sign-in.
 */
export const GITHUB_DELETE_SCOPE_NOTE =
  'repo is the minimum scope that can read personal private repositories. GitHub also applies it to organization resources the signed-in user can access; TABS still rejects organization repositories. delete_repo is requested only when permanently deleting a repository and lets the token delete repositories it can administer. It is not requested at sign-in.'

export const LOCAL_REPO_DISMISS_NOTE =
  'Closing a repository tab or removing it from the local list does not delete the GitHub repository.'

export const EMPTY_INITIAL_BRANCH_NOTE =
  'GitHub may advertise a default branch name before any branch exists. An empty repository has no branches until the first commit. README, gitignore, or license options set auto_init explicitly so GitHub creates that initial commit; they are not a hidden seed for a later editor commit.'

export const REPO_CREATE_FORM_SCHEMA = {
  name: { required: true, maxLength: 100, pattern: 'GitHub repository name' },
  description: { required: false, maxLength: 350 },
  visibility: { required: true, default: 'private', options: ['private', 'public'] },
  readme: { required: true, default: false },
  gitignoreTemplate: { required: false, catalog: 'listRepoTemplates' },
  licenseTemplate: { required: false, catalog: 'listRepoTemplates' },
} as const

export const REPO_DELETE_FORM_SCHEMA = {
  typedOwnerRepo: { required: true, mustEqual: 'owner/name' },
  separateFromFileDelete: true,
  localDismissIsNotRemoteDelete: true,
} as const

export interface RepoCreateForm {
  name: string
  description?: string | null
  visibility?: 'private' | 'public'
  readme?: boolean
  gitignoreTemplate?: string | null
  licenseTemplate?: string | null
}

export interface RepoTargetConfirmation {
  confirm: true
  accountId: string
  ownerLogin: string
  repoName: string
  aiDerived: boolean
  proposalId?: string | null
}

export interface RepoCreateInput {
  form: RepoCreateForm
  confirmation: RepoTargetConfirmation
}

export interface RepoReadback {
  id: string
  ownerLogin: string
  fullName: string
  private: boolean
  defaultBranch: string | null
  branchExists: boolean
  empty: boolean
}

export type RepoCreateResult =
  | {
    status: 'created'
    repo: GithubRepo
    readback: RepoReadback
    initialCommitRequested: boolean
    appliedToActive: false
    message: string
  }
  | { status: 'ambiguous'; message: string; appliedToActive: false }
  | { status: 'not_applied'; message: string; appliedToActive: false }
  | { status: 'blocked'; code: GithubErrorCode; message: string; appliedToActive: false }
  | { status: 'stale_target'; message: string; appliedToActive: false }
  | { status: 'mismatch'; code: 'target_mismatch'; message: string; appliedToActive: false }

export interface RepoDeleteSnapshot {
  accountId: string
  accountLogin: string
  ownerId: string
  ownerLogin: string
  repoId: string
  repoName: string
  fullName: string
  private: boolean
  grantedScopes: string[]
  permission: 'admin'
  capturedAt: number
}

export interface RepoDeleteConfirmation {
  confirm: true
  typedOwnerRepo: string
  snapshot: RepoDeleteSnapshot
  aiDerived: boolean
  proposalId?: string | null
}

export type RepoDeleteResult =
  | { status: 'deleted'; repoId: string; draftsRetained: true; cacheDestroyed: false; message: string }
  | { status: 'uncertain'; message: string; draftsRetained: true; cacheDestroyed: false }
  | { status: 'blocked'; code: GithubErrorCode; message: string; draftsRetained: true; cacheDestroyed: false }
  | { status: 'needs_scope'; requiredScopes: ['repo', 'delete_repo']; message: string; draftsRetained: true; cacheDestroyed: false }
  | { status: 'mismatch'; message: string; draftsRetained: true; cacheDestroyed: false }

export interface RepoTemplateCatalog {
  gitignore: string[]
  licenses: Array<{ key: string; name: string }>
  complete: boolean
  message: string | null
}

export interface RepoProposal {
  id: string
  kind: 'create' | 'delete'
  accountId: string
  ownerLogin: string
  repoName: string
  repoId: string | null
}

export interface DeviceLoginOpen {
  opened: boolean
  url: typeof GITHUB_VERIFICATION_URI
}
