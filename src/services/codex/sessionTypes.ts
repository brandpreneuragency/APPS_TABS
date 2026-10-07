import type { Attachment, Task } from '../../types';
import type { GithubDispatchContext } from '../github/aiEgress';
import type { CodexHostEvent, CodexPendingRequest, CodexPermissionProfile } from './types';

export type CodexRunStatus =
  | 'queued' | 'starting' | 'running' | 'awaiting_approval' | 'awaiting_input'
  | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'recovery_required';

/** A snapshot taken when the user submits. Delayed callbacks never inspect the active view. */
export interface CodexScope {
  appThreadId: string;
  mode: 'writer' | 'task';
  workspaceId?: string;
  taskId?: string;
  projectId?: string;
  clientId?: string;
  crmSelection?: { leadId?: string; contactId?: string; companyId?: string; dealId?: string };
  formsSelection?: { formId?: string; submissionId?: string };
  settingsTab?: string;
  workspaceRoot: string;
  /** True only when the captured workspace has a user-connected folder. */
  hasConnectedFolder?: boolean;
  permissionProfile: CodexPermissionProfile;
  model?: string;
  effort?: string;
  agentId: string;
  context: string;
  selectedText?: string;
  selectionFrom?: number;
  selectionTo?: number;
  attachments?: Attachment[];
  /** Isolated GitHub request context; never inferred from a Docs workspace. */
  github?: GithubDispatchContext;
  document?: {
    path: string;
    name: string;
    contentHash: string;
    content: string;
    contentComplete?: boolean;
    isDirty: boolean;
    workspaceRevision: number;
  };
  capturedAt: number;
}

export interface CodexSessionRecord {
  appThreadId: string;
  nativeThreadId: string;
  workspaceRoot: string;
  binaryVersion: string;
  lastEpoch?: number;
  toolSchemaVersion: number;
  toolNames?: string[];
  permissionProfile?: CodexPermissionProfile;
  /** Persisted GitHub workspace this native session may resume. Absent sessions are not reused for GitHub. */
  githubWorkspaceId?: string;
  model?: string;
  effort?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodexRunRecord {
  runId: string;
  clientCommandId: string;
  appThreadId: string;
  nativeThreadId?: string;
  nativeTurnId?: string;
  executionEpoch?: number;
  status: CodexRunStatus;
  scope: CodexScope;
  userText: string;
  submittedText: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface CodexEventRecord {
  id: string;
  epoch: number;
  sequence: number;
  runId?: string;
  event: CodexHostEvent;
  createdAt: number;
}

export interface CodexPendingRecord {
  requestId: string;
  runId: string;
  epoch: number;
  request: CodexPendingRequest;
  status: 'pending' | 'answered' | 'invalidated';
  createdAt: number;
  updatedAt: number;
  invalidationReason?: string;
  proposal?: CodexBusinessProposal;
  decision?: 'approved' | 'rejected';
  decisionAt?: number;
}

/** Frozen at request time. A later view change never changes this target. */
export interface CodexBusinessProposal {
  operationId: string;
  toolName: string;
  argumentHash: string;
  proposalHash: string;
  arguments: Record<string, unknown>;
  targetIds: string[];
  expectedRevision?: string | number;
  before: unknown;
  after: unknown;
  summary: string;
  createdAt: number;
}

export interface CodexOperationReceipt {
  operationId: string;
  proposalHash: string;
  appThreadId: string;
  runId: string;
  domain: 'main' | 'crmForms';
  outcome: 'applied' | 'rejected' | 'conflict' | 'failed' | 'partial';
  affectedIds: string[];
  result: string;
  createdAt: number;
  sourceToolName?: string;
  undoOfOperationId?: string;
  undoneByOperationId?: string;
  projection?: 'pending' | 'complete' | 'failed';
  projectionError?: string;
  /** The exact approved DB state to project; retries must not mirror a later edit. */
  projectionTask?: Task;
  /** Approved before state for updates and deletion; guards an existing task mirror. */
  projectionPreviousTask?: Task;
}

/** Write-ahead record for a business edit that also changes editor or disk state. */
export interface CodexDocumentIntent {
  operationId: string;
  proposalHash: string;
  kind: 'editorEdit' | 'fileCreate';
  workspaceId: string;
  path: string;
  beforeHash?: string;
  afterHash: string;
  afterContent: string;
  nativeWriteConfirmed?: boolean;
  status: 'pending' | 'complete' | 'uncertain';
  createdAt: number;
}
