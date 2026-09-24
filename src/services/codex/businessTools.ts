import type { Task } from '../../types';
import { TASK_TITLE_MAX_LENGTH } from '../../types';
import i18n from '../../i18n';
import { crmFormsDb } from '../../data/crmFormsDb';
import { useCrmStore } from '../../stores/crmStore';
import { useFormsStore } from '../../stores/formsStore';
import { useTaskStore, syncCodexTaskProjection } from '../../stores/taskStore';
import { nameKey, sanitizeFsName } from '../../stores/taskTreeNames';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { editorRef } from '../../stores/editorRef';
import { isEditorFontSize } from '../../stores/editorFontSize';
import { db } from '../db';
import { assertSubtaskParent, assertTaskProjectChange, assertTaskSoftDelete } from '../taskRelations';
import { parseMarkdown, parseTxt, serialize } from '../fileFormat';
import { serializeDocx } from '../docxFormat';
import { codexDesktopClient } from './desktopClient';
import { blankForm } from '../formsService';
import { updateForm } from '../formsService';
import { addNote, createCompany, createDeal, linkTask, updateCompany, updateContact, updateDeal } from '../crmService';
import type { CRMCompany, CRMContact, CRMDeal } from '../../types/crm';
import type { CRMDealStage } from '../../types/crm';
import type { CodexPendingRequest, CodexToolSpec } from './types';
import type { CodexBusinessProposal, CodexOperationReceipt, CodexRunRecord, CodexScope } from './sessionTypes';

const MAX_ARGUMENTS = 32 * 1024;
const MAX_RESULT = 32 * 1024;
const taskStatuses = ['pending', 'in_progress', 'completed'] as const;
const importanceLevels = ['low', 'medium', 'high'] as const;
const dealStages: CRMDealStage[] = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'spam'];

function projectMirrorsOverlap(sourceName: string, targetName: string): boolean {
  return nameKey(sanitizeFsName(sourceName)) === nameKey(sanitizeFsName(targetName));
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: 'object', properties, required, additionalProperties: false });
const stringSchema = { type: 'string' };

const catalog: Record<string, CodexToolSpec> = {
  tabs_document_read_v1: { name: 'tabs_document_read_v1', description: 'Read the document captured when this turn began.',
    inputSchema: objectSchema({}) },
  tabs_documents_list_v1: { name: 'tabs_documents_list_v1', description: 'List bounded document names and paths inside the captured connected folder.',
    inputSchema: objectSchema({}) },
  tabs_document_replace_selection_v1: { name: 'tabs_document_replace_selection_v1',
    description: 'Propose replacing only the text selected when this turn began. Requires TABS approval and an unchanged editor revision.',
    inputSchema: objectSchema({ expectedContentHash: stringSchema, replacement: stringSchema },
      ['expectedContentHash', 'replacement']) },
  tabs_document_create_v1: { name: 'tabs_document_create_v1',
    description: 'Propose creating a new Markdown, text, or Word document in the captured connected folder. Never overwrites an existing file.',
    inputSchema: objectSchema({ fileName: stringSchema, content: stringSchema }, ['fileName', 'content']) },
  tabs_document_export_v1: { name: 'tabs_document_export_v1',
    description: 'Propose exporting the captured active editor content as a new Markdown, text, or Word file inside the connected folder. Never overwrites an existing file.',
    inputSchema: objectSchema({ fileName: stringSchema, expectedContentHash: stringSchema },
      ['fileName', 'expectedContentHash']) },
  tabs_tasks_list_v1: { name: 'tabs_tasks_list_v1', description: 'List tasks in the captured project and selected task comments.',
    inputSchema: objectSchema({}) },
  tabs_tasks_history_list_v1: { name: 'tabs_tasks_history_list_v1',
    description: 'List bounded, completed task changes in this conversation that may be undone.',
    inputSchema: objectSchema({}) },
  tabs_tasks_create_v1: { name: 'tabs_tasks_create_v1', description: 'Propose one task or one-level subtask in the captured project. Requires TABS approval.',
    inputSchema: objectSchema({ title: stringSchema, content: stringSchema, date: stringSchema,
      status: { type: 'string', enum: taskStatuses }, importance: { type: 'string', enum: importanceLevels },
      parentTaskId: stringSchema }, ['title']) },
  tabs_tasks_update_v1: { name: 'tabs_tasks_update_v1', description: 'Propose an update to a task in the captured project, including assignment to an existing project under the same client. Requires TABS approval.',
    inputSchema: objectSchema({ taskId: stringSchema, expectedUpdatedAt: { type: 'number' }, title: stringSchema,
      content: stringSchema, date: stringSchema, status: { type: 'string', enum: taskStatuses },
      importance: { type: 'string', enum: importanceLevels }, projectId: stringSchema },
      ['taskId', 'expectedUpdatedAt']) },
  tabs_tasks_comment_v1: { name: 'tabs_tasks_comment_v1', description: 'Propose a comment on a task in the captured project. Requires TABS approval.',
    inputSchema: objectSchema({ taskId: stringSchema, expectedUpdatedAt: { type: 'number' }, text: stringSchema },
      ['taskId', 'expectedUpdatedAt', 'text']) },
  tabs_tasks_soft_delete_v1: { name: 'tabs_tasks_soft_delete_v1', description: 'Propose moving a task to trash. Requires TABS approval.',
    inputSchema: objectSchema({ taskId: stringSchema, expectedUpdatedAt: { type: 'number' } },
      ['taskId', 'expectedUpdatedAt']) },
  tabs_tasks_undo_v1: { name: 'tabs_tasks_undo_v1',
    description: 'Propose undoing one completed task change from this conversation. Requires TABS approval and unchanged task state.',
    inputSchema: objectSchema({ operationId: stringSchema }, ['operationId']) },
  tabs_crm_read_v1: { name: 'tabs_crm_read_v1', description: 'Read a bounded list of CRM contacts, companies, or deals.',
    inputSchema: objectSchema({ entity: { type: 'string', enum: ['contacts', 'companies', 'deals'] } }, ['entity']) },
  tabs_crm_create_contact_v1: { name: 'tabs_crm_create_contact_v1', description: 'Propose one CRM contact. Requires TABS approval.',
    inputSchema: objectSchema({ firstName: stringSchema, lastName: stringSchema, email: stringSchema,
      companyId: stringSchema }, ['firstName', 'lastName']) },
  tabs_crm_create_company_v1: { name: 'tabs_crm_create_company_v1', description: 'Propose one CRM company. Requires TABS approval.',
    inputSchema: objectSchema({ name: stringSchema, website: stringSchema, industry: stringSchema,
      notes: stringSchema }, ['name']) },
  tabs_crm_create_deal_v1: { name: 'tabs_crm_create_deal_v1', description: 'Propose one CRM deal linked only to captured selections. Requires TABS approval.',
    inputSchema: objectSchema({ title: stringSchema, stage: { type: 'string', enum: dealStages },
      value: { type: 'number' }, currency: stringSchema, leadId: stringSchema,
      contactId: stringSchema, companyId: stringSchema }, ['title']) },
  tabs_crm_update_v1: { name: 'tabs_crm_update_v1', description: 'Propose a revision-checked change to the selected contact, company, or deal. Requires TABS approval.',
    inputSchema: objectSchema({ entity: { type: 'string', enum: ['contact', 'company', 'deal'] },
      id: stringSchema, expectedUpdatedAt: stringSchema, changes: { type: 'object' } },
      ['entity', 'id', 'expectedUpdatedAt', 'changes']) },
  tabs_crm_add_note_v1: { name: 'tabs_crm_add_note_v1', description: 'Propose a note on the selected CRM record. Requires TABS approval.',
    inputSchema: objectSchema({ entity: { type: 'string', enum: ['contact', 'company', 'deal'] },
      id: stringSchema, expectedUpdatedAt: stringSchema, body: stringSchema },
      ['entity', 'id', 'expectedUpdatedAt', 'body']) },
  tabs_crm_link_task_v1: { name: 'tabs_crm_link_task_v1', description: 'Propose linking a task from the captured project to the selected CRM record. Requires TABS approval.',
    inputSchema: objectSchema({ entity: { type: 'string', enum: ['contact', 'company', 'deal'] },
      id: stringSchema, expectedUpdatedAt: stringSchema, taskId: stringSchema },
      ['entity', 'id', 'expectedUpdatedAt', 'taskId']) },
  tabs_forms_read_v1: { name: 'tabs_forms_read_v1', description: 'Read local forms and submissions in the captured Forms view.',
    inputSchema: objectSchema({ entity: { type: 'string', enum: ['forms', 'submissions'] } }, ['entity']) },
  tabs_forms_create_draft_v1: { name: 'tabs_forms_create_draft_v1', description: 'Propose a new local draft form. Requires TABS approval.',
    inputSchema: objectSchema({ name: stringSchema }, ['name']) },
  tabs_forms_update_draft_v1: { name: 'tabs_forms_update_draft_v1', description: 'Propose text changes to the selected draft form. Requires TABS approval.',
    inputSchema: objectSchema({ formId: stringSchema, expectedUpdatedAt: stringSchema,
      name: stringSchema, description: stringSchema, successMessage: stringSchema },
    ['formId', 'expectedUpdatedAt']) },
  tabs_forms_follow_up_task_v1: { name: 'tabs_forms_follow_up_task_v1', description: 'Propose a task linked to the selected local form submission and its CRM result. Each database step has a receipt; partial completion is reported.',
    inputSchema: objectSchema({ submissionId: stringSchema, expectedFormUpdatedAt: stringSchema,
      taskTitle: stringSchema, taskContent: stringSchema },
      ['submissionId', 'expectedFormUpdatedAt', 'taskTitle']) },
  tabs_settings_read_v1: { name: 'tabs_settings_read_v1', description: 'Read allowlisted ordinary appearance settings, never secrets.',
    inputSchema: objectSchema({}) },
  tabs_settings_update_v1: { name: 'tabs_settings_update_v1', description: 'Propose an appearance preference. Requires TABS approval.',
    inputSchema: objectSchema({ key: { type: 'string', enum: ['editorFontSize', 'language'] },
      value: { anyOf: [{ type: 'number' }, { type: 'string' }] } }, ['key', 'value']) },
};

function taskProject(scope: CodexScope): string | undefined {
  if (scope.taskId?.startsWith('project:')) return scope.taskId.slice(8);
  return scope.projectId;
}

function isUndoableTaskTool(name: string | undefined): boolean {
  return name === 'tabs_tasks_create_v1' || name === 'tabs_tasks_update_v1'
    || name === 'tabs_tasks_soft_delete_v1';
}

async function assertUndoRelationship(source: CodexOperationReceipt, task: Task): Promise<void> {
  const activeChildCount = await db.tasks.where('parentTaskId').equals(task.id)
    .filter((child) => !child.deletedAt).count();
  if (source.sourceToolName === 'tabs_tasks_create_v1') {
    assertTaskSoftDelete(activeChildCount);
    return;
  }
  const before = source.projectionPreviousTask;
  if (!before) throw new Error('Original task state is unavailable for undo');
  if (before.parentTaskId) {
    assertSubtaskParent(await db.tasks.get(before.parentTaskId), before.projectId);
  }
  assertTaskProjectChange(task, before.projectId, activeChildCount);
  if (before.projectId !== task.projectId) {
    const [sourceProject, targetProject] = await Promise.all([
      db.projects.get(task.projectId), db.projects.get(before.projectId),
    ]);
    if (!sourceProject || !targetProject || sourceProject.clientId !== targetProject.clientId
      || projectMirrorsOverlap(sourceProject.name, targetProject.name)) {
      throw new Error('Original project assignment is no longer valid');
    }
  }
}

export function toolsForScope(scope: CodexScope): CodexToolSpec[] {
  const names: string[] = [];
  if (scope.mode === 'writer' && scope.document) names.push('tabs_document_read_v1');
  if (scope.mode === 'writer' && scope.hasConnectedFolder && scope.workspaceId) {
    names.push('tabs_documents_list_v1', 'tabs_document_create_v1');
    if (scope.document?.contentComplete && scope.workspaceId) names.push('tabs_document_export_v1');
  }
  if (scope.mode === 'writer' && scope.document?.contentComplete && scope.workspaceId
    && scope.selectedText && typeof scope.selectionFrom === 'number'
    && typeof scope.selectionTo === 'number') names.push('tabs_document_replace_selection_v1');
  if (scope.mode === 'task' && taskProject(scope)) {
    names.push('tabs_tasks_list_v1', 'tabs_tasks_history_list_v1', 'tabs_tasks_create_v1',
      'tabs_tasks_update_v1', 'tabs_tasks_comment_v1', 'tabs_tasks_soft_delete_v1', 'tabs_tasks_undo_v1');
  }
  if (scope.taskId?.startsWith('page:') && scope.taskId !== 'page:forms') {
    names.push('tabs_crm_read_v1', 'tabs_crm_create_contact_v1',
      'tabs_crm_create_company_v1', 'tabs_crm_create_deal_v1');
    if (scope.crmSelection && Object.values(scope.crmSelection).some(Boolean)) {
      names.push('tabs_crm_update_v1', 'tabs_crm_add_note_v1');
      if (scope.projectId) names.push('tabs_crm_link_task_v1');
    }
  }
  if (scope.taskId === 'page:forms') {
    names.push('tabs_forms_read_v1', 'tabs_forms_create_draft_v1');
    if (scope.formsSelection?.formId) names.push('tabs_forms_update_draft_v1');
    if (scope.formsSelection?.formId && scope.formsSelection.submissionId && scope.projectId) {
      names.push('tabs_forms_follow_up_task_v1');
    }
  }
  if (scope.settingsTab) {
    names.push('tabs_settings_read_v1');
    if (scope.settingsTab === 'appearance') names.push('tabs_settings_update_v1');
  }
  return names.map((name) => catalog[name]);
}

function argsFor(request: CodexPendingRequest): Record<string, unknown> {
  const args = request.details.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || JSON.stringify(args).length > MAX_ARGUMENTS) throw new Error('Invalid business tool arguments');
  return args as Record<string, unknown>;
}

function exactKeys(args: Record<string, unknown>, keys: string[]): void {
  const unknown = Object.keys(args).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`Unsupported argument: ${unknown}`);
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw new Error(`${label} must be 1–${limit} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, limit: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function isoDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error('Invalid task date');
  return value;
}

function plainEditorContent(value: unknown): string | undefined {
  const text = optionalText(value, 'content', 16 * 1024);
  if (text === undefined) return undefined;
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [] }] });
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', value as BufferSource);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Bytes(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    encoded += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(encoded);
}

function documentFileName(value: unknown): { name: string; extension: 'md' | 'markdown' | 'txt' | 'docx' } {
  if (typeof value !== 'string' || !value || value.length > 120
    || value.startsWith('.') || /[\\/:*?"<>|]/.test(value)
    || Array.from(value).some((character) => character.charCodeAt(0) < 32)
    || /[. ]$/.test(value)) throw new Error('Invalid document file name');
  const extension = value.split('.').pop()?.toLowerCase();
  if (extension !== 'md' && extension !== 'markdown' && extension !== 'txt' && extension !== 'docx') {
    throw new Error('Unsupported document format');
  }
  return { name: value, extension };
}

function assertActiveConnectedFolder(scope: CodexScope): void {
  const state = useWorkspaceStore.getState();
  const workspace = state.workspaces.find((item) => item.id === scope.workspaceId);
  if (!scope.hasConnectedFolder || !scope.workspaceId
    || state.activeWorkspaceId !== scope.workspaceId
    || workspace?.connectedFolders[0]?.path !== scope.workspaceRoot) {
    throw new Error('Captured connected folder is no longer active');
  }
}

async function editorFileBytes(content: object, extension: 'md' | 'markdown' | 'txt' | 'docx') {
  return extension === 'docx' ? serializeDocx(content)
    : new TextEncoder().encode(serialize(content, extension));
}

function limitedResult(value: unknown): string {
  const result = JSON.stringify(value);
  if (result.length > MAX_RESULT) throw new Error('Business tool result exceeds limit');
  return result;
}

function assertRequest(run: CodexRunRecord, request: CodexPendingRequest): string {
  if (request.kind !== 'businessTool' || !request.toolName || !request.callId
    || request.threadId !== run.nativeThreadId || request.turnId !== run.nativeTurnId
    || !toolsForScope(run.scope).some((tool) => tool.name === request.toolName)) {
    throw new Error('Business tool is outside the captured turn and scope');
  }
  return request.toolName;
}

type CrmTarget = { entity: 'contact' | 'company' | 'deal'; id: string;
  record: CRMContact | CRMCompany | CRMDeal };

async function selectedCrmTarget(scope: CodexScope, entity: unknown, value: unknown): Promise<CrmTarget> {
  const id = requiredText(value, 'CRM ID', 128);
  if (entity === 'contact') {
    if (id !== scope.crmSelection?.contactId) throw new Error('Contact is outside the captured selection');
    const record = await crmFormsDb.crmContacts.get(id);
    if (!record) throw new Error('Selected contact is unavailable');
    return { entity, id, record };
  }
  if (entity === 'company') {
    if (id !== scope.crmSelection?.companyId) throw new Error('Company is outside the captured selection');
    const record = await crmFormsDb.crmCompanies.get(id);
    if (!record) throw new Error('Selected company is unavailable');
    return { entity, id, record };
  }
  if (entity === 'deal') {
    if (id !== scope.crmSelection?.dealId) throw new Error('Deal is outside the captured selection');
    const record = await crmFormsDb.crmDeals.get(id);
    if (!record) throw new Error('Selected deal is unavailable');
    return { entity, id, record };
  }
  throw new Error('Unsupported CRM target');
}

function crmChanges(entity: CrmTarget['entity'], value: unknown): Record<string, string | number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CRM changes');
  const changes = value as Record<string, unknown>;
  const allowed = entity === 'contact'
    ? ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'lifecycleStatus', 'notes']
    : entity === 'company'
      ? ['name', 'website', 'industry', 'size', 'city', 'country', 'notes']
      : ['title', 'stage', 'value', 'probability', 'expectedCloseDate'];
  exactKeys(changes, allowed);
  if (!Object.keys(changes).length) throw new Error('No CRM changes proposed');
  const result: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(changes)) {
    if (key === 'value' || key === 'probability') {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0
        || (key === 'probability' && raw > 100)) throw new Error(`Invalid ${key}`);
      result[key] = raw;
    } else if (key === 'stage') {
      if (!dealStages.includes(raw as CRMDealStage)) throw new Error('Invalid deal stage');
      result[key] = raw as string;
    } else if (key === 'expectedCloseDate') {
      result[key] = isoDate(raw) ?? '';
    } else {
      result[key] = key === 'firstName' || key === 'lastName' || key === 'name' || key === 'title'
        ? requiredText(raw, key, 160) : optionalText(raw, key, key === 'notes' ? 8 * 1024 : 512) ?? '';
      if ((key === 'email') && result[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result[key]))) {
        throw new Error('Invalid contact email');
      }
      if (key === 'website' && result[key] && !/^https?:\/\//i.test(String(result[key]))) {
        throw new Error('Company website must use HTTP or HTTPS');
      }
    }
  }
  return result;
}

export function isReadTool(name: string): boolean {
  return name.endsWith('_read_v1') || name.endsWith('_list_v1');
}

export async function readBusinessTool(run: CodexRunRecord, request: CodexPendingRequest): Promise<string> {
  const name = assertRequest(run, request);
  if (!isReadTool(name)) throw new Error('The tool requires a proposal');
  const args = argsFor(request);
  if (name === 'tabs_document_read_v1') {
    exactKeys(args, []);
    return limitedResult(run.scope.document);
  }
  if (name === 'tabs_documents_list_v1') {
    exactKeys(args, []);
    assertActiveConnectedFolder(run.scope);
    return limitedResult({ workspaceRoot: run.scope.workspaceRoot,
      documents: await codexDesktopClient.listScopedDocuments(run.scope.workspaceRoot) });
  }
  if (name === 'tabs_tasks_list_v1') {
    exactKeys(args, []);
    const projectId = taskProject(run.scope);
    if (!projectId) throw new Error('No captured project');
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Captured project is unavailable');
    const tasks = await db.tasks.where('projectId').equals(projectId).filter((task) => !task.deletedAt).limit(50).toArray();
    const projects = await db.projects.where('clientId').equals(project.clientId).limit(50).toArray();
    const comments = run.scope.taskId && !run.scope.taskId.includes(':')
      ? await db.taskComments.where('taskId').equals(run.scope.taskId).limit(50).toArray() : [];
    return limitedResult({ projectId, clientId: project.clientId, projects, tasks, comments });
  }
  if (name === 'tabs_tasks_history_list_v1') {
    exactKeys(args, []);
    const projectId = taskProject(run.scope);
    const rows = await db.codexOperationReceipts.where('appThreadId').equals(run.appThreadId)
      .reverse().limit(50).toArray();
    const eligible = rows.filter((row) => row.projection === 'complete'
      && !row.undoneByOperationId && isUndoableTaskTool(row.sourceToolName)
      && (row.sourceToolName === 'tabs_tasks_create_v1' || row.projectionPreviousTask)
      && row.projectionTask && (row.projectionTask.projectId === projectId
        || row.projectionPreviousTask?.projectId === projectId)).slice(0, 20);
    const current = await Promise.all(eligible.map((row) => db.tasks.get(row.affectedIds[0])));
    return limitedResult(eligible.filter((row, index) => JSON.stringify(current[index]) === JSON.stringify(row.projectionTask))
      .map((row) => ({ operationId: row.operationId,
      taskId: row.affectedIds[0], toolName: row.sourceToolName,
      title: row.projectionTask?.title, createdAt: row.createdAt })));
  }
  if (name === 'tabs_crm_read_v1') {
    exactKeys(args, ['entity']);
    if (args.entity === 'contacts') return limitedResult(await crmFormsDb.crmContacts.limit(50).toArray());
    if (args.entity === 'companies') return limitedResult(await crmFormsDb.crmCompanies.limit(50).toArray());
    if (args.entity === 'deals') return limitedResult(await crmFormsDb.crmDeals.limit(50).toArray());
    throw new Error('Unknown CRM entity');
  }
  if (name === 'tabs_forms_read_v1') {
    exactKeys(args, ['entity']);
    if (args.entity === 'forms') return limitedResult(await crmFormsDb.forms.limit(50).toArray());
    if (args.entity === 'submissions') {
      const formId = run.scope.formsSelection?.formId;
      if (!formId) throw new Error('Select a form before reading submissions');
      return limitedResult(await crmFormsDb.formSubmissions.where('formId').equals(formId).limit(50).toArray());
    }
    throw new Error('Unknown Forms entity');
  }
  if (name === 'tabs_settings_read_v1') {
    exactKeys(args, []);
    const [font, language] = await Promise.all([db.settings.get('editorFontSize'), db.settings.get('language')]);
    return limitedResult({ editorFontSize: font?.value ?? 12, language: language?.value ?? 'en' });
  }
  throw new Error('Unsupported read tool');
}

export async function prepareBusinessProposal(run: CodexRunRecord, request: CodexPendingRequest): Promise<CodexBusinessProposal> {
  const toolName = assertRequest(run, request);
  if (isReadTool(toolName)) throw new Error('Read tools cannot create proposals');
  const args = argsFor(request);
  const operationId = `codex:${run.runId}:${request.callId}`;
  const argumentHash = await sha256(JSON.stringify(args));
  const delivered = await db.codexPendingRequests.where('runId').equals(run.runId)
    .filter((item) => item.proposal?.operationId === operationId).first();
  if (delivered?.proposal) {
    await verifyBusinessProposal(run, request, delivered.proposal);
    return delivered.proposal;
  }
  let targetIds: string[] = [];
  let expectedRevision: string | number | undefined;
  let before: unknown = null;
  let after: unknown;
  let summary: string;

  if (toolName === 'tabs_document_replace_selection_v1') {
    exactKeys(args, ['expectedContentHash', 'replacement']);
    const document = run.scope.document;
    const workspaceId = run.scope.workspaceId;
    const from = run.scope.selectionFrom;
    const to = run.scope.selectionTo;
    if (!document || !workspaceId || typeof from !== 'number' || typeof to !== 'number'
      || args.expectedContentHash !== document.contentHash) throw new Error('Document revision changed');
    const replacement = args.replacement;
    if (typeof replacement !== 'string' || replacement.length > 16 * 1024) {
      throw new Error('Invalid replacement');
    }
    const editor = selectedEditor(run.scope);
    const currentContent = JSON.stringify(editor.getJSON());
    if (await sha256(currentContent) !== document.contentHash) throw new Error('Document revision changed');
    if (from < 1 || to <= from || to > editor.state.doc.content.size
      || !editor.state.doc.resolve(from).sameParent(editor.state.doc.resolve(to))
      || editor.state.doc.textBetween(from, to) !== run.scope.selectedText) {
      throw new Error('Captured document selection changed');
    }
    const nextContent = JSON.stringify(editor.state.tr.insertText(replacement, from, to).doc.toJSON());
    targetIds = [workspaceId, document.path];
    expectedRevision = document.contentHash;
    before = { path: document.path, contentHash: document.contentHash,
      selection: run.scope.selectedText };
    after = { workspaceId, path: document.path, from, to, replacement,
      contentHash: await sha256(nextContent) };
    summary = i18n.t('codex.documentReplaceSelection', {
      name: document.name, selected: run.scope.selectedText.slice(0, 120),
      replacement: replacement.slice(0, 120),
    });
  } else if (toolName === 'tabs_document_create_v1' || toolName === 'tabs_document_export_v1') {
    exactKeys(args, toolName === 'tabs_document_create_v1'
      ? ['fileName', 'content'] : ['fileName', 'expectedContentHash']);
    assertActiveConnectedFolder(run.scope);
    const { name, extension } = documentFileName(args.fileName);
    if (await codexDesktopClient.scopedDocumentHash(run.scope.workspaceRoot, name) !== null) {
      throw new Error('Document destination already exists');
    }
    let editorJson: object;
    let sourceHash: string | undefined;
    if (toolName === 'tabs_document_create_v1') {
      if (typeof args.content !== 'string' || args.content.length > 16 * 1024) {
        throw new Error('Invalid document content');
      }
      editorJson = extension === 'txt' ? parseTxt(args.content) : parseMarkdown(args.content);
    } else {
      const document = run.scope.document;
      if (!document?.contentComplete || args.expectedContentHash !== document.contentHash) {
        throw new Error('Document revision changed');
      }
      const editor = selectedEditor(run.scope);
      if (await sha256(JSON.stringify(editor.getJSON())) !== document.contentHash) {
        throw new Error('Document revision changed');
      }
      editorJson = JSON.parse(document.content) as object;
      sourceHash = document.contentHash;
    }
    const bytes = await editorFileBytes(editorJson, extension);
    if (bytes.length > 256 * 1024) throw new Error('Document export exceeds size limit');
    const path = `${run.scope.workspaceRoot.replace(/[\\/]+$/, '')}/${name}`;
    targetIds = [path];
    before = { destinationExists: false, sourceHash };
    after = { workspaceId: run.scope.workspaceId, fileName: name, path,
      size: bytes.length, contentHash: await sha256Bytes(bytes), sourceHash,
      preview: toolName === 'tabs_document_create_v1'
        ? (args.content as string).slice(0, 500) : serialize(editorJson, 'txt').slice(0, 500) };
    expectedRevision = sourceHash;
    summary = i18n.t(toolName === 'tabs_document_create_v1'
      ? 'codex.documentCreate' : 'codex.documentExport', { name });
  } else if (toolName === 'tabs_tasks_create_v1') {
    exactKeys(args, ['title', 'content', 'date', 'status', 'importance', 'parentTaskId']);
    const projectId = taskProject(run.scope);
    const project = projectId ? await db.projects.get(projectId) : undefined;
    if (!project) throw new Error('Captured project is unavailable');
    const title = requiredText(args.title, 'Task title', TASK_TITLE_MAX_LENGTH);
    const content = plainEditorContent(args.content) ?? '';
    const date = isoDate(args.date) ?? new Date(run.scope.capturedAt).toISOString().slice(0, 10);
    const status = args.status ?? 'pending';
    const importance = args.importance ?? 'medium';
    if (!taskStatuses.includes(status as typeof taskStatuses[number])
      || !importanceLevels.includes(importance as typeof importanceLevels[number])) throw new Error('Invalid task state');
    const parentTaskId = args.parentTaskId === undefined
      ? undefined : requiredText(args.parentTaskId, 'Parent task ID', 128);
    const parent = parentTaskId ? await db.tasks.get(parentTaskId) : undefined;
    if (parentTaskId) assertSubtaskParent(parent, project.id);
    targetIds = parentTaskId ? [project.id, parentTaskId] : [project.id];
    before = parent ? { project, parent } : project;
    after = { title, content, date, status, importance, projectId: project.id, parentTaskId };
    summary = parent ? i18n.t('codex.createSubtask', { task: title, parent: parent.title })
      : `Create task “${title}” in the selected project`;
  } else if (toolName === 'tabs_tasks_update_v1' || toolName === 'tabs_tasks_comment_v1'
    || toolName === 'tabs_tasks_soft_delete_v1') {
    if (toolName === 'tabs_tasks_comment_v1') exactKeys(args, ['taskId', 'expectedUpdatedAt', 'text']);
    else if (toolName === 'tabs_tasks_soft_delete_v1') exactKeys(args, ['taskId', 'expectedUpdatedAt']);
    else {
    exactKeys(args, ['taskId', 'expectedUpdatedAt', 'title', 'content', 'date', 'status', 'importance', 'projectId']);
    }
    const taskId = requiredText(args.taskId, 'Task ID', 128);
    const task = await db.tasks.get(taskId);
    if (!task || task.deletedAt || task.projectId !== taskProject(run.scope)) throw new Error('Task is outside the captured project');
    if (typeof args.expectedUpdatedAt !== 'number' || args.expectedUpdatedAt !== task.updatedAt) throw new Error('Task revision changed');
    if (toolName === 'tabs_tasks_comment_v1') {
      const text = requiredText(args.text, 'Comment', 8 * 1024);
      targetIds = [taskId]; expectedRevision = task.updatedAt; before = task;
      after = { taskId, text };
      summary = `Comment on task “${task.title}”`;
    } else if (toolName === 'tabs_tasks_soft_delete_v1') {
      assertTaskSoftDelete(await db.tasks.where('parentTaskId').equals(task.id)
        .filter((child) => !child.deletedAt).count());
      targetIds = [taskId]; expectedRevision = task.updatedAt; before = task;
      after = { ...task, deletedAt: 'approval-time' };
      summary = `Move task “${task.title}” to trash`;
    } else {
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = requiredText(args.title, 'Task title', TASK_TITLE_MAX_LENGTH);
    if (args.content !== undefined) patch.content = plainEditorContent(args.content);
    if (args.date !== undefined) patch.date = isoDate(args.date);
    if (args.status !== undefined) {
      if (!taskStatuses.includes(args.status as typeof taskStatuses[number])) throw new Error('Invalid task status');
      patch.status = args.status;
    }
    if (args.importance !== undefined) {
      if (!importanceLevels.includes(args.importance as typeof importanceLevels[number])) throw new Error('Invalid importance');
      patch.importance = args.importance;
    }
    let targetProjectName: string | undefined;
    if (args.projectId !== undefined) {
      const projectId = requiredText(args.projectId, 'Project ID', 128);
      const [sourceProject, targetProject] = await Promise.all([
        db.projects.get(task.projectId), db.projects.get(projectId),
      ]);
      if (!sourceProject || !targetProject || sourceProject.clientId !== targetProject.clientId) {
        throw new Error('Project assignment is outside the task client');
      }
      if (projectId !== task.projectId) {
        assertTaskProjectChange(task, projectId, await db.tasks.where('parentTaskId').equals(task.id)
          .filter((child) => !child.deletedAt).count());
        if (projectMirrorsOverlap(sourceProject.name, targetProject.name)) {
          throw new Error('Project assignment would overlap the existing task mirror');
        }
        patch.projectId = projectId;
        targetProjectName = targetProject.name;
      }
    }
    if (!Object.keys(patch).length) throw new Error('No task changes proposed');
    targetIds = targetProjectName ? [taskId, patch.projectId as string] : [taskId];
    expectedRevision = task.updatedAt; before = task;
    after = { ...task, ...patch };
    summary = targetProjectName
      ? i18n.t('codex.taskAssignProject', { task: task.title, project: targetProjectName })
      : `Update task “${task.title}”`;
    }
  } else if (toolName === 'tabs_tasks_undo_v1') {
    exactKeys(args, ['operationId']);
    const sourceOperationId = requiredText(args.operationId, 'Operation ID', 256);
    const source = await db.codexOperationReceipts.get(sourceOperationId);
    if (!source || source.appThreadId !== run.appThreadId || source.projection !== 'complete'
      || source.undoneByOperationId || !isUndoableTaskTool(source.sourceToolName)
      || !source.projectionTask) throw new Error('Task change is unavailable for undo');
    const task = await db.tasks.get(source.affectedIds[0]);
    if (!task || JSON.stringify(task) !== JSON.stringify(source.projectionTask)) {
      throw new Error('Task changed after the original operation');
    }
    const projectId = taskProject(run.scope);
    if (projectId !== task.projectId && projectId !== source.projectionPreviousTask?.projectId) {
      throw new Error('Task change is outside the captured project');
    }
    await assertUndoRelationship(source, task);
    targetIds = [task.id, sourceOperationId]; expectedRevision = task.updatedAt;
    before = task;
    after = source.sourceToolName === 'tabs_tasks_create_v1'
      ? { ...task, deletedAt: 'approval-time' }
      : { ...source.projectionPreviousTask, updatedAt: 'approval-time' };
    summary = i18n.t('codex.undoTaskChange', { task: task.title });
  } else if (toolName === 'tabs_crm_create_contact_v1') {
    exactKeys(args, ['firstName', 'lastName', 'email', 'companyId']);
    const firstName = requiredText(args.firstName, 'First name', 120);
    const lastName = requiredText(args.lastName, 'Last name', 120);
    const email = optionalText(args.email, 'email', 256);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid contact email');
    if (email && await crmFormsDb.crmContacts.where('email').equalsIgnoreCase(email).first()) {
      throw new Error('Contact email already exists');
    }
    const companyId = optionalText(args.companyId, 'company ID', 128);
    const company = companyId ? await crmFormsDb.crmCompanies.get(companyId) : undefined;
    if (companyId && (companyId !== run.scope.crmSelection?.companyId || !company)) {
      throw new Error('Company is outside the captured CRM selection');
    }
    targetIds = companyId ? [companyId] : []; before = company ?? null;
    after = { firstName, lastName, email, companyId };
    summary = `Create contact “${firstName} ${lastName}”`;
  } else if (toolName === 'tabs_crm_create_company_v1') {
    exactKeys(args, ['name', 'website', 'industry', 'notes']);
    const name = requiredText(args.name, 'Company name', 160);
    if (await crmFormsDb.crmCompanies.where('name').equalsIgnoreCase(name).first()) {
      throw new Error('Company name already exists');
    }
    const website = optionalText(args.website, 'website', 512);
    if (website && !/^https?:\/\//i.test(website)) throw new Error('Company website must use HTTP or HTTPS');
    after = { name, website, industry: optionalText(args.industry, 'industry', 160),
      notes: optionalText(args.notes, 'notes', 8 * 1024) };
    summary = `Create company “${name}”`;
  } else if (toolName === 'tabs_crm_create_deal_v1') {
    exactKeys(args, ['title', 'stage', 'value', 'currency', 'leadId', 'contactId', 'companyId']);
    const title = requiredText(args.title, 'Deal title', 160);
    const stage = args.stage ?? 'new';
    if (!dealStages.includes(stage as CRMDealStage)) throw new Error('Invalid deal stage');
    if (args.value !== undefined && (typeof args.value !== 'number' || !Number.isFinite(args.value)
      || args.value < 0)) throw new Error('Invalid deal value');
    const currency = optionalText(args.currency, 'currency', 3) ?? 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code');
    const links: Record<'leadId' | 'contactId' | 'companyId', string | undefined> = {
      leadId: optionalText(args.leadId, 'lead ID', 128),
      contactId: optionalText(args.contactId, 'contact ID', 128),
      companyId: optionalText(args.companyId, 'company ID', 128),
    };
    const linkedSnapshots: unknown[] = [];
    for (const [key, id] of Object.entries(links)) {
      if (!id) continue;
      if (id !== run.scope.crmSelection?.[key as keyof typeof links]) throw new Error('Deal link is outside the captured selection');
      const table = key === 'leadId' ? crmFormsDb.crmLeads
        : key === 'contactId' ? crmFormsDb.crmContacts : crmFormsDb.crmCompanies;
      const linked = await table.get(id);
      if (!linked) throw new Error('Selected CRM link no longer exists');
      linkedSnapshots.push(linked);
    }
    targetIds = Object.values(links).filter((id): id is string => !!id);
    before = linkedSnapshots;
    after = { title, stage, value: args.value, currency, ...links };
    summary = `Create deal “${title}”`;
  } else if (toolName === 'tabs_crm_update_v1' || toolName === 'tabs_crm_add_note_v1'
    || toolName === 'tabs_crm_link_task_v1') {
    exactKeys(args, toolName === 'tabs_crm_update_v1'
      ? ['entity', 'id', 'expectedUpdatedAt', 'changes']
      : toolName === 'tabs_crm_add_note_v1'
        ? ['entity', 'id', 'expectedUpdatedAt', 'body']
        : ['entity', 'id', 'expectedUpdatedAt', 'taskId']);
    const target = await selectedCrmTarget(run.scope, args.entity, args.id);
    if (args.expectedUpdatedAt !== target.record.updatedAt) throw new Error('CRM revision changed');
    targetIds = [target.id]; expectedRevision = target.record.updatedAt; before = target.record;
    if (toolName === 'tabs_crm_update_v1') {
      const patch = crmChanges(target.entity, args.changes);
      after = { ...target.record, ...patch };
      summary = `Update selected ${target.entity}`;
    } else if (toolName === 'tabs_crm_add_note_v1') {
      after = { entity: target.entity, id: target.id, body: requiredText(args.body, 'Note', 8 * 1024) };
      summary = `Add note to selected ${target.entity}`;
    } else {
      const taskId = requiredText(args.taskId, 'Task ID', 128);
      const task = await db.tasks.get(taskId);
      if (!task || task.deletedAt || !run.scope.projectId || task.projectId !== run.scope.projectId) {
        throw new Error('Task is outside the captured project');
      }
      targetIds.push(taskId);
      after = { entity: target.entity, id: target.id, taskId, taskUpdatedAt: task.updatedAt };
      summary = `Link task “${task.title}” to selected ${target.entity}`;
    }
  } else if (toolName === 'tabs_forms_create_draft_v1') {
    exactKeys(args, ['name']);
    const name = requiredText(args.name, 'Form name', 120);
    after = { name, status: 'draft' };
    summary = `Create draft form “${name}”`;
  } else if (toolName === 'tabs_forms_update_draft_v1') {
    exactKeys(args, ['formId', 'expectedUpdatedAt', 'name', 'description', 'successMessage']);
    const formId = requiredText(args.formId, 'Form ID', 128);
    if (formId !== run.scope.formsSelection?.formId) throw new Error('Form is outside the captured selection');
    const form = await crmFormsDb.forms.get(formId);
    if (!form || form.status !== 'draft') throw new Error('Selected draft form is unavailable');
    if (args.expectedUpdatedAt !== form.updatedAt) throw new Error('Form revision changed');
    const patch = {
      name: args.name === undefined ? form.name : requiredText(args.name, 'Form name', 120),
      description: args.description === undefined ? form.description : optionalText(args.description, 'description', 4 * 1024),
      successMessage: args.successMessage === undefined ? form.successMessage
        : requiredText(args.successMessage, 'Success message', 2 * 1024),
    };
    if (args.name === undefined && args.description === undefined && args.successMessage === undefined) {
      throw new Error('No form changes proposed');
    }
    targetIds = [formId]; expectedRevision = form.updatedAt; before = form;
    after = { ...form, ...patch };
    summary = `Update draft form “${form.name}”`;
  } else if (toolName === 'tabs_forms_follow_up_task_v1') {
    exactKeys(args, ['submissionId', 'expectedFormUpdatedAt', 'taskTitle', 'taskContent']);
    const submissionId = requiredText(args.submissionId, 'Submission ID', 128);
    const formId = run.scope.formsSelection?.formId;
    const projectId = run.scope.projectId;
    if (!formId || !projectId || submissionId !== run.scope.formsSelection?.submissionId) {
      throw new Error('Form follow-up is outside the captured selection');
    }
    const [submission, form, project] = await Promise.all([
      crmFormsDb.formSubmissions.get(submissionId), crmFormsDb.forms.get(formId), db.projects.get(projectId),
    ]);
    if (!submission || submission.formId !== formId || submission.status === 'spam' || !form || !project) {
      throw new Error('Selected submission, form, or project is unavailable');
    }
    if (args.expectedFormUpdatedAt !== form.updatedAt) throw new Error('Form revision changed');
    if (!submission.leadId && !submission.contactId && !submission.companyId) {
      throw new Error('Submission has no linked CRM result');
    }
    const title = requiredText(args.taskTitle, 'Task title', TASK_TITLE_MAX_LENGTH);
    const content = plainEditorContent(args.taskContent) ?? '';
    targetIds = [submissionId, projectId];
    before = { submission, form, project };
    after = { title, content, projectId, submissionId, formId };
    summary = `Create follow-up task “${title}” for form submission ${submissionId}`;
  } else if (toolName === 'tabs_settings_update_v1') {
    exactKeys(args, ['key', 'value']);
    if (run.scope.settingsTab !== 'appearance') throw new Error('Appearance settings are outside the captured section');
    if (args.key !== 'editorFontSize' && args.key !== 'language') throw new Error('Setting is not allowlisted');
    if (args.key === 'editorFontSize' && !isEditorFontSize(args.value)) throw new Error('Invalid editor font size');
    if (args.key === 'language' && args.value !== 'en' && args.value !== 'tr') throw new Error('Invalid language');
    targetIds = [args.key];
    before = (await db.settings.get(args.key))?.value ?? null;
    expectedRevision = JSON.stringify(before);
    after = args.value;
    summary = `Change ${args.key} from ${String(before)} to ${String(after)}`;
  } else throw new Error('Unsupported mutation tool');

  const proposalHash = await sha256(JSON.stringify({ operationId, toolName, argumentHash,
    targetIds, expectedRevision, before, after }));
  return { operationId, toolName, argumentHash, proposalHash, arguments: structuredClone(args),
    targetIds, expectedRevision, before, after, summary, createdAt: Date.now() };
}

export async function verifyBusinessProposal(run: CodexRunRecord, request: CodexPendingRequest,
  proposal: CodexBusinessProposal): Promise<void> {
  const toolName = assertRequest(run, request);
  if (proposal.toolName !== toolName || proposal.operationId !== `codex:${run.runId}:${request.callId}`) {
    throw new Error('Proposal correlation changed');
  }
  const argumentHash = await sha256(JSON.stringify(argsFor(request)));
  const proposalHash = await sha256(JSON.stringify({ operationId: proposal.operationId, toolName,
    argumentHash, targetIds: proposal.targetIds, expectedRevision: proposal.expectedRevision,
    before: proposal.before, after: proposal.after }));
  if (proposal.argumentHash !== argumentHash || proposal.proposalHash !== proposalHash) {
    throw new Error('Proposal contents changed');
  }
}

function receipt(run: CodexRunRecord, proposal: CodexBusinessProposal,
  domain: CodexOperationReceipt['domain'], outcome: CodexOperationReceipt['outcome'],
  affectedIds: string[], result: string): CodexOperationReceipt {
  return { operationId: proposal.operationId, proposalHash: proposal.proposalHash,
    appThreadId: run.appThreadId, runId: run.runId, domain, outcome, affectedIds, result,
    createdAt: Date.now(), sourceToolName: proposal.toolName };
}

async function existingReceipt(proposal: CodexBusinessProposal): Promise<CodexOperationReceipt | undefined> {
  const result = await db.codexOperationReceipts.get(proposal.operationId)
    ?? await crmFormsDb.codexOperationReceipts.get(proposal.operationId);
  return matchingReceipt(result, proposal);
}

function matchingReceipt(result: CodexOperationReceipt | undefined,
  proposal: CodexBusinessProposal): CodexOperationReceipt | undefined {
  if (result && result.proposalHash !== proposal.proposalHash) {
    throw new Error('Tool call ID was reused with changed arguments');
  }
  return result;
}

export async function rejectBusinessProposal(run: CodexRunRecord, proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  const old = await existingReceipt(proposal);
  if (old) return old;
  const domain = proposal.toolName.includes('_crm_') || proposal.toolName.includes('_forms_') ? 'crmForms' : 'main';
  const row = receipt(run, proposal, domain, 'rejected', [], 'The user declined this proposal.');
  const table = domain === 'main' ? db.codexOperationReceipts : crmFormsDb.codexOperationReceipts;
  try { await table.add(row); } catch (error) {
    const duplicate = await table.get(proposal.operationId);
    if (duplicate?.proposalHash === proposal.proposalHash) return duplicate;
    throw error;
  }
  return row;
}

function selectedEditor(scope: CodexScope) {
  const state = useWorkspaceStore.getState();
  const workspace = state.workspaces.find((item) => item.id === scope.workspaceId);
  const editor = editorRef.current;
  if (!scope.workspaceId || state.activeWorkspaceId !== scope.workspaceId
    || !workspace?.currentFile || workspace.currentFile.path !== scope.document?.path
    || !editor || editor.isDestroyed) {
    throw new Error('Captured document is not active in the editor');
  }
  return editor;
}

type DocumentEdit = { workspaceId: string; path: string; from: number; to: number;
  replacement: string; contentHash: string };
const documentEditLocks = new Map<string, Promise<CodexOperationReceipt>>();
type DocumentFileCreate = { workspaceId: string; fileName: string; path: string;
  size: number; contentHash: string; sourceHash?: string; preview: string };
const documentFileLocks = new Map<string, Promise<CodexOperationReceipt>>();

function executeDocumentFileCreate(run: CodexRunRecord,
  proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  const inFlight = documentFileLocks.get(proposal.operationId);
  if (inFlight) return inFlight;
  const work = performDocumentFileCreate(run, proposal);
  documentFileLocks.set(proposal.operationId, work);
  void work.finally(() => documentFileLocks.delete(proposal.operationId)).catch(() => undefined);
  return work;
}

async function performDocumentFileCreate(run: CodexRunRecord,
  proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  if (!toolsForScope(run.scope).some((tool) => tool.name === proposal.toolName)) {
    throw new Error('Document file operation is outside the captured scope');
  }
  const after = proposal.after as DocumentFileCreate;
  const file = documentFileName(after.fileName);
  if (!run.scope.hasConnectedFolder || after.workspaceId !== run.scope.workspaceId
    || after.path !== `${run.scope.workspaceRoot.replace(/[\\/]+$/, '')}/${file.name}`) {
    throw new Error('Document destination changed');
  }
  let saved = await existingReceipt(proposal);
  if (saved && saved.projection !== 'pending' && saved.projection !== 'failed') return saved;
  assertActiveConnectedFolder(run.scope);
  if (proposal.toolName === 'tabs_document_export_v1') {
    const editor = selectedEditor(run.scope);
    if (await sha256(JSON.stringify(editor.getJSON())) !== after.sourceHash) {
      throw new Error('Document revision changed before export');
    }
  }
  const args = proposal.arguments;
  const content = proposal.toolName === 'tabs_document_create_v1'
    ? (file.extension === 'txt' ? parseTxt(args.content as string) : parseMarkdown(args.content as string))
    : JSON.parse(run.scope.document?.content ?? '') as object;
  const bytes = await editorFileBytes(content, file.extension);
  if (bytes.length !== after.size || await sha256Bytes(bytes) !== after.contentHash) {
    throw new Error('Document content changed after approval');
  }
  const previousIntent = await db.codexDocumentIntents.get(proposal.operationId);
  if (previousIntent && previousIntent.proposalHash !== proposal.proposalHash) {
    throw new Error('Document intent changed after approval');
  }
  if (!saved) {
    saved = receipt(run, proposal, 'main', 'partial', [after.path],
      limitedResult({ path: after.path, state: 'filesystem intent recorded' }));
    saved.projection = 'pending';
    const intent = { operationId: proposal.operationId, proposalHash: proposal.proposalHash,
      kind: 'fileCreate' as const, workspaceId: after.workspaceId, path: after.path,
      afterHash: after.contentHash, afterContent: base64Bytes(bytes),
      status: 'pending' as const, createdAt: Date.now() };
    await db.transaction('rw', db.codexOperationReceipts, db.codexDocumentIntents, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) { saved = duplicate; return; }
      await db.codexDocumentIntents.add(intent);
      await db.codexOperationReceipts.add(saved!);
    });
  }
  if (!saved || saved.projection === 'complete') return saved!;
  try {
    const diskHash = await codexDesktopClient.scopedDocumentHash(run.scope.workspaceRoot, file.name);
    if (diskHash !== null && diskHash !== after.contentHash) {
      throw new Error('Document destination changed after approval');
    }
    if (diskHash !== null && !previousIntent?.nativeWriteConfirmed) {
      throw new Error('Matching document exists, but write ownership is uncertain');
    }
    let writtenPath = after.path;
    if (diskHash === null) {
      if (proposal.toolName === 'tabs_document_export_v1') {
        const editor = selectedEditor(run.scope);
        if (await sha256(JSON.stringify(editor.getJSON())) !== after.sourceHash) {
          throw new Error('Document revision changed before export');
        }
      }
      const created = await codexDesktopClient.createScopedDocument(run.scope.workspaceRoot,
        file.name, base64Bytes(bytes), after.contentHash);
      if (created.sha256 !== after.contentHash) throw new Error('Document write hash differed');
      writtenPath = created.path;
      await db.codexDocumentIntents.update(proposal.operationId,
        { nativeWriteConfirmed: true, path: writtenPath });
    }
    if (await codexDesktopClient.scopedDocumentHash(run.scope.workspaceRoot, file.name)
      !== after.contentHash) throw new Error('Document write could not be verified');
    await useWorkspaceStore.getState().refreshWorkspaceDir(after.workspaceId, run.scope.workspaceRoot);
    const result = limitedResult({ path: writtenPath, contentHash: after.contentHash,
      bytes: after.size });
    await db.transaction('rw', db.codexOperationReceipts, db.codexDocumentIntents, async () => {
      await db.codexDocumentIntents.update(proposal.operationId, { status: 'complete' });
      await db.codexOperationReceipts.update(proposal.operationId,
        { outcome: 'applied', projection: 'complete', projectionError: undefined, result,
          affectedIds: [writtenPath] });
    });
    return { ...saved, outcome: 'applied', projection: 'complete',
      projectionError: undefined, affectedIds: [writtenPath], result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Document write needs reconciliation';
    if (/destination changed|already exists|ownership is uncertain/i.test(message)) {
      await db.codexDocumentIntents.update(proposal.operationId, { status: 'uncertain' });
    }
    await db.codexOperationReceipts.update(proposal.operationId,
      { outcome: 'partial', projection: 'failed', projectionError: message });
    return { ...saved, outcome: 'partial', projection: 'failed', projectionError: message };
  }
}

function executeDocumentEdit(run: CodexRunRecord,
  proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  const inFlight = documentEditLocks.get(proposal.operationId);
  if (inFlight) return inFlight;
  const work = performDocumentEdit(run, proposal);
  documentEditLocks.set(proposal.operationId, work);
  void work.finally(() => documentEditLocks.delete(proposal.operationId)).catch(() => undefined);
  return work;
}

async function performDocumentEdit(run: CodexRunRecord,
  proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  if (!toolsForScope(run.scope).some((tool) => tool.name === proposal.toolName)) {
    throw new Error('Document edit is outside the captured scope');
  }
  const after = proposal.after as DocumentEdit;
  if (after.workspaceId !== run.scope.workspaceId || after.path !== run.scope.document?.path
    || proposal.expectedRevision !== run.scope.document.contentHash) {
    throw new Error('Document proposal target changed');
  }
  let saved = await existingReceipt(proposal);
  if (saved && saved.projection !== 'pending' && saved.projection !== 'failed') return saved;
  const editor = selectedEditor(run.scope);
  const currentHash = await sha256(JSON.stringify(editor.getJSON()));
  if (!saved && currentHash !== proposal.expectedRevision) throw new Error('Document revision changed');
  if (saved && currentHash !== proposal.expectedRevision && currentHash !== after.contentHash) {
    throw new Error('Document changed while an approved edit awaited reconciliation');
  }
  const existingIntent = await db.codexDocumentIntents.get(proposal.operationId);
  const nextContent = currentHash === after.contentHash
    ? existingIntent?.afterContent
    : JSON.stringify(editor.state.tr.insertText(after.replacement, after.from, after.to).doc.toJSON());
  if (!nextContent || await sha256(nextContent) !== after.contentHash) {
    throw new Error('Document edit no longer matches its approved preview');
  }
  if (!saved) {
    saved = receipt(run, proposal, 'main', 'partial', [after.path],
      limitedResult({ path: after.path, state: 'editor intent recorded' }));
    saved.projection = 'pending';
    const intent = { operationId: proposal.operationId, proposalHash: proposal.proposalHash,
      kind: 'editorEdit' as const, workspaceId: after.workspaceId, path: after.path,
      beforeHash: proposal.expectedRevision as string, afterHash: after.contentHash,
      afterContent: nextContent, status: 'pending' as const, createdAt: Date.now() };
    await db.transaction('rw', db.codexOperationReceipts, db.codexDocumentIntents, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) { saved = duplicate; return; }
      await db.codexDocumentIntents.add(intent);
      await db.codexOperationReceipts.add(saved!);
    });
  }
  if (!saved || saved.projection === 'complete') return saved!;
  try {
    if (currentHash === proposal.expectedRevision) {
      const transaction = editor.state.tr.insertText(after.replacement, after.from, after.to);
      if (await sha256(JSON.stringify(transaction.doc.toJSON())) !== after.contentHash) {
        throw new Error('Document edit no longer matches its approved preview');
      }
      editor.view.dispatch(transaction);
    }
    if (await sha256(JSON.stringify(editor.getJSON())) !== after.contentHash) {
      throw new Error('Editor changed while applying the approved edit');
    }
    const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === after.workspaceId);
    if (!workspace?.currentFile || workspace.currentFile.path !== after.path) {
      throw new Error('Document workspace changed while applying the approved edit');
    }
    useWorkspaceStore.getState().updateFileContent(after.workspaceId, nextContent, true);
    const updated = useWorkspaceStore.getState().workspaces.find((item) => item.id === after.workspaceId);
    if (!updated?.currentFile || updated.currentFile.content !== nextContent) {
      throw new Error('Document store did not accept the approved edit');
    }
    const result = limitedResult({ path: after.path, contentHash: after.contentHash, isDirty: true });
    await db.transaction('rw', db.workspaces, db.codexOperationReceipts,
      db.codexDocumentIntents, async () => {
        const persisted = await db.workspaces.update(after.workspaceId,
          { currentFile: updated.currentFile, updatedAt: updated.updatedAt });
        if (!persisted) throw new Error('Document workspace was not persisted');
        await db.codexDocumentIntents.update(proposal.operationId, { status: 'complete' });
        await db.codexOperationReceipts.update(proposal.operationId,
          { outcome: 'applied', projection: 'complete', projectionError: undefined, result });
      });
    return { ...saved, outcome: 'applied', projection: 'complete', projectionError: undefined, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Editor edit could not be reconciled';
    await db.codexDocumentIntents.update(proposal.operationId, { status: 'uncertain' });
    await db.codexOperationReceipts.update(proposal.operationId,
      { outcome: 'partial', projection: 'failed', projectionError: message });
    return { ...saved, outcome: 'partial', projection: 'failed', projectionError: message };
  }
}

export async function executeBusinessProposal(run: CodexRunRecord, proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  if (proposal.toolName === 'tabs_document_replace_selection_v1') {
    return executeDocumentEdit(run, proposal);
  }
  if (proposal.toolName === 'tabs_document_create_v1' || proposal.toolName === 'tabs_document_export_v1') {
    return executeDocumentFileCreate(run, proposal);
  }
  if (proposal.toolName === 'tabs_forms_follow_up_task_v1') {
    return executeFormsFollowUp(run, proposal);
  }
  const old = await existingReceipt(proposal);
  if (old) {
    if (old.projection === 'pending' || old.projection === 'failed') {
      const projected = await finishTaskProjection(old);
      await useTaskStore.getState().refreshTasksFromDb();
      return projected;
    }
    return old;
  }
  const tool = proposal.toolName;
  if (!toolsForScope(run.scope).some((spec) => spec.name === tool)) throw new Error('Business tool is outside scope');

  if (tool === 'tabs_tasks_create_v1' || tool === 'tabs_tasks_update_v1'
    || tool === 'tabs_tasks_soft_delete_v1') {
    const row = await db.transaction('rw', db.tasks, db.projects, db.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      let task: Task;
      let previousTask: Task | undefined;
      if (tool === 'tabs_tasks_create_v1') {
        const data = proposal.after as Pick<Task, 'title' | 'content' | 'date' | 'status' | 'importance' | 'projectId' | 'parentTaskId'>;
        const project = await db.projects.get(data.projectId);
        const parent = data.parentTaskId ? await db.tasks.get(data.parentTaskId) : undefined;
        if (data.projectId !== taskProject(run.scope) || !project
          || JSON.stringify(parent ? { project, parent } : project) !== JSON.stringify(proposal.before)) {
          throw new Error('Project or subtask parent changed');
        }
        if (data.parentTaskId) assertSubtaskParent(parent, data.projectId);
        const now = Date.now();
        task = { ...data, id: `codex_${proposal.proposalHash.slice(0, 12)}`, assignees: [],
          createdAt: now, updatedAt: now, order: await db.tasks.count(),
          sourceChatMessageId: `codex:user:${run.runId}` };
        await db.tasks.add(task);
      } else {
        const id = proposal.targetIds[0];
        const current = await db.tasks.get(id);
        if (!current || current.deletedAt || current.projectId !== taskProject(run.scope)
          || current.updatedAt !== proposal.expectedRevision
          || JSON.stringify(current) !== JSON.stringify(proposal.before)) throw new Error('Task revision changed');
        const approved = proposal.after as Task;
        const sourceProject = await db.projects.get(current.projectId);
        const targetProject = await db.projects.get(approved.projectId);
        const activeChildCount = await db.tasks.where('parentTaskId').equals(current.id)
          .filter((child) => !child.deletedAt).count();
        if (!sourceProject || !targetProject
          || sourceProject.clientId !== targetProject.clientId
          || (approved.projectId !== current.projectId
            && projectMirrorsOverlap(sourceProject.name, targetProject.name))
          || (approved.projectId !== current.projectId
            && proposal.targetIds[1] !== approved.projectId)) {
          throw new Error('Project assignment changed');
        }
        if (tool === 'tabs_tasks_soft_delete_v1') assertTaskSoftDelete(activeChildCount);
        else assertTaskProjectChange(current, approved.projectId, activeChildCount);
        task = tool === 'tabs_tasks_soft_delete_v1'
          ? { ...current, deletedAt: Date.now(), updatedAt: Date.now() }
          : { ...current, title: approved.title, content: approved.content, date: approved.date,
            status: approved.status, importance: approved.importance,
            projectId: approved.projectId, updatedAt: Date.now() };
        await db.tasks.put(task);
        previousTask = current;
      }
      const saved = receipt(run, proposal, 'main', 'applied', [task.id], limitedResult({ taskId: task.id }));
      saved.projection = 'pending';
      saved.projectionTask = task;
      saved.projectionPreviousTask = previousTask;
      await db.codexOperationReceipts.add(saved);
      return saved;
    });
    const projected = await finishTaskProjection(row);
    await useTaskStore.getState().refreshTasksFromDb();
    return projected;
  }
  if (tool === 'tabs_tasks_undo_v1') {
    const row = await db.transaction('rw', db.tasks, db.projects, db.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const sourceOperationId = proposal.targetIds[1];
      const source = await db.codexOperationReceipts.get(sourceOperationId);
      if (!source || source.appThreadId !== run.appThreadId || source.projection !== 'complete'
        || source.undoneByOperationId || !isUndoableTaskTool(source.sourceToolName)
        || !source.projectionTask) throw new Error('Task change is unavailable for undo');
      const current = await db.tasks.get(proposal.targetIds[0]);
      if (!current || JSON.stringify(current) !== JSON.stringify(proposal.before)
        || JSON.stringify(current) !== JSON.stringify(source.projectionTask)
        || current.updatedAt !== proposal.expectedRevision) throw new Error('Task changed after approval');
      const projectId = taskProject(run.scope);
      if (projectId !== current.projectId && projectId !== source.projectionPreviousTask?.projectId) {
        throw new Error('Task change is outside the captured project');
      }
      await assertUndoRelationship(source, current);
      const now = Math.max(Date.now(), current.updatedAt + 1);
      const task: Task = source.sourceToolName === 'tabs_tasks_create_v1'
        ? { ...current, deletedAt: now, updatedAt: now }
        : { ...source.projectionPreviousTask!, updatedAt: now };
      await db.tasks.put(task);
      const saved = receipt(run, proposal, 'main', 'applied', [task.id],
        limitedResult({ taskId: task.id, undoneOperationId: sourceOperationId }));
      saved.projection = 'pending';
      saved.projectionTask = task;
      saved.projectionPreviousTask = current;
      saved.undoOfOperationId = sourceOperationId;
      await db.codexOperationReceipts.add(saved);
      await db.codexOperationReceipts.update(sourceOperationId, { undoneByOperationId: proposal.operationId });
      return saved;
    });
    const projected = await finishTaskProjection(row);
    await useTaskStore.getState().refreshTasksFromDb();
    return projected;
  }
  if (tool === 'tabs_tasks_comment_v1') {
    const row = await db.transaction('rw', db.tasks, db.taskComments, db.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const taskId = proposal.targetIds[0];
      const task = await db.tasks.get(taskId);
      if (!task || task.deletedAt || task.projectId !== taskProject(run.scope)
        || task.updatedAt !== proposal.expectedRevision
        || JSON.stringify(task) !== JSON.stringify(proposal.before)) throw new Error('Task revision changed');
      const id = `codex_${proposal.proposalHash.slice(0, 12)}`;
      await db.taskComments.add({ id, taskId, text: (proposal.after as { text: string }).text,
        sender: 'You', createdAt: Date.now() });
      const saved = receipt(run, proposal, 'main', 'applied', [id], limitedResult({ commentId: id, taskId }));
      await db.codexOperationReceipts.add(saved);
      return saved;
    });
    await useTaskCommentStore.getState().loadComments(proposal.targetIds[0]);
    return row;
  }
  if (tool === 'tabs_crm_create_contact_v1') {
    const row = await crmFormsDb.transaction('rw', crmFormsDb.crmContacts, crmFormsDb.crmCompanies,
      crmFormsDb.crmActivities, crmFormsDb.codexOperationReceipts, async () => {
        const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(proposal.operationId), proposal);
        if (duplicate) return duplicate;
        const data = proposal.after as { firstName: string; lastName: string; email?: string; companyId?: string };
        if (data.email && await crmFormsDb.crmContacts.where('email').equalsIgnoreCase(data.email).first()) {
          throw new Error('Contact email already exists');
        }
        const company = data.companyId ? await crmFormsDb.crmCompanies.get(data.companyId) : undefined;
        if (data.companyId && (data.companyId !== run.scope.crmSelection?.companyId
          || !company || JSON.stringify(company) !== JSON.stringify(proposal.before))) {
          throw new Error('Selected company changed');
        }
        const id = `codex_${proposal.proposalHash.slice(0, 12)}`;
        const now = new Date().toISOString();
        await crmFormsDb.crmContacts.add({ id, ...data, tags: [], createdAt: now, updatedAt: now, lastActivityAt: now });
        await crmFormsDb.crmActivities.add({ id: `${id}_activity`, type: 'contact_created',
          title: `Contact created: ${data.firstName} ${data.lastName}`, contactId: id,
          companyId: data.companyId, createdAt: now });
        const saved = receipt(run, proposal, 'crmForms', 'applied', [id], limitedResult({ contactId: id }));
        await crmFormsDb.codexOperationReceipts.add(saved);
        return saved;
      });
    await useCrmStore.getState().loadCrm();
    return row;
  }
  if (tool === 'tabs_crm_create_company_v1') {
    const row = await crmFormsDb.transaction('rw', crmFormsDb.crmCompanies, crmFormsDb.crmActivities,
      crmFormsDb.codexOperationReceipts, async () => {
        const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(proposal.operationId), proposal);
        if (duplicate) return duplicate;
        const name = (proposal.after as { name: string }).name;
        if (await crmFormsDb.crmCompanies.where('name').equalsIgnoreCase(name).first()) {
          throw new Error('Company name already exists');
        }
        const company = await createCompany(proposal.after as Parameters<typeof createCompany>[0]);
        const saved = receipt(run, proposal, 'crmForms', 'applied', [company.id], limitedResult({ companyId: company.id }));
        await crmFormsDb.codexOperationReceipts.add(saved);
        return saved;
      });
    await useCrmStore.getState().loadCrm();
    return row;
  }
  if (tool === 'tabs_crm_create_deal_v1') {
    const row = await crmFormsDb.transaction('rw', [crmFormsDb.crmDeals, crmFormsDb.crmActivities,
      crmFormsDb.crmLeads, crmFormsDb.crmContacts, crmFormsDb.crmCompanies,
      crmFormsDb.codexOperationReceipts], async () => {
        const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(proposal.operationId), proposal);
        if (duplicate) return duplicate;
        const data = proposal.after as Parameters<typeof createDeal>[0];
        if (data.leadId && (data.leadId !== run.scope.crmSelection?.leadId || !await crmFormsDb.crmLeads.get(data.leadId))) {
          throw new Error('Selected lead changed');
        }
        if (data.contactId && (data.contactId !== run.scope.crmSelection?.contactId || !await crmFormsDb.crmContacts.get(data.contactId))) {
          throw new Error('Selected contact changed');
        }
        if (data.companyId && (data.companyId !== run.scope.crmSelection?.companyId || !await crmFormsDb.crmCompanies.get(data.companyId))) {
          throw new Error('Selected company changed');
        }
        const currentLinks = await Promise.all([
          data.leadId ? crmFormsDb.crmLeads.get(data.leadId) : undefined,
          data.contactId ? crmFormsDb.crmContacts.get(data.contactId) : undefined,
          data.companyId ? crmFormsDb.crmCompanies.get(data.companyId) : undefined,
        ]);
        if (JSON.stringify(currentLinks.filter(Boolean)) !== JSON.stringify(proposal.before)) {
          throw new Error('Deal links changed');
        }
        const deal = await createDeal(data);
        const saved = receipt(run, proposal, 'crmForms', 'applied', [deal.id], limitedResult({ dealId: deal.id }));
        await crmFormsDb.codexOperationReceipts.add(saved);
        return saved;
      });
    await useCrmStore.getState().loadCrm();
    return row;
  }
  if (tool === 'tabs_crm_update_v1' || tool === 'tabs_crm_add_note_v1'
    || tool === 'tabs_crm_link_task_v1') {
    const proposed = proposal.after as { body?: string; taskId?: string; taskUpdatedAt?: number };
    const entity = proposal.arguments.entity;
    const targetId = proposal.arguments.id;
    if (tool === 'tabs_crm_link_task_v1') {
      const task = proposed.taskId ? await db.tasks.get(proposed.taskId) : undefined;
      if (!task || task.deletedAt || task.projectId !== run.scope.projectId
        || task.updatedAt !== proposed.taskUpdatedAt) throw new Error('Linked task revision changed');
    }
    const row = await crmFormsDb.transaction('rw', [crmFormsDb.crmContacts, crmFormsDb.crmCompanies,
      crmFormsDb.crmDeals, crmFormsDb.crmLeads, crmFormsDb.crmNotes, crmFormsDb.crmTaskLinks,
      crmFormsDb.crmActivities, crmFormsDb.codexOperationReceipts], async () => {
      const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const target = await selectedCrmTarget(run.scope, entity, targetId);
      if (target.record.updatedAt !== proposal.expectedRevision
        || JSON.stringify(target.record) !== JSON.stringify(proposal.before)) throw new Error('CRM revision changed');
      let affectedId = target.id;
      if (tool === 'tabs_crm_update_v1') {
        const changes = crmChanges(target.entity, proposal.arguments.changes);
        if (target.entity === 'contact') await updateContact(target.id, changes as Partial<CRMContact>);
        else if (target.entity === 'company') await updateCompany(target.id, changes as Partial<CRMCompany>);
        else await updateDeal(target.id, changes as Partial<CRMDeal>);
      } else if (tool === 'tabs_crm_add_note_v1') {
        const link = target.entity === 'contact' ? { contactId: target.id }
          : target.entity === 'company' ? { companyId: target.id } : { dealId: target.id };
        const note = await addNote({ body: proposed.body ?? '', ...link });
        affectedId = note.id;
      } else {
        const taskId = proposed.taskId ?? '';
        const link = target.entity === 'contact' ? { contactId: target.id }
          : target.entity === 'company' ? { companyId: target.id } : { dealId: target.id };
        const existing = (await crmFormsDb.crmTaskLinks.where('taskId').equals(taskId).toArray())
          .find((candidate) => Object.entries(link).every(([key, value]) =>
            candidate[key as keyof typeof candidate] === value));
        const linked = existing ?? await linkTask({ taskId, ...link });
        affectedId = linked.id;
      }
      const saved = receipt(run, proposal, 'crmForms', 'applied', [affectedId],
        limitedResult({ entity: target.entity, id: target.id, affectedId }));
      await crmFormsDb.codexOperationReceipts.add(saved);
      return saved;
    });
    if (tool === 'tabs_crm_link_task_v1') {
      const task = proposed.taskId ? await db.tasks.get(proposed.taskId) : undefined;
      if (!task || task.deletedAt || task.updatedAt !== proposed.taskUpdatedAt) {
        await crmFormsDb.codexOperationReceipts.update(row.operationId,
          { outcome: 'partial', result: 'CRM task link saved, but the task changed or disappeared.' });
        row.outcome = 'partial'; row.result = 'CRM task link saved, but the task changed or disappeared.';
      }
    }
    await useCrmStore.getState().loadCrm();
    return row;
  }
  if (tool === 'tabs_forms_create_draft_v1') {
    const row = await crmFormsDb.transaction('rw', crmFormsDb.forms, crmFormsDb.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const form = blankForm((proposal.after as { name: string }).name);
      form.id = `codex_${proposal.proposalHash.slice(0, 12)}`;
      await crmFormsDb.forms.add(form);
      const saved = receipt(run, proposal, 'crmForms', 'applied', [form.id], limitedResult({ formId: form.id }));
      await crmFormsDb.codexOperationReceipts.add(saved);
      return saved;
    });
    await useFormsStore.getState().loadForms();
    return row;
  }
  if (tool === 'tabs_forms_update_draft_v1') {
    const row = await crmFormsDb.transaction('rw', crmFormsDb.forms, crmFormsDb.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const id = proposal.targetIds[0];
      const current = await crmFormsDb.forms.get(id);
      if (!current || current.status !== 'draft' || current.updatedAt !== proposal.expectedRevision
        || JSON.stringify(current) !== JSON.stringify(proposal.before)
        || id !== run.scope.formsSelection?.formId) throw new Error('Form revision changed');
      const approved = proposal.after as typeof current;
      const updated = await updateForm(id, { name: approved.name, description: approved.description,
        successMessage: approved.successMessage });
      if (!updated) throw new Error('Form disappeared');
      const saved = receipt(run, proposal, 'crmForms', 'applied', [id], limitedResult({ formId: id }));
      await crmFormsDb.codexOperationReceipts.add(saved);
      return saved;
    });
    await useFormsStore.getState().loadForms();
    useFormsStore.getState().setActiveFormId(proposal.targetIds[0]);
    return row;
  }
  if (tool === 'tabs_settings_update_v1') {
    const row = await db.transaction('rw', db.settings, db.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const key = proposal.targetIds[0];
      const current = (await db.settings.get(key))?.value ?? null;
      if (JSON.stringify(current) !== proposal.expectedRevision) throw new Error('Setting changed after approval');
      await db.settings.put({ key, value: proposal.after as string | number });
      const saved = receipt(run, proposal, 'main', 'applied', [key], limitedResult({ key, value: proposal.after }));
      await db.codexOperationReceipts.add(saved);
      return saved;
    });
    if (proposal.targetIds[0] === 'editorFontSize' && isEditorFontSize(proposal.after)) {
      useUIStore.getState().setEditorFontSize(proposal.after);
    } else if (proposal.targetIds[0] === 'language' && (proposal.after === 'en' || proposal.after === 'tr')) {
      useUIStore.getState().setLanguage(proposal.after);
    }
    return row;
  }
  throw new Error('Unsupported proposal');
}

async function executeFormsFollowUp(run: CodexRunRecord,
  proposal: CodexBusinessProposal): Promise<CodexOperationReceipt> {
  if (!toolsForScope(run.scope).some((tool) => tool.name === proposal.toolName)) {
    throw new Error('Form follow-up is outside scope');
  }
  const before = proposal.before as {
    submission: { id: string; formId: string; leadId?: string; contactId?: string; companyId?: string };
    form: { id: string; updatedAt: string };
    project: { id: string };
  };
  const after = proposal.after as { title: string; content: string; projectId: string;
    submissionId: string; formId: string };
  const terminal = await existingReceipt(proposal);
  if (terminal && !terminal.affectedIds.length) return terminal;
  let main = await db.codexOperationReceipts.get(proposal.operationId);
  matchingReceipt(main, proposal);
  if (!main) {
    const [submission, form] = await Promise.all([
      crmFormsDb.formSubmissions.get(after.submissionId), crmFormsDb.forms.get(after.formId),
    ]);
    if (JSON.stringify(submission) !== JSON.stringify(before.submission)
      || JSON.stringify(form) !== JSON.stringify(before.form)) {
      throw new Error('Form submission or definition changed');
    }
    main = await db.transaction('rw', db.tasks, db.projects, db.codexOperationReceipts, async () => {
      const duplicate = matchingReceipt(await db.codexOperationReceipts.get(proposal.operationId), proposal);
      if (duplicate) return duplicate;
      const project = await db.projects.get(after.projectId);
      if (!project || JSON.stringify(project) !== JSON.stringify(before.project)
        || after.projectId !== run.scope.projectId) throw new Error('Project changed');
      const now = Date.now();
      const task: Task = { id: `codex_${proposal.proposalHash.slice(0, 12)}`, title: after.title,
        content: after.content, status: 'pending', importance: 'medium',
        date: new Date(run.scope.capturedAt).toISOString().slice(0, 10),
        projectId: after.projectId, assignees: [], createdAt: now, updatedAt: now,
        order: await db.tasks.count(), sourceChatMessageId: `codex:user:${run.runId}` };
      await db.tasks.add(task);
      const saved = receipt(run, proposal, 'main', 'applied', [task.id],
        limitedResult({ taskId: task.id, submissionId: after.submissionId }));
      saved.projection = 'pending';
      saved.projectionTask = task;
      await db.codexOperationReceipts.add(saved);
      return saved;
    });
  }
  main = await finishTaskProjection(main);
  await useTaskStore.getState().refreshTasksFromDb();
  const crmOperationId = `${proposal.operationId}:crm`;
  let crm = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(crmOperationId), proposal);
  if (!crm) {
    try {
      crm = await crmFormsDb.transaction('rw', [crmFormsDb.formSubmissions,
        crmFormsDb.crmLeads, crmFormsDb.crmContacts, crmFormsDb.crmCompanies,
        crmFormsDb.crmTaskLinks, crmFormsDb.crmActivities, crmFormsDb.codexOperationReceipts], async () => {
        const duplicate = matchingReceipt(await crmFormsDb.codexOperationReceipts.get(crmOperationId), proposal);
        if (duplicate) return duplicate;
        const submission = await crmFormsDb.formSubmissions.get(after.submissionId);
        if (JSON.stringify(submission) !== JSON.stringify(before.submission)) {
          throw new Error('Form submission changed after task creation');
        }
        const links = { leadId: submission?.leadId, contactId: submission?.contactId,
          companyId: submission?.companyId };
        if (links.leadId && !await crmFormsDb.crmLeads.get(links.leadId)) throw new Error('Linked lead disappeared');
        if (links.contactId && !await crmFormsDb.crmContacts.get(links.contactId)) throw new Error('Linked contact disappeared');
        if (links.companyId && !await crmFormsDb.crmCompanies.get(links.companyId)) throw new Error('Linked company disappeared');
        const taskId = main!.affectedIds[0];
        const existing = (await crmFormsDb.crmTaskLinks.where('taskId').equals(taskId).toArray())
          .find((candidate) => candidate.leadId === links.leadId
            && candidate.contactId === links.contactId && candidate.companyId === links.companyId);
        const link = existing ?? await linkTask({ taskId, ...links });
        const saved = receipt(run, proposal, 'crmForms', 'applied', [link.id],
          limitedResult({ taskId, linkId: link.id, submissionId: after.submissionId }));
        saved.operationId = crmOperationId;
        await crmFormsDb.codexOperationReceipts.add(saved);
        return saved;
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'CRM link failed';
      const result = limitedResult({ taskId: main.affectedIds[0], submissionId: after.submissionId,
        missingStep: 'crmLink', reason });
      await db.codexOperationReceipts.update(main.operationId, { outcome: 'partial', result });
      return { ...main, outcome: 'partial', result };
    }
  }
  const outcome = main.projection === 'complete' ? 'applied' : 'partial';
  const result = limitedResult({ taskId: main.affectedIds[0], linkId: crm.affectedIds[0],
    submissionId: after.submissionId, projection: main.projection });
  await db.codexOperationReceipts.update(main.operationId, { outcome, result });
  await useCrmStore.getState().loadCrm();
  return { ...main, outcome, result };
}

async function finishTaskProjection(row: CodexOperationReceipt): Promise<CodexOperationReceipt> {
  const task = await db.tasks.get(row.affectedIds[0]);
  if (!task) throw new Error('Applied task is missing during projection reconciliation');
  try {
    if (!row.projectionTask || JSON.stringify(task) !== JSON.stringify(row.projectionTask)) {
      throw new Error('Task changed after its approved database effect');
    }
    await syncCodexTaskProjection(task, row.projectionPreviousTask);
    await db.codexOperationReceipts.update(row.operationId,
      { projection: 'complete', projectionError: undefined, outcome: 'applied' });
    return { ...row, projection: 'complete', projectionError: undefined, outcome: 'applied' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task file projection failed';
    await db.codexOperationReceipts.update(row.operationId,
      { projection: 'failed', projectionError: message, outcome: 'partial' });
    return { ...row, projection: 'failed', projectionError: message, outcome: 'partial' };
  }
}

export async function recordBusinessFailure(run: CodexRunRecord, proposal: CodexBusinessProposal,
  error: unknown): Promise<CodexOperationReceipt> {
  const existing = await existingReceipt(proposal);
  if (existing) return existing;
  const message = error instanceof Error ? error.message : 'Business operation failed';
  const outcome = /revision|changed|conflict/i.test(message) ? 'conflict' : 'failed';
  const domain = proposal.toolName === 'tabs_forms_follow_up_task_v1' ? 'main'
    : proposal.toolName.includes('_crm_') || proposal.toolName.includes('_forms_') ? 'crmForms' : 'main';
  const row = receipt(run, proposal, domain, outcome, [], message.slice(0, 2048));
  const table = domain === 'main' ? db.codexOperationReceipts : crmFormsDb.codexOperationReceipts;
  try { await table.add(row); } catch (cause) {
    const duplicate = await existingReceipt(proposal);
    if (duplicate) return duplicate;
    throw cause;
  }
  return row;
}

/** Inspect approved document intents after a renderer loss. Never repeat a disk write here. */
export async function reconcileDocumentIntents(): Promise<void> {
  const intents = await db.codexDocumentIntents.where('status').anyOf('pending', 'uncertain').toArray();
  for (const intent of intents) {
    const saved = await db.codexOperationReceipts.get(intent.operationId);
    if (!saved || saved.outcome === 'rejected' || saved.proposalHash !== intent.proposalHash) continue;
    let complete = false;
    let reason = 'Approved document effect needs review';
    if (intent.kind === 'editorEdit') {
      const workspace = await db.workspaces.get(intent.workspaceId);
      if (workspace?.currentFile?.path === intent.path
        && await sha256(workspace.currentFile.content) === intent.afterHash) {
        complete = true;
      } else {
        reason = 'Approved editor change is not present in the saved workspace';
      }
    } else {
      const run = await db.codexRuns.get(saved.runId);
      const fileName = intent.path.split(/[/\\]/).pop();
      if (run?.scope.hasConnectedFolder && fileName) {
        try {
          const diskHash = await codexDesktopClient.scopedDocumentHash(run.scope.workspaceRoot, fileName);
          complete = diskHash === intent.afterHash && intent.nativeWriteConfirmed === true;
          reason = diskHash === null ? 'Approved document file is absent; no write was replayed'
            : diskHash === intent.afterHash ? 'Matching file needs write ownership review'
              : 'Document destination differs from the approved content';
        } catch {
          reason = 'Approved document file could not be inspected';
        }
      }
    }
    await db.transaction('rw', db.codexDocumentIntents, db.codexOperationReceipts, async () => {
      if (complete) {
        await db.codexDocumentIntents.update(intent.operationId, { status: 'complete' });
        await db.codexOperationReceipts.update(intent.operationId,
          { outcome: 'applied', projection: 'complete', projectionError: undefined,
            result: limitedResult({ path: intent.path, contentHash: intent.afterHash,
              reconciled: true }) });
      } else {
        await db.codexDocumentIntents.update(intent.operationId, { status: 'uncertain' });
        await db.codexOperationReceipts.update(intent.operationId,
          { outcome: 'partial', projection: 'failed', projectionError: reason });
      }
    });
  }
}

export function receiptText(row: CodexOperationReceipt): string {
  return limitedResult({ operationId: row.operationId, outcome: row.outcome,
    affectedIds: row.affectedIds, result: row.result, projection: row.projection,
    projectionError: row.projectionError });
}
