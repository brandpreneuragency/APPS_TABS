// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Workspace } from '../../types';
import { crmFormsDb } from '../../data/crmFormsDb';
import { db } from '../db';
import * as fsAdapter from '../fs-adapter';
import { codexDesktopClient } from './desktopClient';
import { editorRef } from '../../stores/editorRef';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { blankForm } from '../formsService';
import { executeBusinessProposal, prepareBusinessProposal, readBusinessTool,
  reconcileDocumentIntents, rejectBusinessProposal, toolsForScope } from './businessTools';
import type { CodexPendingRequest } from './types';
import type { CodexRunRecord, CodexScope } from './sessionTypes';

const baseScope: CodexScope = {
  appThreadId: 'thread', mode: 'task', taskId: 'project:project-1', projectId: 'project-1',
  workspaceRoot: 'C:/synthetic', permissionProfile: 'readOnly', agentId: 'default',
  context: '', capturedAt: 1,
};

function run(scope: CodexScope = baseScope): CodexRunRecord {
  return { runId: 'run-1', clientCommandId: 'command-1', appThreadId: 'thread',
    nativeThreadId: 'native-thread', nativeTurnId: 'native-turn', executionEpoch: 1,
    status: 'running', scope, userText: 'test', submittedText: 'test', createdAt: 1, updatedAt: 1 };
}

function request(toolName: string, args: Record<string, unknown>, callId = 'call-1'): CodexPendingRequest {
  return { requestId: '1:1', kind: 'businessTool', threadId: 'native-thread',
    turnId: 'native-turn', callId, toolName, details: { arguments: args } };
}

describe('Codex business tool boundary', () => {
  beforeEach(async () => {
    await Promise.all([db.delete(), crmFormsDb.delete()]);
    await Promise.all([db.open(), crmFormsDb.open()]);
    await db.clients.add({ id: 'client-1', name: 'Synthetic client', color: '#fff', createdAt: 1, order: 0 });
    await db.projects.add({ id: 'project-1', name: 'Synthetic project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editorRef.current?.destroy();
    editorRef.current = null;
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  });

  async function selectedDocument() {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Hello world</p>' });
    editorRef.current = editor;
    const content = JSON.stringify(editor.getJSON());
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const workspace: Workspace = { id: 'workspace-1', name: 'Synthetic', connectedFolders: [],
      activeFolderId: null, currentFile: { path: 'C:/synthetic/notes.md', name: 'notes.md', content,
        isDirty: true }, expandedPaths: [], selectedTreePath: null, createdAt: 1, updatedAt: 1, order: 0 };
    await db.workspaces.put(workspace);
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id });
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: workspace.id, selectedText: 'Hello', selectionFrom: 1, selectionTo: 6,
      document: { path: workspace.currentFile!.path, name: 'notes.md', content,
        contentHash, contentComplete: true, isDirty: true, workspaceRevision: 1 } };
    return { editor, scope, contentHash };
  }

  function activateConnectedFolder(scope: CodexScope) {
    const existing = useWorkspaceStore.getState().workspaces.find((row) => row.id === scope.workspaceId);
    const workspace: Workspace = existing
      ? { ...existing, connectedFolders: [{ id: 'folder-1', path: scope.workspaceRoot }],
        activeFolderId: 'folder-1' }
      : { id: scope.workspaceId!, name: 'Synthetic',
        connectedFolders: [{ id: 'folder-1', path: scope.workspaceRoot }],
        activeFolderId: 'folder-1', currentFile: null, expandedPaths: [],
        selectedTreePath: null, createdAt: 1, updatedAt: 1, order: 0 };
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id });
  }

  it('applies an approved selected-text edit once and persists its editor revision', async () => {
    const { editor, scope, contentHash } = await selectedDocument();
    const owner = run(scope);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_replace_selection_v1', { expectedContentHash: contentHash,
        replacement: 'Goodbye' }, 'document-edit'));
    const result = await executeBusinessProposal(owner, proposal);
    expect(result.outcome).toBe('applied');
    expect(editor.getText()).toBe('Goodbye world');
    expect((await db.workspaces.get('workspace-1'))?.currentFile?.isDirty).toBe(true);
    expect((await db.codexDocumentIntents.get(proposal.operationId))?.status).toBe('complete');
    expect((await executeBusinessProposal(owner, proposal)).operationId).toBe(result.operationId);
    expect(editor.getText()).toBe('Goodbye world');
  });

  it('rejects a stale selected-text edit and preserves the current editor content', async () => {
    const { editor, scope, contentHash } = await selectedDocument();
    const owner = run(scope);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_replace_selection_v1', { expectedContentHash: contentHash,
        replacement: 'Changed' }, 'stale-document'));
    editor.commands.insertContentAt(1, 'New ');
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/revision/);
    expect(editor.getText()).toBe('New Hello world');
    expect(await db.codexDocumentIntents.count()).toBe(0);
  });

  it('records a declined document edit without touching the editor', async () => {
    const { editor, scope, contentHash } = await selectedDocument();
    const owner = run(scope);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_replace_selection_v1', { expectedContentHash: contentHash,
        replacement: 'Declined' }, 'declined-document'));
    expect((await rejectBusinessProposal(owner, proposal)).outcome).toBe('rejected');
    expect(editor.getText()).toBe('Hello world');
    expect(await db.codexDocumentIntents.count()).toBe(0);
  });

  it('creates a scoped document once and stores a file intent before the native write', async () => {
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: 'workspace-1', hasConnectedFolder: true };
    activateConnectedFolder(scope);
    let onDisk: string | null = null;
    vi.spyOn(codexDesktopClient, 'scopedDocumentHash').mockImplementation(async () => onDisk);
    const create = vi.spyOn(codexDesktopClient, 'createScopedDocument')
      .mockImplementation(async (_root, fileName, _base64, hash) => {
        onDisk = hash;
        return { path: `C:/synthetic/${fileName}`, sha256: hash };
      });
    vi.spyOn(useWorkspaceStore.getState(), 'refreshWorkspaceDir').mockResolvedValue();
    const owner = run(scope);
    const nativeRequest = request('tabs_document_create_v1',
      { fileName: 'new.md', content: '# Hello' }, 'file-create');
    const proposal = await prepareBusinessProposal(owner, nativeRequest);
    expect(await db.codexDocumentIntents.count()).toBe(0);
    const applied = await executeBusinessProposal(owner, proposal);
    expect(applied.outcome).toBe('applied');
    expect(create).toHaveBeenCalledTimes(1);
    expect((await db.codexDocumentIntents.get(proposal.operationId))?.status).toBe('complete');
    expect((await executeBusinessProposal(owner, proposal)).operationId).toBe(applied.operationId);
    expect(create).toHaveBeenCalledTimes(1);
    await db.codexPendingRequests.put({ requestId: nativeRequest.requestId,
      runId: owner.runId, epoch: 1, request: nativeRequest, status: 'answered', proposal,
      createdAt: 1, updatedAt: 1 });
    expect((await prepareBusinessProposal(owner, nativeRequest)).proposalHash).toBe(proposal.proposalHash);
    await expect(prepareBusinessProposal(owner, request('tabs_document_create_v1',
      { fileName: 'new.md', content: 'Different' }, 'file-create'))).rejects.toThrow(/changed/);
  });

  it('keeps a lost native file reply partial and never writes the matching file twice', async () => {
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: 'workspace-1', hasConnectedFolder: true };
    activateConnectedFolder(scope);
    let onDisk: string | null = null;
    vi.spyOn(codexDesktopClient, 'scopedDocumentHash').mockImplementation(async () => onDisk);
    const create = vi.spyOn(codexDesktopClient, 'createScopedDocument')
      .mockImplementationOnce(async (_root, _name, _base64, hash) => {
        onDisk = hash;
        throw new Error('synthetic bridge loss');
      });
    vi.spyOn(useWorkspaceStore.getState(), 'refreshWorkspaceDir').mockResolvedValue();
    const owner = run(scope);
    await db.codexRuns.put(owner);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_create_v1', { fileName: 'retry.txt', content: 'Synthetic' }, 'lost-write'));
    expect((await executeBusinessProposal(owner, proposal)).outcome).toBe('partial');
    expect((await db.codexDocumentIntents.get(proposal.operationId))?.status).toBe('pending');
    await reconcileDocumentIntents();
    expect((await db.codexOperationReceipts.get(proposal.operationId))?.outcome).toBe('partial');
    expect((await db.codexDocumentIntents.get(proposal.operationId))?.status).toBe('uncertain');
    expect((await executeBusinessProposal(owner, proposal)).outcome).toBe('partial');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reconciles a confirmed native file write after its folder refresh fails', async () => {
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: 'workspace-1', hasConnectedFolder: true };
    activateConnectedFolder(scope);
    let onDisk: string | null = null;
    vi.spyOn(codexDesktopClient, 'scopedDocumentHash').mockImplementation(async () => onDisk);
    const create = vi.spyOn(codexDesktopClient, 'createScopedDocument')
      .mockImplementation(async (_root, fileName, _base64, hash) => {
        onDisk = hash;
        return { path: `C:/synthetic/${fileName}`, sha256: hash };
      });
    vi.spyOn(useWorkspaceStore.getState(), 'refreshWorkspaceDir')
      .mockRejectedValueOnce(new Error('synthetic tree refresh failure'))
      .mockResolvedValue();
    const owner = run(scope);
    await db.codexRuns.put(owner);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_create_v1', { fileName: 'confirmed.md', content: 'Safe' }, 'confirmed'));
    expect((await executeBusinessProposal(owner, proposal)).outcome).toBe('partial');
    expect((await db.codexDocumentIntents.get(proposal.operationId))?.nativeWriteConfirmed).toBe(true);
    await reconcileDocumentIntents();
    expect((await db.codexOperationReceipts.get(proposal.operationId))?.outcome).toBe('applied');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps an approved file intent partial when another file occupies its destination', async () => {
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: 'workspace-1', hasConnectedFolder: true };
    activateConnectedFolder(scope);
    let onDisk: string | null = null;
    vi.spyOn(codexDesktopClient, 'scopedDocumentHash').mockImplementation(async () => onDisk);
    const create = vi.spyOn(codexDesktopClient, 'createScopedDocument');
    const owner = run(scope);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_create_v1', { fileName: 'occupied.md', content: 'Approved' }, 'occupied'));
    onDisk = 'another-file-hash';
    const partial = await executeBusinessProposal(owner, proposal);
    expect(partial.outcome).toBe('partial');
    expect(partial.projection).toBe('failed');
    expect(create).not.toHaveBeenCalled();
    await reconcileDocumentIntents();
    expect((await db.codexOperationReceipts.get(proposal.operationId))?.outcome).toBe('partial');
  });

  it('refuses an export when the selected editor changes after approval preview', async () => {
    const { editor, scope, contentHash } = await selectedDocument();
    scope.hasConnectedFolder = true;
    activateConnectedFolder(scope);
    vi.spyOn(codexDesktopClient, 'scopedDocumentHash').mockResolvedValue(null);
    const owner = run(scope);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_export_v1', { fileName: 'snapshot.md',
        expectedContentHash: contentHash }, 'export-stale'));
    editor.commands.insertContentAt(1, 'New ');
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/revision/);
    expect(await db.codexDocumentIntents.count()).toBe(0);
  });

  it('refuses a file write after the captured connected workspace is switched away', async () => {
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: 'workspace-1', hasConnectedFolder: true };
    activateConnectedFolder(scope);
    vi.spyOn(codexDesktopClient, 'scopedDocumentHash').mockResolvedValue(null);
    const create = vi.spyOn(codexDesktopClient, 'createScopedDocument');
    const owner = run(scope);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_document_create_v1', { fileName: 'later.md', content: 'Later' }, 'switched'));
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/no longer active/);
    expect(await db.codexDocumentIntents.count()).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps task creation and its receipt in the same database and deduplicates the call', async () => {
    const owner = run();
    const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_create_v1', { title: 'Follow up' }));
    const first = await executeBusinessProposal(owner, proposal);
    const repeated = await executeBusinessProposal(owner, proposal);
    expect(first.affectedIds).toEqual(repeated.affectedIds);
    expect(await db.tasks.count()).toBe(1);
    expect((await db.codexOperationReceipts.get(proposal.operationId))?.outcome).toBe('applied');
    expect((await db.tasks.get(first.affectedIds[0]))?.sourceChatMessageId).toBe('codex:user:run-1');
    const changed = await prepareBusinessProposal(owner, request('tabs_tasks_create_v1', { title: 'Different' }));
    await expect(executeBusinessProposal(owner, changed)).rejects.toThrow(/reused/);
  });

  it('creates one-level subtasks only under an unchanged active parent', async () => {
    await db.tasks.add({ id: 'parent', title: 'Parent', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const requestSubtask = request('tabs_tasks_create_v1', {
      title: 'Child', parentTaskId: 'parent',
    }, 'create-subtask');
    const proposal = await prepareBusinessProposal(owner, requestSubtask);
    expect(proposal.targetIds).toEqual(['project-1', 'parent']);
    await db.tasks.update('parent', { updatedAt: 6 });
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/parent changed/);
    await db.tasks.update('parent', { updatedAt: 5 });
    const applied = await executeBusinessProposal(owner, proposal);
    expect(applied.outcome).toBe('applied');
    expect((await db.tasks.get(applied.affectedIds[0]))?.parentTaskId).toBe('parent');
    expect((await executeBusinessProposal(owner, proposal)).affectedIds).toEqual(applied.affectedIds);
    await expect(prepareBusinessProposal(owner, request('tabs_tasks_create_v1', {
      title: 'Grandchild', parentTaskId: applied.affectedIds[0],
    }, 'nested-subtask'))).rejects.toThrow(/top-level/);
    expect(await db.tasks.count()).toBe(2);
  });

  it('keeps a parent and its active subtask in one project', async () => {
    await db.projects.add({ id: 'project-2', name: 'Other project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.tasks.bulkAdd([
      { id: 'parent', title: 'Parent', content: '', status: 'pending',
        importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
        createdAt: 1, updatedAt: 5, order: 0 },
      { id: 'child', title: 'Child', content: '', status: 'pending',
        importance: 'medium', date: '2026-09-23', projectId: 'project-1', parentTaskId: 'parent',
        assignees: [], createdAt: 1, updatedAt: 5, order: 1 },
    ]);
    const owner = run();
    await expect(prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
      taskId: 'parent', expectedUpdatedAt: 5, projectId: 'project-2',
    }, 'move-parent'))).rejects.toThrow(/subtasks/);
    await expect(prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
      taskId: 'child', expectedUpdatedAt: 5, projectId: 'project-2',
    }, 'move-child'))).rejects.toThrow(/parent task/);
    await expect(prepareBusinessProposal(owner, request('tabs_tasks_soft_delete_v1', {
      taskId: 'parent', expectedUpdatedAt: 5,
    }, 'delete-parent'))).rejects.toThrow(/subtasks/);
    expect((await db.tasks.get('parent'))?.deletedAt).toBeUndefined();
    expect(await db.codexOperationReceipts.count()).toBe(0);
  });

  it('previews and undoes an approved task creation exactly once', async () => {
    const owner = run();
    const create = await prepareBusinessProposal(owner,
      request('tabs_tasks_create_v1', { title: 'Undo me' }, 'create-for-undo'));
    const created = await executeBusinessProposal(owner, create);
    const listed = JSON.parse(await readBusinessTool(owner,
      request('tabs_tasks_history_list_v1', {})));
    expect(listed.map((row: { operationId: string }) => row.operationId)).toContain(created.operationId);
    const undo = await prepareBusinessProposal(owner, request('tabs_tasks_undo_v1', {
      operationId: created.operationId,
    }, 'undo-created'));
    expect(undo.before).toMatchObject({ title: 'Undo me' });
    const applied = await executeBusinessProposal(owner, undo);
    expect(applied.outcome).toBe('applied');
    expect((await db.tasks.get(created.affectedIds[0]))?.deletedAt).toBeTypeOf('number');
    expect((await db.codexOperationReceipts.get(created.operationId))?.undoneByOperationId).toBe(undo.operationId);
    expect((await executeBusinessProposal(owner, undo)).operationId).toBe(applied.operationId);
    expect(await db.codexOperationReceipts.count()).toBe(2);
    expect(JSON.parse(await readBusinessTool(owner,
      request('tabs_tasks_history_list_v1', {})))).toEqual([]);
  });

  it('undoes an approved project assignment only while the task is unchanged', async () => {
    await db.projects.add({ id: 'project-2', name: 'Other project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.tasks.add({ id: 'task-undo', title: 'Before', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const update = await prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
      taskId: 'task-undo', expectedUpdatedAt: 5, title: 'After', projectId: 'project-2',
    }, 'move-for-undo'));
    const moved = await executeBusinessProposal(owner, update);
    const undo = await prepareBusinessProposal(owner, request('tabs_tasks_undo_v1', {
      operationId: moved.operationId,
    }, 'undo-move'));
    const changed = (await db.tasks.get('task-undo'))!;
    await db.tasks.update('task-undo', { updatedAt: changed.updatedAt + 1 });
    expect(JSON.parse(await readBusinessTool(owner,
      request('tabs_tasks_history_list_v1', {})))).toEqual([]);
    await expect(executeBusinessProposal(owner, undo)).rejects.toThrow(/changed/);
    await db.tasks.update('task-undo', { updatedAt: changed.updatedAt });
    const result = await executeBusinessProposal(owner, undo);
    expect(result.outcome).toBe('applied');
    expect(await db.tasks.get('task-undo')).toMatchObject({ title: 'Before', projectId: 'project-1' });
    expect(await db.codexOperationReceipts.count()).toBe(2);
  });

  it('undoes an approved soft-delete while preserving the task identity', async () => {
    await db.tasks.add({ id: 'task-trash', title: 'Restore me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const trash = await prepareBusinessProposal(owner, request('tabs_tasks_soft_delete_v1', {
      taskId: 'task-trash', expectedUpdatedAt: 5,
    }, 'trash-for-undo'));
    const deleted = await executeBusinessProposal(owner, trash);
    const undo = await prepareBusinessProposal(owner, request('tabs_tasks_undo_v1', {
      operationId: deleted.operationId,
    }, 'undo-trash'));
    expect((await executeBusinessProposal(owner, undo)).outcome).toBe('applied');
    expect(await db.tasks.get('task-trash')).toMatchObject({ id: 'task-trash', title: 'Restore me' });
    expect((await db.tasks.get('task-trash'))?.deletedAt).toBeUndefined();
  });

  it('returns the recorded partial outcome when task file projection fails', async () => {
    const owner = run();
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_tasks_create_v1', { title: 'Needs file sync' }, 'projection-failure'));
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const failingWrite = vi.spyOn(fsAdapter, 'mkdir')
      .mockRejectedValueOnce(new Error('synthetic disk failure'));
    try {
      const result = await executeBusinessProposal(owner, proposal);
      expect(result.outcome).toBe('partial');
      expect(result.projection).toBe('failed');
      expect((await db.codexOperationReceipts.get(proposal.operationId))?.outcome).toBe('partial');
      expect(await db.tasks.count()).toBe(1);
    } finally {
      failingWrite.mockRestore();
      delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('serializes two conflicting deliveries of one call ID', async () => {
    const owner = run();
    const first = await prepareBusinessProposal(owner,
      request('tabs_tasks_create_v1', { title: 'First' }, 'same-call'));
    const changed = await prepareBusinessProposal(owner,
      request('tabs_tasks_create_v1', { title: 'Changed' }, 'same-call'));
    const results = await Promise.allSettled([
      executeBusinessProposal(owner, first), executeBusinessProposal(owner, changed),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.tasks.count()).toBe(1);
    expect(await db.codexOperationReceipts.count()).toBe(1);
  });

  it('rejects stale task revisions before approval and again before effect', async () => {
    await db.tasks.add({ id: 'task-1', title: 'Original', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    await expect(prepareBusinessProposal(owner,
      request('tabs_tasks_update_v1', { taskId: 'task-1', expectedUpdatedAt: 4, title: 'New' })))
      .rejects.toThrow(/revision/);
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_tasks_update_v1', { taskId: 'task-1', expectedUpdatedAt: 5, title: 'New' }));
    await db.tasks.update('task-1', { updatedAt: 6 });
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/revision/);
    expect((await db.tasks.get('task-1'))?.title).toBe('Original');
    expect(await db.codexOperationReceipts.count()).toBe(0);
  });

  it('assigns a task only to a project under the same client and receipts the move once', async () => {
    await db.projects.add({ id: 'project-2', name: 'Other project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.clients.add({ id: 'client-2', name: 'Other client', color: '#fff', createdAt: 1, order: 1 });
    await db.projects.add({ id: 'project-3', name: 'Outside project', color: '#fff',
      clientId: 'client-2', createdAt: 1, order: 0 });
    await db.tasks.add({ id: 'task-move', title: 'Move me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const listed = JSON.parse(await readBusinessTool(owner, request('tabs_tasks_list_v1', {})));
    expect(listed.projects.map((project: { id: string }) => project.id)).toEqual(['project-1', 'project-2']);
    await expect(prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
      taskId: 'task-move', expectedUpdatedAt: 5, projectId: 'project-3',
    }, 'outside-client'))).rejects.toThrow(/outside the task client/);
    const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
      taskId: 'task-move', expectedUpdatedAt: 5, projectId: 'project-2',
    }, 'assign-project'));
    expect(proposal.targetIds).toEqual(['task-move', 'project-2']);
    expect(proposal.summary).toContain('Other project');
    const first = await executeBusinessProposal(owner, proposal);
    expect(first.outcome).toBe('applied');
    expect((await db.tasks.get('task-move'))?.projectId).toBe('project-2');
    expect((await executeBusinessProposal(owner, proposal)).operationId).toBe(first.operationId);
    expect(await db.codexOperationReceipts.count()).toBe(1);
  });

  it('rejects a project assignment when the destination client changes after approval', async () => {
    await db.projects.add({ id: 'project-2', name: 'Other project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.clients.add({ id: 'client-2', name: 'Other client', color: '#fff', createdAt: 1, order: 1 });
    await db.tasks.add({ id: 'task-move', title: 'Move me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
      taskId: 'task-move', expectedUpdatedAt: 5, projectId: 'project-2',
    }, 'changed-client'));
    await db.projects.update('project-2', { clientId: 'client-2' });
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/assignment changed/);
    expect((await db.tasks.get('task-move'))?.projectId).toBe('project-1');
    expect(await db.codexOperationReceipts.count()).toBe(0);
  });

  it('rejects project assignments whose sanitized mirror folders overlap', async () => {
    await db.projects.update('project-1', { name: 'Synthetic/project' });
    await db.projects.add({ id: 'project-2', name: 'Synthetic:project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.tasks.add({ id: 'task-move', title: 'Move me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const call = request('tabs_tasks_update_v1', {
      taskId: 'task-move', expectedUpdatedAt: 5, projectId: 'project-2',
    }, 'overlapping-mirror');
    await expect(prepareBusinessProposal(owner, call)).rejects.toThrow(/mirror/);
    await db.projects.update('project-2', { name: 'Other project' });
    const proposal = await prepareBusinessProposal(owner, call);
    await db.projects.update('project-2', { name: 'Synthetic:project' });
    await expect(executeBusinessProposal(owner, proposal)).rejects.toThrow(/assignment changed/);
    expect((await db.tasks.get('task-move'))?.projectId).toBe('project-1');
    expect(await db.codexOperationReceipts.count()).toBe(0);
  });

  it('retries a partial project mirror move without deleting unrelated files', async () => {
    await db.projects.add({ id: 'project-2', name: 'Other project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.tasks.add({ id: 'task-move', title: 'Move me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const oldFile = 'TASKS/Synthetic client/Synthetic project/task-move/task.md';
    const newFile = 'TASKS/Synthetic client/Other project/task-move/task.md';
    const unrelated = 'TASKS/Synthetic client/Synthetic project/task-move/personal.txt';
    const files = new Map([[oldFile, '# Move me\n\n'], [unrelated, 'Keep this']]);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(fsAdapter, 'exists').mockImplementation(async (path) => files.has(path));
    vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error('Synthetic file is absent');
      return content;
    });
    vi.spyOn(fsAdapter, 'mkdir').mockResolvedValue();
    vi.spyOn(fsAdapter, 'writeTextFile').mockImplementation(async (path, content) => {
      files.set(path, content);
    });
    const remove = vi.spyOn(fsAdapter, 'remove')
      .mockRejectedValueOnce(new Error('synthetic removal failure'))
      .mockImplementation(async (path) => { files.delete(path); });
    try {
      const owner = run();
      const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
        taskId: 'task-move', expectedUpdatedAt: 5, projectId: 'project-2',
      }, 'mirror-retry'));
      const first = await executeBusinessProposal(owner, proposal);
      expect(first.outcome).toBe('partial');
      expect(first.projection).toBe('failed');
      expect(files.get(newFile)).toBe('# Move me\n\n');
      expect(files.has(oldFile)).toBe(true);
      const second = await executeBusinessProposal(owner, proposal);
      expect(second.outcome).toBe('applied');
      expect(remove).toHaveBeenCalledWith(oldFile);
      expect(files.has(oldFile)).toBe(false);
      expect(files.get(unrelated)).toBe('Keep this');
      expect((await db.tasks.get('task-move'))?.projectId).toBe('project-2');
      expect(await db.codexOperationReceipts.count()).toBe(1);
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('keeps an externally edited old task mirror and reports a partial assignment', async () => {
    await db.projects.add({ id: 'project-2', name: 'Other project', color: '#fff',
      clientId: 'client-1', createdAt: 1, order: 1 });
    await db.tasks.add({ id: 'task-move', title: 'Move me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const oldFile = 'TASKS/Synthetic client/Synthetic project/task-move/task.md';
    const files = new Map([[oldFile, 'Personal edit']]);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(fsAdapter, 'exists').mockImplementation(async (path) => files.has(path));
    vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async (path) => files.get(path) ?? '');
    const write = vi.spyOn(fsAdapter, 'writeTextFile');
    const remove = vi.spyOn(fsAdapter, 'remove');
    try {
      const owner = run();
      const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
        taskId: 'task-move', expectedUpdatedAt: 5, projectId: 'project-2',
      }, 'external-edit'));
      const result = await executeBusinessProposal(owner, proposal);
      expect(result.outcome).toBe('partial');
      expect(result.projectionError).toMatch(/changed outside TABS/);
      expect(files.get(oldFile)).toBe('Personal edit');
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect((await db.tasks.get('task-move'))?.projectId).toBe('project-2');
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('preserves an external edit during a same-project update and resumes after it is resolved', async () => {
    await db.tasks.add({ id: 'task-edit', title: 'Original', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const taskFile = 'TASKS/Synthetic client/Synthetic project/task-edit/task.md';
    const files = new Map([[taskFile, 'Personal edit']]);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(fsAdapter, 'exists').mockImplementation(async (path) => files.has(path));
    vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async (path) => files.get(path) ?? '');
    vi.spyOn(fsAdapter, 'mkdir').mockResolvedValue();
    const write = vi.spyOn(fsAdapter, 'writeTextFile').mockImplementation(async (path, content) => {
      files.set(path, content);
    });
    try {
      const owner = run();
      const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_update_v1', {
        taskId: 'task-edit', expectedUpdatedAt: 5, title: 'Updated',
      }, 'external-same-project'));
      const first = await executeBusinessProposal(owner, proposal);
      expect(first.outcome).toBe('partial');
      expect(first.projectionError).toMatch(/already contains different content/);
      expect(files.get(taskFile)).toBe('Personal edit');
      expect(write).not.toHaveBeenCalled();
      files.set(taskFile, '# Original\n\n');
      const second = await executeBusinessProposal(owner, proposal);
      expect(second.outcome).toBe('applied');
      expect(files.get(taskFile)).toBe('# Updated\n\n');
      expect((await db.tasks.get('task-edit'))?.title).toBe('Updated');
      expect(await db.codexOperationReceipts.count()).toBe(1);
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('leaves a conflicting task mirror untouched during task creation', async () => {
    const owner = run();
    const proposal = await prepareBusinessProposal(owner,
      request('tabs_tasks_create_v1', { title: 'New task' }, 'create-file-collision'));
    const taskFile = `TASKS/Synthetic client/Synthetic project/codex_${proposal.proposalHash.slice(0, 12)}/task.md`;
    const files = new Map([[taskFile, 'Existing personal content']]);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(fsAdapter, 'exists').mockImplementation(async (path) => files.has(path));
    vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async (path) => files.get(path) ?? '');
    const write = vi.spyOn(fsAdapter, 'writeTextFile');
    try {
      const result = await executeBusinessProposal(owner, proposal);
      expect(result.outcome).toBe('partial');
      expect(result.projectionError).toMatch(/already contains different content/);
      expect(files.get(taskFile)).toBe('Existing personal content');
      expect(write).not.toHaveBeenCalled();
      expect(await db.tasks.count()).toBe(1);
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('soft-deletes only the generated task mirror and keeps other task files', async () => {
    await db.tasks.add({ id: 'task-trash', title: 'Existing', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const taskFile = 'TASKS/Synthetic client/Synthetic project/task-trash/task.md';
    const personalFile = 'TASKS/Synthetic client/Synthetic project/task-trash/personal.txt';
    const files = new Map([[taskFile, '# Existing\n\n'], [personalFile, 'Keep this']]);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(fsAdapter, 'exists').mockImplementation(async (path) => files.has(path));
    vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async (path) => files.get(path) ?? '');
    vi.spyOn(fsAdapter, 'mkdir').mockResolvedValue();
    vi.spyOn(fsAdapter, 'writeTextFile').mockImplementation(async (path, content) => {
      files.set(path, content);
    });
    const remove = vi.spyOn(fsAdapter, 'remove').mockImplementation(async (path) => {
      files.delete(path);
    });
    try {
      const owner = run();
      const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_soft_delete_v1', {
        taskId: 'task-trash', expectedUpdatedAt: 5,
      }, 'safe-trash'));
      const result = await executeBusinessProposal(owner, proposal);
      expect(result.outcome).toBe('applied');
      expect(remove).toHaveBeenCalledWith(taskFile);
      expect(remove).not.toHaveBeenCalledWith(expect.any(String), true);
      expect(files.has(taskFile)).toBe(false);
      expect(files.get(personalFile)).toBe('Keep this');
      expect((await db.tasks.get('task-trash'))?.deletedAt).toBeTypeOf('number');
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('applies comments once and moves an approved task to trash with a receipt', async () => {
    await db.tasks.add({ id: 'task-2', title: 'Existing', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run();
    const comment = await prepareBusinessProposal(owner, request('tabs_tasks_comment_v1',
      { taskId: 'task-2', expectedUpdatedAt: 5, text: 'Please review' }, 'comment'));
    await executeBusinessProposal(owner, comment);
    await executeBusinessProposal(owner, comment);
    expect(await db.taskComments.count()).toBe(1);
    const trash = await prepareBusinessProposal(owner, request('tabs_tasks_soft_delete_v1',
      { taskId: 'task-2', expectedUpdatedAt: 5 }, 'trash'));
    await executeBusinessProposal(owner, trash);
    expect((await db.tasks.get('task-2'))?.deletedAt).toBeTypeOf('number');
    expect(await db.codexOperationReceipts.count()).toBe(2);
  });

  it('limits tools by captured scope and refuses a wrong native turn', async () => {
    const owner = run();
    expect(toolsForScope(baseScope).map((tool) => tool.name)).toContain('tabs_tasks_create_v1');
    expect(toolsForScope(baseScope).map((tool) => tool.name)).not.toContain('tabs_forms_create_draft_v1');
    await expect(prepareBusinessProposal(owner,
      request('tabs_forms_create_draft_v1', { name: 'Wrong page' }))).rejects.toThrow(/outside/);
    const wrong = request('tabs_tasks_create_v1', { title: 'Wrong turn' });
    wrong.turnId = 'different';
    await expect(prepareBusinessProposal(owner, wrong)).rejects.toThrow(/outside/);
  });

  it('records a rejected proposal without changing data', async () => {
    const owner = run();
    const proposal = await prepareBusinessProposal(owner, request('tabs_tasks_create_v1', { title: 'Declined' }));
    const result = await rejectBusinessProposal(owner, proposal);
    expect(result.outcome).toBe('rejected');
    expect(await db.tasks.count()).toBe(0);
    expect((await rejectBusinessProposal(owner, proposal)).operationId).toBe(result.operationId);
  });

  it('creates CRM and Forms records with receipts in their owning database', async () => {
    const crmScope = { ...baseScope, taskId: 'page:contacts' };
    const crmRun = run(crmScope);
    const contactProposal = await prepareBusinessProposal(crmRun,
      request('tabs_crm_create_contact_v1', { firstName: 'Ada', lastName: 'Lovelace' }));
    await executeBusinessProposal(crmRun, contactProposal);
    await executeBusinessProposal(crmRun, contactProposal);
    expect(await crmFormsDb.crmContacts.count()).toBe(1);
    expect(await crmFormsDb.codexOperationReceipts.count()).toBe(1);
    const formsRun = run({ ...baseScope, taskId: 'page:forms' });
    const formProposal = await prepareBusinessProposal(formsRun,
      request('tabs_forms_create_draft_v1', { name: 'Intake' }, 'call-2'));
    await executeBusinessProposal(formsRun, formProposal);
    expect((await crmFormsDb.forms.toArray())[0].status).toBe('draft');
    expect(await crmFormsDb.codexOperationReceipts.count()).toBe(2);
  });

  it('creates a CRM company and deal, then updates a selected draft form with revision checks', async () => {
    const crmRun = run({ ...baseScope, taskId: 'page:companies' });
    const company = await prepareBusinessProposal(crmRun,
      request('tabs_crm_create_company_v1', { name: 'Synthetic Ltd' }, 'company'));
    await executeBusinessProposal(crmRun, company);
    const deal = await prepareBusinessProposal(crmRun,
      request('tabs_crm_create_deal_v1', { title: 'Synthetic deal', stage: 'new' }, 'deal'));
    await executeBusinessProposal(crmRun, deal);
    expect(await crmFormsDb.crmCompanies.count()).toBe(1);
    expect(await crmFormsDb.crmDeals.count()).toBe(1);

    const formRun = run({ ...baseScope, taskId: 'page:forms' });
    const create = await prepareBusinessProposal(formRun,
      request('tabs_forms_create_draft_v1', { name: 'Intake' }, 'form-create'));
    const created = await executeBusinessProposal(formRun, create);
    const form = (await crmFormsDb.forms.get(created.affectedIds[0]))!;
    const selected = run({ ...formRun.scope, formsSelection: { formId: form.id } });
    const update = await prepareBusinessProposal(selected,
      request('tabs_forms_update_draft_v1', { formId: form.id,
        expectedUpdatedAt: form.updatedAt, name: 'Updated intake' }, 'form-update'));
    await crmFormsDb.forms.update(form.id, { updatedAt: 'later' });
    await expect(executeBusinessProposal(selected, update)).rejects.toThrow(/revision/);
    expect((await crmFormsDb.forms.get(form.id))?.name).toBe('Intake');
  });

  it('updates a selected CRM contact, attaches a note and task link without duplicate effects', async () => {
    await crmFormsDb.crmContacts.add({ id: 'contact-1', firstName: 'Old', lastName: 'Name',
      tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    await db.tasks.add({ id: 'task-link', title: 'Call back', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const owner = run({ ...baseScope, taskId: 'page:contacts', crmSelection: { contactId: 'contact-1' } });
    const update = await prepareBusinessProposal(owner, request('tabs_crm_update_v1', {
      entity: 'contact', id: 'contact-1', expectedUpdatedAt: '2026-01-01T00:00:00Z',
      changes: { firstName: 'New' },
    }, 'update-contact'));
    await executeBusinessProposal(owner, update);
    expect((await crmFormsDb.crmContacts.get('contact-1'))?.firstName).toBe('New');
    const revision = (await crmFormsDb.crmContacts.get('contact-1'))!.updatedAt;
    const note = await prepareBusinessProposal(owner, request('tabs_crm_add_note_v1', {
      entity: 'contact', id: 'contact-1', expectedUpdatedAt: revision, body: 'Follow up tomorrow',
    }, 'note'));
    await executeBusinessProposal(owner, note);
    await executeBusinessProposal(owner, note);
    expect(await crmFormsDb.crmNotes.count()).toBe(1);
    const linkRevision = (await crmFormsDb.crmContacts.get('contact-1'))!.updatedAt;
    const link = await prepareBusinessProposal(owner, request('tabs_crm_link_task_v1', {
      entity: 'contact', id: 'contact-1', expectedUpdatedAt: linkRevision, taskId: 'task-link',
    }, 'link'));
    await executeBusinessProposal(owner, link);
    await executeBusinessProposal(owner, link);
    expect(await crmFormsDb.crmTaskLinks.count()).toBe(1);
    expect(await crmFormsDb.codexOperationReceipts.count()).toBe(3);
  });

  it('records independent task and CRM steps for one form submission follow-up', async () => {
    const form = blankForm('Lead intake');
    await crmFormsDb.forms.add(form);
    await crmFormsDb.crmLeads.add({ id: 'lead-1', title: 'Synthetic lead', status: 'new', stage: 'new',
      tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    await crmFormsDb.formSubmissions.add({ id: 'submission-1', formId: form.id, status: 'new',
      fields: { email: 'synthetic@example.test' }, hiddenFields: {}, leadId: 'lead-1',
      createdAt: '2026-01-01T00:00:00Z' });
    const owner = run({ ...baseScope, taskId: 'page:forms',
      formsSelection: { formId: form.id, submissionId: 'submission-1' } });
    const proposal = await prepareBusinessProposal(owner, request('tabs_forms_follow_up_task_v1', {
      submissionId: 'submission-1', expectedFormUpdatedAt: form.updatedAt,
      taskTitle: 'Follow up on lead',
    }, 'follow-up'));
    const first = await executeBusinessProposal(owner, proposal);
    const repeated = await executeBusinessProposal(owner, proposal);
    expect(first.outcome).toBe('applied');
    expect(repeated.affectedIds).toEqual(first.affectedIds);
    expect(await db.tasks.count()).toBe(1);
    expect(await crmFormsDb.crmTaskLinks.count()).toBe(1);
    expect(await db.codexOperationReceipts.count()).toBe(1);
    expect(await crmFormsDb.codexOperationReceipts.count()).toBe(1);
  });

  it('reports a partial cross-database step and resumes it without a second task', async () => {
    const form = blankForm('Lead intake');
    await crmFormsDb.forms.add(form);
    await crmFormsDb.crmLeads.add({ id: 'lead-retry', title: 'Synthetic lead', status: 'new', stage: 'new',
      tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    await crmFormsDb.formSubmissions.add({ id: 'submission-retry', formId: form.id, status: 'new',
      fields: {}, hiddenFields: {}, leadId: 'lead-retry', createdAt: '2026-01-01T00:00:00Z' });
    const owner = run({ ...baseScope, taskId: 'page:forms',
      formsSelection: { formId: form.id, submissionId: 'submission-retry' } });
    const proposal = await prepareBusinessProposal(owner, request('tabs_forms_follow_up_task_v1', {
      submissionId: 'submission-retry', expectedFormUpdatedAt: form.updatedAt,
      taskTitle: 'Follow up safely',
    }, 'partial-follow-up'));
    const failingAdd = vi.spyOn(crmFormsDb.crmTaskLinks, 'add')
      .mockRejectedValueOnce(new Error('synthetic CRM failure'));
    const partial = await executeBusinessProposal(owner, proposal);
    expect(partial.outcome).toBe('partial');
    expect(await db.tasks.count()).toBe(1);
    expect(await crmFormsDb.crmTaskLinks.count()).toBe(0);
    failingAdd.mockRestore();
    const recovered = await executeBusinessProposal(owner, proposal);
    expect(recovered.outcome).toBe('applied');
    expect(await db.tasks.count()).toBe(1);
    expect(await crmFormsDb.crmTaskLinks.count()).toBe(1);
  });

  it('reads only captured document content and allowlisted settings', async () => {
    const documentScope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      document: { path: 'C:/synthetic/notes.md', name: 'notes.md', contentHash: 'hash',
        content: 'Unsaved text', isDirty: true, workspaceRevision: 1 } };
    const result = await readBusinessTool(run(documentScope), request('tabs_document_read_v1', {}));
    expect(result).toContain('Unsaved text');
    await expect(readBusinessTool(run(documentScope), request('tabs_settings_read_v1', {}))).rejects.toThrow(/outside/);
  });

  it('lists documents only under the connected folder captured for the turn', async () => {
    const scope: CodexScope = { ...baseScope, mode: 'writer', taskId: undefined,
      workspaceId: 'workspace-1', hasConnectedFolder: true,
      workspaceRoot: 'C:/synthetic/notes' };
    activateConnectedFolder(scope);
    const listed = vi.spyOn(codexDesktopClient, 'listScopedDocuments').mockResolvedValueOnce([
      { path: 'C:/synthetic/notes/plan.md', name: 'plan.md', relativePath: 'plan.md', size: 4 },
    ]);
    try {
      expect(toolsForScope(scope).map((tool) => tool.name)).toContain('tabs_documents_list_v1');
      const result = await readBusinessTool(run(scope), request('tabs_documents_list_v1', {}));
      expect(JSON.parse(result)).toEqual({ workspaceRoot: scope.workspaceRoot, documents: [
        { path: 'C:/synthetic/notes/plan.md', name: 'plan.md', relativePath: 'plan.md', size: 4 },
      ] });
      expect(listed).toHaveBeenCalledWith(scope.workspaceRoot);
      await expect(readBusinessTool(run({ ...scope, hasConnectedFolder: false }),
        request('tabs_documents_list_v1', {}))).rejects.toThrow(/outside/);
    } finally {
      listed.mockRestore();
    }
  });
});
