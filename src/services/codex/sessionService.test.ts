import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../types';
import type { CodexHostEvent } from './types';

const fake = vi.hoisted(() => ({
  listener: null as ((event: CodexHostEvent) => void) | null,
  epoch: 2,
  startTurn: vi.fn(async () => 'native-turn-1'),
  connect: vi.fn(async (workspaceRoot: string) => ({
    epoch: 2, executablePath: 'synthetic-codex.exe', version: 'codex-cli 0.155.1',
    workspaceRoot, authMode: 'chatgpt' as const, modelProvider: 'openai' as const,
  })),
  interruptTurn: vi.fn(async () => undefined),
  readThread: vi.fn(async () => [] as { id: string; status: string; assistantItems: { id: string; text: string }[] }[]),
  diskHash: null as string | null,
  createScopedDocument: vi.fn(async (_root: string, fileName: string, _base64: string, hash: string) => {
    fake.diskHash = hash;
    return { path: `C:/synthetic-root-a/${fileName}`, sha256: hash };
  }),
  replyRequest: vi.fn(async () => undefined),
}));

vi.mock('../runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('./desktopClient', () => ({
  codexDesktopClient: {
    status: vi.fn(async () => null),
    connect: fake.connect, disconnect: vi.fn(async () => undefined),
    listModels: vi.fn(async () => [{ id: 'fake-model', displayName: 'Fake', isDefault: true, reasoningEfforts: ['low'] }]),
    startThread: vi.fn(async () => 'native-thread-1'),
    resumeThread: vi.fn(async (_epoch: number, threadId: string) => threadId),
    startTurn: fake.startTurn,
    interruptTurn: fake.interruptTurn,
    ackEvents: vi.fn(async () => undefined),
    readThread: fake.readThread,
    scopedDocumentHash: vi.fn(async () => fake.diskHash),
    createScopedDocument: fake.createScopedDocument,
    replyRequest: fake.replyRequest,
  },
  subscribeCodexEvents: vi.fn(async (_epoch: number, _cursor: number, listener: (event: CodexHostEvent) => void) => {
    fake.listener = listener;
    return { stop: () => { fake.listener = null; }, replayGap: false };
  }),
}));

import { db } from '../db';
import { crmFormsDb } from '../../data/crmFormsDb';
import * as fsAdapter from '../fs-adapter';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { CodexSessionService } from './sessionService';
import type { CodexScope } from './sessionTypes';

const scope: CodexScope = {
  appThreadId: 'app-thread-1', mode: 'writer', workspaceId: 'workspace-a',
  workspaceRoot: 'C:/synthetic-root-a', permissionProfile: 'readOnly',
  agentId: 'default_agent', context: 'synthetic context', capturedAt: 1,
};

async function seedThread() {
  await db.chatThreads.add({ id: scope.appThreadId, mode: 'writer', workspaceId: scope.workspaceId,
    title: 'Synthetic', createdAt: 1, updatedAt: 1 });
}

describe('Codex durable session service', () => {
  beforeEach(async () => {
    fake.listener = null;
    fake.startTurn.mockReset();
    fake.startTurn.mockResolvedValue('native-turn-1');
    fake.connect.mockClear();
    fake.interruptTurn.mockClear();
    fake.readThread.mockReset();
    fake.readThread.mockResolvedValue([]);
    fake.diskHash = null;
    fake.createScopedDocument.mockClear();
    fake.replyRequest.mockClear();
    await Promise.all([db.delete(), crmFormsDb.delete()]);
    await Promise.all([db.open(), crmFormsDb.open()]);
    await seedThread();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  });

  it('deduplicates command IDs and replayed deltas while keeping captured workspace', async () => {
    const service = new CodexSessionService();
    await service.start();
    const input = { clientCommandId: 'command-1', scope, text: 'Hello' };
    const first = await service.submit(input);
    const duplicate = await service.submit(input);
    expect(duplicate.runId).toBe(first.runId);
    await vi.waitFor(() => expect(fake.startTurn).toHaveBeenCalledTimes(1));
    expect(fake.connect).toHaveBeenCalledWith('C:/synthetic-root-a', undefined);
    const delta: CodexHostEvent = { epoch: 2, sequence: 1, kind: 'textDelta',
      threadId: 'native-thread-1', turnId: 'native-turn-1', itemId: 'item-1', delta: 'Reply' };
    fake.listener?.(delta);
    fake.listener?.(delta);
    fake.listener?.({ epoch: 2, sequence: 2, kind: 'turnStatus', threadId: 'native-thread-1',
      turnId: 'native-turn-1', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(first.runId))?.status).toBe('completed'));
    const messages = await db.chatMessages.where('threadId').equals(scope.appThreadId).toArray();
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(messages.find((message) => message.role === 'assistant')?.content).toBe('Reply');
    expect(await db.codexEvents.count()).toBe(2);
  });

  it('quarantines an uncertain native submit and never retries it', async () => {
    fake.startTurn.mockRejectedValueOnce(new Error('synthetic pipe loss'));
    const service = new CodexSessionService();
    await service.start();
    const run = await service.submit({ clientCommandId: 'command-2', scope, text: 'Hello' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.status).toBe('recovery_required'));
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
    await service.start();
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps one native thread across two turns and a view remount', async () => {
    fake.startTurn.mockResolvedValueOnce('native-turn-1').mockResolvedValueOnce('native-turn-2');
    const service = new CodexSessionService();
    await service.start();
    const unmount = service.subscribe(() => undefined);
    const first = await service.submit({ clientCommandId: 'first-command', scope, text: 'First' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(first.runId))?.nativeTurnId).toBe('native-turn-1'));
    unmount();
    const remounted = service.subscribe(() => undefined);
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'turnStatus', threadId: 'native-thread-1',
      turnId: 'native-turn-1', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(first.runId))?.status).toBe('completed'));
    const second = await service.submit({ clientCommandId: 'second-command', scope, text: 'Second' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(second.runId))?.nativeTurnId).toBe('native-turn-2'));
    fake.listener?.({ epoch: 2, sequence: 2, kind: 'turnStatus', threadId: 'native-thread-1',
      turnId: 'native-turn-2', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(second.runId))?.status).toBe('completed'));
    expect(fake.startTurn).toHaveBeenCalledTimes(2);
    expect((await db.codexSessions.toArray())).toHaveLength(1);
    remounted();
  });

  it('does not change a native thread from read only to writable access', async () => {
    const service = new CodexSessionService();
    await service.start();
    const first = await service.submit({ clientCommandId: 'access-first', scope, text: 'First' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(first.runId))?.nativeTurnId).toBe('native-turn-1'));
    expect((await db.codexSessions.get(scope.appThreadId))?.permissionProfile).toBe('readOnly');
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'turnStatus', threadId: 'native-thread-1',
      turnId: 'native-turn-1', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(first.runId))?.status).toBe('completed'));
    const second = await service.submit({ clientCommandId: 'access-second',
      scope: { ...scope, permissionProfile: 'workspaceWrite' }, text: 'Second' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(second.runId))?.status).toBe('failed'));
    expect((await db.codexRuns.get(second.runId))?.error).toContain('new-thread handoff');
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
  });

  it('passes a captured image to the native turn exactly once', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRRkAAAAASUVORK5CYII=';
    const service = new CodexSessionService();
    await service.start();
    const run = await service.submit({ clientCommandId: 'image-command', text: 'Describe the synthetic pixel',
      scope: { ...scope, attachments: [{ kind: 'image', name: 'pixel.png', mimeType: 'image/png', dataUrl: image }] } });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
    expect(fake.startTurn).toHaveBeenCalledWith(expect.objectContaining({ images: [image] }));
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
  });

  it('invalidates a pending approval after renderer restoration', async () => {
    const service = new CodexSessionService();
    await service.start();
    const run = await service.submit({ clientCommandId: 'command-3', scope, text: 'Hello' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'request', request: {
      requestId: '2:1', kind: 'fileChangeApproval', threadId: 'native-thread-1',
      turnId: 'native-turn-1', details: { reason: 'Synthetic only' },
    } });
    await vi.waitFor(async () => expect((await db.codexPendingRequests.get('2:1'))?.status).toBe('pending'));
    const restored = new CodexSessionService();
    await restored.start();
    expect((await db.codexPendingRequests.get('2:1'))?.status).toBe('invalidated');
    await expect(restored.reply('2:1', { kind: 'fileChangeApproval', decision: 'accept' })).rejects.toThrow();
    fake.listener?.({ epoch: 2, sequence: 2, kind: 'request', request: {
      requestId: '2:2', kind: 'fileChangeApproval', threadId: 'native-thread-1',
      turnId: 'native-turn-1', details: { reason: 'Late native request' },
    } });
    await vi.waitFor(async () => expect(await db.codexEvents.get('2:2')).toBeTruthy());
    expect(await db.codexPendingRequests.get('2:2')).toBeUndefined();
    expect((await db.codexRuns.get(run.runId))?.status).toBe('recovery_required');
    expect(fake.interruptTurn).not.toHaveBeenCalled();
  });

  it('reconciles native assistant items once after an interrupted event stream', async () => {
    const service = new CodexSessionService();
    await service.start();
    const run = await service.submit({ clientCommandId: 'recovery-command', scope, text: 'Hello' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'status', status: 'closed', message: 'synthetic pipe loss' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.status).toBe('recovery_required'));
    fake.readThread.mockResolvedValue([{ id: 'native-turn-1', status: 'completed',
      assistantItems: [{ id: 'item-recovered', text: 'Recovered reply' }] }]);
    await service.reconcile(run.runId);
    expect((await db.codexRuns.get(run.runId))?.status).toBe('completed');
    const messages = await db.chatMessages.where('threadId').equals(scope.appThreadId).toArray();
    expect(messages.filter((row) => row.role === 'assistant').map((row) => row.content)).toEqual(['Recovered reply']);
    expect(fake.startTurn).toHaveBeenCalledTimes(1);
  });

  it('takes a fake native document tool request through approval to a persisted receipt', async () => {
    const service = new CodexSessionService();
    await service.start();
    const captured: CodexScope = { ...scope, hasConnectedFolder: true };
    const workspace: Workspace = { id: 'workspace-a', name: 'Synthetic',
      connectedFolders: [{ id: 'folder-a', path: captured.workspaceRoot }],
      activeFolderId: 'folder-a', currentFile: null, expandedPaths: [],
      selectedTreePath: null, createdAt: 1, updatedAt: 1, order: 0 };
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id });
    const run = await service.submit({ clientCommandId: 'native-document-command',
      scope: captured, text: 'Create a document' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'request', request: {
      requestId: '2:document', kind: 'businessTool', threadId: 'native-thread-1',
      turnId: 'native-turn-1', callId: 'document-1', toolName: 'tabs_document_create_v1',
      details: { arguments: { fileName: 'native.md', content: 'Visible content' } },
    } });
    await vi.waitFor(async () => expect((await db.codexPendingRequests.get('2:document'))?.proposal).toBeTruthy());
    await service.decideBusiness('2:document', true);
    expect(fake.createScopedDocument).toHaveBeenCalledTimes(1);
    expect((await db.codexOperationReceipts.get(`codex:${run.runId}:document-1`))?.outcome).toBe('applied');
    expect((await db.codexPendingRequests.get('2:document'))?.status).toBe('answered');
    expect(fake.replyRequest).toHaveBeenCalledWith(2, '2:document',
      expect.objectContaining({ kind: 'businessTool', success: true }));
    fake.listener?.({ epoch: 2, sequence: 2, kind: 'turnStatus',
      threadId: 'native-thread-1', turnId: 'native-turn-1', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.status).toBe('completed'));
    await service.disconnect();
  });

  it('takes a native task assignment request through approval and persists its project', async () => {
    await db.clients.add({ id: 'client-1', name: 'Synthetic client', color: '#fff', createdAt: 1, order: 0 });
    await db.projects.bulkAdd([
      { id: 'project-1', name: 'First', clientId: 'client-1', color: '#fff', createdAt: 1, order: 0 },
      { id: 'project-2', name: 'Second', clientId: 'client-1', color: '#fff', createdAt: 1, order: 1 },
    ]);
    await db.tasks.add({ id: 'task-1', title: 'Assign me', content: '', status: 'pending',
      importance: 'medium', date: '2026-09-23', projectId: 'project-1', assignees: [],
      createdAt: 1, updatedAt: 5, order: 0 });
    const captured: CodexScope = { ...scope, appThreadId: 'task-thread', mode: 'task',
      taskId: 'project:project-1', projectId: 'project-1', clientId: 'client-1' };
    await db.chatThreads.add({ id: captured.appThreadId, mode: 'task', taskId: captured.taskId,
      title: 'Synthetic task', createdAt: 1, updatedAt: 1 });
    const files = new Map<string, string>();
    const exists = vi.spyOn(fsAdapter, 'exists').mockImplementation(async (path) => files.has(path));
    const read = vi.spyOn(fsAdapter, 'readTextFile').mockImplementation(async (path) => files.get(path) ?? '');
    const mkdir = vi.spyOn(fsAdapter, 'mkdir').mockResolvedValue();
    const write = vi.spyOn(fsAdapter, 'writeTextFile').mockImplementation(async (path, content) => {
      files.set(path, content);
    });
    try {
      const service = new CodexSessionService();
      await service.start();
      const run = await service.submit({ clientCommandId: 'native-assignment-command',
        scope: captured, text: 'Assign the task' });
      await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
      fake.listener?.({ epoch: 2, sequence: 1, kind: 'request', request: {
        requestId: '2:assign', kind: 'businessTool', threadId: 'native-thread-1',
        turnId: 'native-turn-1', callId: 'assign-1', toolName: 'tabs_tasks_update_v1',
        details: { arguments: { taskId: 'task-1', expectedUpdatedAt: 5, projectId: 'project-2' } },
      } });
      await vi.waitFor(async () => expect((await db.codexPendingRequests.get('2:assign'))?.proposal).toBeTruthy());
      await service.decideBusiness('2:assign', true);
      expect((await db.tasks.get('task-1'))?.projectId).toBe('project-2');
      expect((await db.codexOperationReceipts.get(`codex:${run.runId}:assign-1`))?.outcome).toBe('applied');
      expect(fake.replyRequest).toHaveBeenCalledWith(2, '2:assign',
        expect.objectContaining({ kind: 'businessTool', success: true }));
      fake.listener?.({ epoch: 2, sequence: 2, kind: 'turnStatus',
        threadId: 'native-thread-1', turnId: 'native-turn-1', status: 'completed' });
      await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.status).toBe('completed'));
      await service.disconnect();
    } finally {
      exists.mockRestore(); read.mockRestore(); mkdir.mockRestore(); write.mockRestore();
    }
  });

  it('takes a native CRM request through approval to a persisted contact', async () => {
    await crmFormsDb.crmContacts.add({ id: 'contact-1', firstName: 'Before', lastName: 'Person',
      tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const captured: CodexScope = { ...scope, appThreadId: 'crm-thread', taskId: 'page:contacts',
      crmSelection: { contactId: 'contact-1' } };
    await db.chatThreads.add({ id: captured.appThreadId, mode: 'writer', taskId: captured.taskId,
      title: 'Synthetic CRM', createdAt: 1, updatedAt: 1 });
    const service = new CodexSessionService();
    await service.start();
    const run = await service.submit({ clientCommandId: 'native-crm-command',
      scope: captured, text: 'Update contact' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'request', request: {
      requestId: '2:crm', kind: 'businessTool', threadId: 'native-thread-1',
      turnId: 'native-turn-1', callId: 'crm-1', toolName: 'tabs_crm_update_v1',
      details: { arguments: { entity: 'contact', id: 'contact-1',
        expectedUpdatedAt: '2026-01-01T00:00:00Z', changes: { firstName: 'After' } } },
    } });
    await vi.waitFor(async () => expect((await db.codexPendingRequests.get('2:crm'))?.proposal).toBeTruthy());
    await service.decideBusiness('2:crm', true);
    expect((await crmFormsDb.crmContacts.get('contact-1'))?.firstName).toBe('After');
    expect((await crmFormsDb.codexOperationReceipts.get(`codex:${run.runId}:crm-1`))?.outcome).toBe('applied');
    expect(fake.replyRequest).toHaveBeenCalledWith(2, '2:crm',
      expect.objectContaining({ kind: 'businessTool', success: true }));
    fake.listener?.({ epoch: 2, sequence: 2, kind: 'turnStatus',
      threadId: 'native-thread-1', turnId: 'native-turn-1', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.status).toBe('completed'));
    await service.disconnect();
  });

  it('takes a native Forms request through approval to a visible draft', async () => {
    const captured: CodexScope = { ...scope, appThreadId: 'forms-thread', taskId: 'page:forms' };
    await db.chatThreads.add({ id: captured.appThreadId, mode: 'writer', taskId: captured.taskId,
      title: 'Synthetic Forms', createdAt: 1, updatedAt: 1 });
    const service = new CodexSessionService();
    await service.start();
    const run = await service.submit({ clientCommandId: 'native-forms-command',
      scope: captured, text: 'Create form' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.nativeTurnId).toBe('native-turn-1'));
    fake.listener?.({ epoch: 2, sequence: 1, kind: 'request', request: {
      requestId: '2:forms', kind: 'businessTool', threadId: 'native-thread-1',
      turnId: 'native-turn-1', callId: 'forms-1', toolName: 'tabs_forms_create_draft_v1',
      details: { arguments: { name: 'Native intake' } },
    } });
    await vi.waitFor(async () => expect((await db.codexPendingRequests.get('2:forms'))?.proposal).toBeTruthy());
    await service.decideBusiness('2:forms', true);
    expect((await crmFormsDb.forms.toArray())[0]).toMatchObject({ name: 'Native intake', status: 'draft' });
    expect((await crmFormsDb.codexOperationReceipts.get(`codex:${run.runId}:forms-1`))?.outcome).toBe('applied');
    expect(fake.replyRequest).toHaveBeenCalledWith(2, '2:forms',
      expect.objectContaining({ kind: 'businessTool', success: true }));
    fake.listener?.({ epoch: 2, sequence: 2, kind: 'turnStatus',
      threadId: 'native-thread-1', turnId: 'native-turn-1', status: 'completed' });
    await vi.waitFor(async () => expect((await db.codexRuns.get(run.runId))?.status).toBe('completed'));
    await service.disconnect();
  });
});
