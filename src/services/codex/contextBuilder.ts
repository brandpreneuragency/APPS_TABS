import type { Editor } from '@tiptap/react';
import type { Attachment } from '../../types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useClientStore } from '../../stores/clientStore';
import { useCrmStore } from '../../stores/crmStore';
import { useFormsStore } from '../../stores/formsStore';
import { useAIStore } from '../../stores/aiStore';
import { buildTaskAIContext } from '../taskAIContext';
import { buildSettingsAIContext } from '../../components/settings/settingsAIContext';
import type { SettingsSubTab } from '../../stores/uiStore';
import { getTaskInstructions, getWriterInstructions } from '../instructionFiles';
import { codexDesktopClient } from './desktopClient';
import { decodeDataUrlBytes, decodeDataUrlText } from '../../utils/fileData';
import { getFileCategory, isTextFile } from '../../utils/fileType';
import { codexSessionService } from './sessionService';
import { isGithubDocumentPath } from '../github/identity';
import type { CodexScope } from './sessionTypes';
import type { CodexPermissionProfile } from './types';

const MAX_CONTEXT = 64 * 1024;
const MAX_ATTACHMENT = 32 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;

export interface ScopeInput {
  appThreadId: string;
  mode: 'writer' | 'task';
  workspaceId?: string;
  taskId?: string;
  settingsTab?: string;
  selectedText?: string;
  selectionFrom?: number;
  selectionTo?: number;
  attachments?: Attachment[];
  editor?: Editor | null;
  model?: string;
  effort?: string;
  permissionProfile?: CodexPermissionProfile;
  /** Provider-neutral fallback directory for callers outside Codex. */
  fallbackWorkspaceRoot?: string;
}

export function boundedContext(sections: string[], limit = MAX_CONTEXT): string {
  const joined = sections.filter(Boolean).join('\n\n');
  if (joined.length <= limit) return joined;
  return `${joined.slice(0, Math.max(0, limit - 35))}\n[TABS context truncated at ${limit} chars]`;
}

export async function resolveScopeWorkspaceRoot(
  connectedRoot: string | undefined,
  fallbackRoot: string | undefined,
  codexDefault: () => Promise<string>,
): Promise<string> {
  return connectedRoot ?? fallbackRoot ?? codexDefault();
}

export async function attachmentContext(attachments: Attachment[], workspaceRoot: string): Promise<string[]> {
  const result: string[] = [];
  let imageCount = 0;
  let imageBytes = 0;
  for (const attachment of attachments.slice(0, 8)) {
    if (attachment.kind === 'folder') throw new Error('Folder attachments are not supported by this Codex build');
    if (attachment.kind === 'image') {
      if (!attachment.dataUrl || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(attachment.dataUrl)) {
        throw new Error(`${attachment.name} has an unsupported image format`);
      }
      const bytes = decodeDataUrlBytes(attachment.dataUrl);
      imageCount += 1;
      imageBytes += bytes.length;
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || imageCount > 4 || imageBytes > MAX_IMAGE_TOTAL_BYTES) {
        throw new Error('Image attachments exceed the Codex size or count limit');
      }
      result.push(`[IMAGE ATTACHMENT: ${attachment.name}]`);
      continue;
    }
    if (attachment.name.toLowerCase().endsWith('.docx')) {
      if (!attachment.dataUrl) throw new Error(`${attachment.name} must be attached from the file picker for text extraction`);
      const mammoth = await import('mammoth');
      const binary = decodeDataUrlBytes(attachment.dataUrl);
      const input = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function'
        ? { buffer: Buffer.from(binary) }
        : { arrayBuffer: binary.buffer.slice(binary.byteOffset,
          binary.byteOffset + binary.byteLength) as ArrayBuffer };
      const extracted = await mammoth.default.extractRawText(input);
      if (extracted.value.length > MAX_ATTACHMENT) throw new Error(`${attachment.name} exceeds the attachment context limit`);
      result.push(`[ATTACHMENT: ${attachment.name}]\n${extracted.value}`);
      continue;
    }
    const category = getFileCategory(attachment.name, attachment.mimeType);
    const textLike = category === 'text' || category === 'code' || isTextFile(attachment.name)
      || attachment.mimeType.startsWith('text/');
    if (!textLike) throw new Error(`${attachment.name} cannot be sent as a Codex attachment in this build`);
    let content: string;
    if (attachment.path) {
      content = await codexDesktopClient.readScopedTextFile(workspaceRoot, attachment.path);
    } else if (attachment.dataUrl) {
      content = decodeDataUrlText(attachment.dataUrl);
    } else {
      throw new Error(`${attachment.name} has no readable content`);
    }
    if (content.length > MAX_ATTACHMENT) throw new Error(`${attachment.name} exceeds the attachment context limit`);
    result.push(`[ATTACHMENT: ${attachment.name}]\n${content}`);
  }
  if (attachments.length > 8) throw new Error('Too many attachments for one Codex turn');
  return result;
}

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function captureCodexScope(input: ScopeInput): Promise<CodexScope> {
  const workspace = input.workspaceId
    ? useWorkspaceStore.getState().workspaces.find((row) => row.id === input.workspaceId)
    : undefined;
  const workspaceRoot = await resolveScopeWorkspaceRoot(workspace?.connectedFolders[0]?.path,
    input.fallbackWorkspaceRoot, () => codexSessionService.defaultWorkspace());
  if (input.permissionProfile === 'workspaceWrite' && !workspace?.connectedFolders[0]?.path) {
    throw new Error('Connect a workspace folder before enabling Codex file edits');
  }
  const ai = useAIStore.getState();
  const agent = ai.getActiveAgent();
  const sections: string[] = [];
  if (agent.systemPrompt.trim()) sections.push(`[PERSONA]\n${agent.systemPrompt.trim()}`);
  if (ai.systemInstructions.trim()) sections.push(`[TABS INSTRUCTIONS]\n${ai.systemInstructions.trim()}`);
  const fileInstructions = input.mode === 'task' ? await getTaskInstructions() : await getWriterInstructions();
  if (fileInstructions?.trim()) sections.push(`[WORKSPACE INSTRUCTIONS]\n${fileInstructions.trim()}`);
  if (input.selectedText) sections.push(`[SELECTED TEXT ${input.selectionFrom ?? '?'}..${input.selectionTo ?? '?'}]\n${input.selectedText}`);

  let document: CodexScope['document'];
  if (workspace?.currentFile && !isGithubDocumentPath(workspace.currentFile.path)) {
    const file = workspace.currentFile;
    const content = input.editor && !input.editor.isDestroyed
      ? JSON.stringify(input.editor.getJSON()) : file.content;
    document = {
      path: file.path, name: file.name, contentHash: await sha256(content),
      content: content.slice(0, MAX_CONTEXT), contentComplete: content.length <= MAX_CONTEXT,
      isDirty: file.isDirty || content !== file.content,
      workspaceRevision: workspace.updatedAt,
    };
    sections.push(`[ACTIVE DOCUMENT ${file.name}; path=${file.path}; unsaved=${document.isDirty}; sha256=${document.contentHash}]\n${document.content}`);
    if (content.length > MAX_CONTEXT) sections.push('[ACTIVE DOCUMENT CONTENT TRUNCATED]');
  }
  if (input.taskId) {
    const task = useTaskStore.getState().tasks.find((row) => row.id === input.taskId && !row.deletedAt);
    if (task) {
      await useTaskCommentStore.getState().loadComments(task.id);
      const comments = useTaskCommentStore.getState().getComments(task.id);
      const project = useProjectStore.getState().getProjectById(task.projectId);
      const client = project ? useClientStore.getState().getClientById(project.clientId) : undefined;
      sections.push(buildTaskAIContext(task, comments, { projectName: project?.name, clientName: client?.name }).text);
    } else if (input.taskId.startsWith('client:')) {
      const clientId = input.taskId.slice(7);
      const client = useClientStore.getState().getClientById(clientId);
      if (client) sections.push(`[CLIENT]\n${client.name} (id=${client.id})`);
    } else if (input.taskId.startsWith('project:')) {
      const projectId = input.taskId.slice(8);
      const project = useProjectStore.getState().getProjectById(projectId);
      if (project) sections.push(`[PROJECT]\n${project.name} (id=${project.id}, client=${project.clientId})`);
    }
  }
  if (input.settingsTab) sections.push(buildSettingsAIContext(input.settingsTab as SettingsSubTab));
  if (input.attachments?.length) sections.push(...await attachmentContext(input.attachments, workspaceRoot));
  return {
    appThreadId: input.appThreadId, mode: input.mode,
    workspaceId: input.workspaceId, taskId: input.taskId, settingsTab: input.settingsTab,
    projectId: (input.taskId && !input.taskId.includes(':')
      ? useTaskStore.getState().tasks.find((row) => row.id === input.taskId)?.projectId
      : undefined) ?? useTaskStore.getState().selectedProjectId ?? undefined,
    clientId: useTaskStore.getState().selectedClientId ?? undefined,
    crmSelection: {
      leadId: useCrmStore.getState().activeLeadId ?? undefined,
      contactId: useCrmStore.getState().activeContactId ?? undefined,
      companyId: useCrmStore.getState().activeCompanyId ?? undefined,
      dealId: useCrmStore.getState().activeDealId ?? undefined,
    },
    formsSelection: {
      formId: useFormsStore.getState().activeFormId ?? undefined,
      submissionId: useFormsStore.getState().activeSubmissionId ?? undefined,
    },
    workspaceRoot, hasConnectedFolder: Boolean(workspace?.connectedFolders[0]?.path),
    permissionProfile: input.permissionProfile ?? 'readOnly', model: input.model, effort: input.effort,
    agentId: agent.id, context: boundedContext(sections),
    selectedText: input.selectedText, selectionFrom: input.selectionFrom,
    selectionTo: input.selectionTo, attachments: input.attachments,
    document, capturedAt: Date.now(),
  };
}
