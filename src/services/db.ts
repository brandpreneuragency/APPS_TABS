import Dexie, { type Table } from 'dexie';
import type { Document, Workspace, ChatMessage, Agent, AppSettings, QuickPrompt, ActionGroup, Task, Project, Client, TaskComment, TaskAIChangeBatch, ChatThreadMeta } from '../types';
import type { ClientAttachment, ClientContact, ClientDraft, ClientNote, ClientProfile } from '../types/clients';
import { migrateProjectsToClients } from '../stores/migrateProjectsToClients';
import type { CodexSessionRecord, CodexRunRecord, CodexEventRecord, CodexPendingRecord, CodexOperationReceipt, CodexDocumentIntent } from './codex/sessionTypes';
import { CLIENTS_V1_STORES } from './clients/schema';
import { GITHUB_V1_STORES } from './github/schema';
import type { GithubAccountRecord, GithubDraftRecord, GithubPrivateCacheRecord, GithubWorkspaceRecord } from './github/schema';

/** @deprecated Removed in v12 — folders now live inside Workspace objects. */
export interface FileHandleRecord {
  key: string;
  path: string;
}

/** Primary app DB. IndexedDB name stays `ZenEditorDB` for existing installs. */
export class TabsDB extends Dexie {
  /** @deprecated Replaced by workspaces in v12. */
  documents!: Table<Document>;
  workspaces!: Table<Workspace>;
  chatMessages!: Table<ChatMessage>;
  agents!: Table<Agent>;
  /** Historic API provider rows exist only until the scoped Codex migration. */
  providerConfigs!: Table<{ id: string; [key: string]: unknown }>;
  settings!: Table<AppSettings>;
  quickPrompts!: Table<QuickPrompt>;
  actionGroups!: Table<ActionGroup>;
  /** @deprecated Removed in v12 — folders live inside Workspace objects. */
  fileHandles!: Table<FileHandleRecord>;
  tasks!: Table<Task>;
  clients!: Table<Client>;
  clientProfiles!: Table<ClientProfile>;
  clientContacts!: Table<ClientContact>;
  clientNotes!: Table<ClientNote>;
  clientDrafts!: Table<ClientDraft>;
  clientAttachments!: Table<ClientAttachment>;
  projects!: Table<Project>;
  taskComments!: Table<TaskComment>;
  taskAIChangeBatches!: Table<TaskAIChangeBatch>;
  chatThreads!: Table<ChatThreadMeta>;
  codexSessions!: Table<CodexSessionRecord>;
  codexRuns!: Table<CodexRunRecord>;
  codexEvents!: Table<CodexEventRecord>;
  codexPendingRequests!: Table<CodexPendingRecord>;
  codexOperationReceipts!: Table<CodexOperationReceipt>;
  codexDocumentIntents!: Table<CodexDocumentIntent>;
  githubAccounts!: Table<GithubAccountRecord>;
  githubDrafts!: Table<GithubDraftRecord>;
  githubWorkspaces!: Table<GithubWorkspaceRecord>;
  githubPrivateCache!: Table<GithubPrivateCacheRecord>;

  constructor(name = 'ZenEditorDB') {
    super(name);
    this.version(1).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, documentId, agentId, timestamp',
      agents: 'id, name, isDefault',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt',
    });
    this.version(2).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, documentId, agentId, timestamp',
      agents: 'id, name, isDefault',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt',
      fileHandles: 'key',
    });
    this.version(3).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, documentId, taskId, agentId, timestamp',
      agents: 'id, name, isDefault',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
    });
    this.version(5).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, documentId, taskId, agentId, timestamp',
      agents: 'id, name, isDefault',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
    }).upgrade(async (tx) => {
      // Clear all old provider configs (clean slate for custom providers)
      await tx.table('providerConfigs').clear();
    });
    this.version(6).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, documentId, taskId, agentId, timestamp',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
    }).upgrade(async (tx) => {
      const agents = await tx.table('agents').toArray();
      await Promise.all(
        agents.map((agent: { id: string; scope?: string }) =>
          tx.table('agents').update(agent.id, {
            scope: agent.scope === 'task' ? 'task' : 'writer',
          })
        )
      );

      const prompts = await tx.table('quickPrompts').toArray();
      await Promise.all(
        prompts.map((prompt: { id: string; scope?: string }) =>
          tx.table('quickPrompts').update(prompt.id, {
            scope: prompt.scope === 'task' ? 'task' : 'writer',
          })
        )
      );
    });
    this.version(7).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
      chatThreads: 'id, mode, updatedAt',
    }).upgrade(async (tx) => {
      // Historic rows predate threads. Preserve message IDs and content while
      // grouping by their original document/task binding.
      const messages = await tx.table('chatMessages').toArray();
      const groups = new Map<string, { mode: 'writer' | 'task'; documentId?: string; taskId?: string;
        first: number; last: number }>();
      for (const message of messages) {
        const mode = message.mode === 'task' || message.taskId ? 'task' : 'writer';
        const id = message.threadId || (message.taskId
          ? `legacy-task:${message.taskId}`
          : message.documentId ? `legacy-document:${message.documentId}` : 'legacy-unscoped');
        const time = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
        await tx.table('chatMessages').update(message.id, { threadId: id, mode });
        const group = groups.get(id);
        groups.set(id, group ? { ...group, first: Math.min(group.first, time), last: Math.max(group.last, time) }
          : { mode, documentId: message.documentId, taskId: message.taskId, first: time, last: time });
      }
      for (const [id, group] of groups) {
        await tx.table('chatThreads').put({ id, mode: group.mode, documentId: group.documentId,
          taskId: group.taskId, title: 'Legacy chat', createdAt: group.first,
          updatedAt: group.last, origin: 'legacy_api' });
      }
    });
    this.version(8).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
      chatThreads: 'id, mode, updatedAt',
    }).upgrade(async (tx) => {
      // Phase 3 — Tauri file system migration. Old rows in `fileHandles`
      // held a `FileSystemDirectoryHandle` from the browser File System
      // Access API, which is not a valid value in the Tauri shell. Clear
      // the table; users will reconnect their folders in the Tauri app.
      await tx.table('fileHandles').clear();
    });
    this.version(9).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
      chatThreads: 'id, mode, updatedAt, documentId, taskId',
    });
    this.version(10).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope, groupId, order',
      actionGroups: 'id, scope, order',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
      chatThreads: 'id, mode, updatedAt, documentId, taskId, settingsTab',
    });
    // v11: add a `settingsTab` index so each Settings sub-tab can keep
    // an independent thread list.
    this.version(11).stores({
      documents: 'id, title, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp, settingsTab',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope, groupId, order',
      actionGroups: 'id, scope, order',
      fileHandles: 'key',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
      chatThreads: 'id, mode, updatedAt, documentId, taskId, settingsTab',
    });
    // v12: Workspace pivot — tabs become workspaces with isolated folders.
    // Retains old documents as a readable archive, drops obsolete browser
    // folder handles, and adds the local `workspaces` table.
    // and swaps `documentId` indexes for `workspaceId` on chat tables.
    // Keep historic messages even when an old document has no workspace.
    this.version(12).stores({
      documents: 'id, title, updatedAt, order',
      fileHandles: null, // drop table
      workspaces: 'id, name, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp, settingsTab, workspaceId',
      chatThreads: 'id, mode, updatedAt, workspaceId, taskId, settingsTab',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope, groupId, order',
      actionGroups: 'id, scope, order',
      tasks: 'id, title, updatedAt, order, projectId, status, parentId',
      projects: 'id, name',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
    });
    // v13: Client layer — each old project becomes a client with a General
    // project; tasks lose parentId and always have a projectId.
    this.version(13).stores({
      documents: 'id, title, updatedAt, order',
      fileHandles: null, // drop table
      workspaces: 'id, name, updatedAt, order',
      chatMessages: 'id, threadId, mode, agentId, timestamp, settingsTab, workspaceId',
      chatThreads: 'id, mode, updatedAt, workspaceId, taskId, settingsTab',
      agents: 'id, name, isDefault, scope',
      providerConfigs: 'id, provider, isActive',
      settings: 'key',
      quickPrompts: 'id, createdAt, scope, groupId, order',
      actionGroups: 'id, scope, order',
      tasks: 'id, title, updatedAt, order, projectId, status',
      projects: 'id, name, clientId',
      taskComments: 'id, taskId, createdAt',
      taskAIChangeBatches: 'id, taskId, createdAt, expiresAt',
      clients: 'id, name, order',
    }).upgrade(async (tx) => {
      const oldProjects = await tx.table('projects').toArray();
      const oldTasks = await tx.table('tasks').toArray();
      let n = 0;
      const { clients, projects, tasks } = migrateProjectsToClients(oldProjects, oldTasks, {
        id: () => `m13${(n++).toString(36).padStart(6, '0')}`,
        now: Date.now(),
      });
      if (clients.length === 0 && oldProjects.some((p: { clientId?: string }) => p.clientId)) {
        // already migrated
        return;
      }
      await tx.table('projects').clear();
      await tx.table('tasks').clear();
      await tx.table('clients').bulkAdd(clients);
      await tx.table('projects').bulkAdd(projects);
      await tx.table('tasks').bulkAdd(tasks);
    });
    this.version(14).stores({
      agents: 'id, name, isDefault',
    }).upgrade(async (tx) => {
      await tx.table('agents').toCollection().modify((agent: Agent & { scope?: string }) => {
        delete agent.scope;
      });
      const agents: Agent[] = await tx.table('agents').toArray();
      const active = await tx.table('settings').get('activeAgentId');
      const legacyActive = await tx.table('settings').get('activeTaskAgentId');
      const activeAgentId = [active?.value, legacyActive?.value]
        .find((id) => typeof id === 'string' && agents.some((agent) => agent.id === id))
        ?? agents[0]?.id;
      if (activeAgentId) {
        await tx.table('settings').put({ key: 'activeAgentId', value: activeAgentId });
      }
      await tx.table('settings').delete('activeTaskAgentId');
    });
    // Additive Codex projection. Historic chat migrations are addressed separately
    // before a live upgrade; this version never clears existing user records.
    this.version(15).stores({
      codexSessions: 'appThreadId, nativeThreadId, workspaceRoot, updatedAt',
      codexRuns: 'runId, &clientCommandId, appThreadId, nativeThreadId, nativeTurnId, status, createdAt',
      codexEvents: 'id, epoch, [epoch+sequence], runId, createdAt',
      codexPendingRequests: 'requestId, runId, epoch, status',
      codexOperationReceipts: 'operationId, runId, appThreadId',
    });
    this.version(16).stores({
      codexDocumentIntents: 'operationId, workspaceId, status',
    });
    // New subtasks are explicit. Do not infer links from v13's flattened parentId.
    this.version(17).stores({
      tasks: 'id, title, updatedAt, order, projectId, status, parentTaskId',
    });
    this.version(18).stores({
      chatThreads: 'id, mode, updatedAt, workspaceId, taskId, settingsTab, origin',
    }).upgrade(async (tx) => {
      const nativeIds = new Set((await tx.table('codexSessions').toArray())
        .map((session: { appThreadId: string }) => session.appThreadId));
      for (const run of await tx.table('codexRuns').toArray() as Array<{ appThreadId: string }>) {
        nativeIds.add(run.appThreadId);
      }
      await tx.table('chatThreads').toCollection().modify((thread: ChatThreadMeta) => {
        thread.origin = nativeIds.has(thread.id) ? 'codex' : 'legacy_api';
      });
    });
    this.version(19).stores(CLIENTS_V1_STORES);
    // v20: GitHub mode drafts, workspace selection, and sealed private cache.
    // Tokens are not stored here. Existing tables are left untouched.
    this.version(20).stores(GITHUB_V1_STORES);
  }
}

export const db = new TabsDB();

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.settings.get(key);
  if (row === undefined) return defaultValue;
  return row.value as T;
}

export async function setSetting(key: string, value: string | number | boolean) {
  await db.settings.put({ key, value });
}
