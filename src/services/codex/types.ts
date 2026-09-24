/** Version 1 contract shared with the Tauri Codex host. */
export type CodexErrorCode =
  | 'invalid_argument' | 'not_found' | 'unsupported_version' | 'auth_required'
  | 'incompatible_account' | 'incompatible_provider' | 'transport_closed'
  | 'timeout' | 'protocol_error' | 'stale_epoch' | 'stale_request'
  | 'busy' | 'internal';

export interface CodexHostError {
  code: CodexErrorCode;
  message: string;
}

export interface CodexDiscovery {
  executablePath: string;
  version: string;
  supported: boolean;
}

export interface CodexConnection {
  epoch: number;
  executablePath: string;
  version: string;
  workspaceRoot: string;
  authMode: 'chatgpt';
  modelProvider: 'openai';
}

export interface CodexLoginStart {
  epoch: number;
  loginId: string;
  authUrl: string;
}

export interface CodexModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  reasoningEfforts: string[];
}

export interface CodexNativeTurn {
  id: string;
  status: string;
  assistantItems: { id: string; text: string }[];
}

export type CodexPermissionProfile = 'readOnly' | 'workspaceWrite';
export type CodexApprovalPolicy = 'never' | 'on-request';

export interface CodexToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CodexThreadRequest {
  epoch: number;
  workspaceRoot: string;
  permissionProfile: CodexPermissionProfile;
  approvalPolicy: CodexApprovalPolicy;
  model?: string;
  tools: CodexToolSpec[];
}

export interface CodexTurnRequest {
  epoch: number;
  threadId: string;
  text: string;
  images?: string[];
  model?: string;
  effort?: string;
}

export type CodexRequestKind = 'fileChangeApproval' | 'commandApproval' | 'question' | 'businessTool';

export interface CodexPendingRequest {
  requestId: string;
  kind: CodexRequestKind;
  threadId: string;
  turnId: string;
  itemId?: string;
  callId?: string;
  toolName?: string;
  details: Record<string, unknown>;
}

export type CodexHostEvent =
  | { epoch: number; sequence: number; kind: 'status'; status: 'ready' | 'closed' | 'failed'; message?: string }
  | { epoch: number; sequence: number; kind: 'textDelta'; threadId: string; turnId: string; itemId: string; delta: string }
  | { epoch: number; sequence: number; kind: 'turnStatus'; threadId: string; turnId: string; status: string }
  | { epoch: number; sequence: number; kind: 'toolActivity'; threadId: string; turnId: string; itemId: string; itemType: string; status?: string; details: Record<string, unknown> }
  | { epoch: number; sequence: number; kind: 'request'; request: CodexPendingRequest }
  | { epoch: number; sequence: number; kind: 'diagnostic'; message: string };

export interface CodexReplay {
  events: CodexHostEvent[];
  latestSequence: number;
  gap: boolean;
}

export type CodexRequestReply =
  | { kind: 'fileChangeApproval' | 'commandApproval'; decision: 'accept' | 'decline' | 'cancel' }
  | { kind: 'question'; answers: Record<string, string[]> }
  | { kind: 'businessTool'; success: boolean; text: string };
