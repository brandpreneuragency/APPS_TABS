import { db } from '../db';
import { crmFormsDb } from '../../data/crmFormsDb';
import { isTauriRuntime } from '../runtime';
import { runCodexMigration } from './migration';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types';
import { codexDesktopClient, subscribeCodexEvents } from './desktopClient';
import { boundedDelta, requestStatus, terminalStatus } from './eventReducer';
import { executeBusinessProposal, isReadTool, prepareBusinessProposal, readBusinessTool,
  receiptText, recordBusinessFailure, reconcileDocumentIntents, rejectBusinessProposal,
  toolsForScope, verifyBusinessProposal } from './businessTools';
import type { CodexConnection, CodexHostEvent, CodexModel, CodexRequestReply } from './types';
import type { CodexEventRecord, CodexPendingRecord, CodexRunRecord, CodexScope, CodexSessionRecord } from './sessionTypes';

const OPEN_STATUSES = ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'cancelling'] as const;
const MAX_SUBMITTED_TEXT = 256 * 1024;
const TOOL_SCHEMA_VERSION = 6;

export interface CodexSubmission {
  clientCommandId: string;
  scope: CodexScope;
  text: string;
}

export type ServiceListener = () => void;

/** One controller for the WebView lifetime. React components only observe it. */
export class CodexSessionService {
  private connection: CodexConnection | null = null;
  private stopEvents: (() => void) | null = null;
  private started: Promise<void> | null = null;
  private pumping = false;
  private pumpRequested = false;
  private eventChain: Promise<void> = Promise.resolve();
  private listeners = new Set<ServiceListener>();
  private models: CodexModel[] = [];
  private error: string | null = null;
  private activeRunId: string | null = null;
  private activeAppThreadId: string | null = null;

  snapshot() {
    return { connection: this.connection, models: this.models, error: this.error,
      activeRunId: this.activeRunId, activeAppThreadId: this.activeAppThreadId };
  }

  subscribe(listener: ServiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() { for (const listener of this.listeners) listener(); }

  start(): Promise<void> {
    if (!isTauriRuntime()) return Promise.resolve();
    this.started ??= runCodexMigration().then(() => this.restore()).catch(async (error: unknown) => {
      this.error = this.message(error);
      const open = await db.codexRuns.where('status').anyOf(...OPEN_STATUSES).toArray();
      for (const run of open) {
        await db.codexRuns.update(run.runId, { status: 'recovery_required', error: this.error,
          updatedAt: Date.now() });
        await db.codexPendingRequests.where('runId').equals(run.runId).modify({
          status: 'invalidated', invalidationReason: this.error, updatedAt: Date.now(),
        });
      }
      this.notify();
    });
    return this.started;
  }

  private async restore(): Promise<void> {
    await reconcileDocumentIntents();
    const connection = await codexDesktopClient.status();
    if (connection) {
      this.connection = connection;
      try { await this.attach(connection); } catch (error) {
        await codexDesktopClient.disconnect(connection.epoch).catch(() => undefined);
        this.connection = null;
        this.error = this.message(error);
      }
    }
    const open = await db.codexRuns.where('status').anyOf(...OPEN_STATUSES).toArray();
    for (const run of open) {
      // A renderer reload loses the domain bridge. Stop any still-owned turn and
      // require history reconciliation before accepting another run.
      if (connection && run.executionEpoch === connection.epoch && run.nativeTurnId) {
        await codexDesktopClient.interruptTurn(connection.epoch, run.nativeThreadId ?? '', run.nativeTurnId)
          .catch(() => undefined);
      }
      await db.codexRuns.update(run.runId, {
        status: 'recovery_required', updatedAt: Date.now(),
        error: 'The assistant session was interrupted. Review the native turn before retrying.',
      });
      await db.codexPendingRequests.where('runId').equals(run.runId).modify({
        status: 'invalidated', updatedAt: Date.now(), invalidationReason: 'Renderer restarted',
      });
    }
    this.activeRunId = null;
    this.notify();
    if (open.length === 0) void this.pump();
  }

  private async attach(connection: CodexConnection): Promise<void> {
    this.stopEvents?.();
    this.stopEvents = null;
    const last = await db.codexEvents.where('[epoch+sequence]').between([connection.epoch, 0], [connection.epoch, Number.MAX_SAFE_INTEGER]).last();
    const subscription = await subscribeCodexEvents(connection.epoch, last?.sequence ?? 0, (event) => {
      this.eventChain = this.eventChain.then(() => this.handleEvent(event)).catch((error: unknown) => {
        void this.failActive(connection.epoch, this.message(error));
      });
    }, (error) => { void this.failActive(connection.epoch, error.message); });
    this.stopEvents = subscription.stop;
    if (subscription.replayGap) {
      subscription.stop();
      this.stopEvents = null;
      this.error = 'Codex event replay has a gap. Reconcile the native thread before continuing.';
      await this.markOpenForRecovery(connection.epoch, this.error);
      throw new Error(this.error);
    }
    this.notify();
  }

  async connect(workspaceRoot: string, executablePath?: string, forPump = false): Promise<CodexConnection> {
    await this.start();
    if (this.activeRunId && !forPump) throw new Error('A Codex run is active');
    if (this.connection?.workspaceRoot.toLowerCase() === workspaceRoot.toLowerCase()) return this.connection;
    if (this.connection) {
      this.stopEvents?.();
      await codexDesktopClient.disconnect(this.connection.epoch);
      this.connection = null;
    }
    const connection = await codexDesktopClient.connect(workspaceRoot, executablePath);
    this.connection = connection;
    try {
      await this.attach(connection);
    } catch (error) {
      await codexDesktopClient.disconnect(connection.epoch).catch(() => undefined);
      this.connection = null;
      throw error;
    }
    this.models = await codexDesktopClient.listModels(connection.epoch);
    this.error = null;
    this.notify();
    return connection;
  }

  async defaultWorkspace(): Promise<string> {
    return codexDesktopClient.defaultWorkspace();
  }

  async refreshModels(): Promise<CodexModel[]> {
    if (!this.connection) throw new Error('Codex is not connected');
    this.models = await codexDesktopClient.listModels(this.connection.epoch);
    this.notify();
    return this.models;
  }

  async submit(submission: CodexSubmission): Promise<CodexRunRecord> {
    await this.start();
    if (!isTauriRuntime()) throw new Error('Codex execution requires the desktop app');
    const { clientCommandId, scope, text } = submission;
    if (!clientCommandId || !scope.appThreadId || !scope.workspaceRoot || !text.trim()) {
      throw new Error('A Codex submission needs a command ID, thread, workspace and text');
    }
    const submittedText = scope.context.trim()
      ? `${text.trim()}\n\n[TABS CONTEXT SNAPSHOT]\n${scope.context.trim()}`
      : text.trim();
    if (submittedText.length > MAX_SUBMITTED_TEXT) throw new Error('The prompt and context exceed the native limit');
    const previous = await db.codexRuns.where('clientCommandId').equals(clientCommandId).first();
    if (previous) return previous;
    const now = Date.now();
    const run: CodexRunRecord = {
      runId: crypto.randomUUID(), clientCommandId, appThreadId: scope.appThreadId,
      status: 'queued', scope: structuredClone(scope), userText: text.trim(), submittedText,
      createdAt: now, updatedAt: now,
    };
    const userMessage: ChatMessage = {
      id: `codex:user:${run.runId}`, threadId: scope.appThreadId, mode: scope.mode,
      workspaceId: scope.workspaceId, taskId: scope.taskId, settingsTab: scope.settingsTab,
      agentId: scope.agentId, role: 'user', content: text.trim(),
      selectedText: scope.selectedText, selectionFrom: scope.selectionFrom,
      selectionTo: scope.selectionTo, attachments: scope.attachments, timestamp: now,
    };
    try {
      await db.transaction('rw', db.codexRuns, db.chatMessages, async () => {
        await db.codexRuns.add(run);
        await db.chatMessages.add(userMessage);
      });
    } catch (error) {
      const duplicate = await db.codexRuns.where('clientCommandId').equals(clientCommandId).first();
      if (duplicate) return duplicate;
      throw error;
    }
    await useChatStore.getState().syncThreadMessages(scope.appThreadId);
    void this.pump();
    return run;
  }

  private async pump(): Promise<void> {
    if (!isTauriRuntime()) return;
    if (this.pumping) { this.pumpRequested = true; return; }
    this.pumping = true;
    try {
      const unresolved = await db.codexRuns.where('status').equals('recovery_required').first();
      if (unresolved) return;
      const open = await db.codexRuns.where('status').anyOf(...OPEN_STATUSES).first();
      if (open) return;
      const queued = await db.codexRuns.where('status').equals('queued').sortBy('createdAt');
      const run = queued[0];
      if (!run) return;
      this.activeRunId = run.runId;
      this.activeAppThreadId = run.appThreadId;
      this.notify();
      await db.codexRuns.update(run.runId, { status: 'starting', updatedAt: Date.now() });
      try {
        const connection = await this.connect(run.scope.workspaceRoot, undefined, true);
        const tools = toolsForScope(run.scope);
        const toolNames = tools.map((tool) => tool.name);
        let session = await db.codexSessions.get(run.appThreadId);
        let nativeThreadId: string;
        if (session && session.workspaceRoot.toLowerCase() === connection.workspaceRoot.toLowerCase()
          && session.binaryVersion === connection.version && session.toolSchemaVersion === TOOL_SCHEMA_VERSION
          && JSON.stringify(session.toolNames) === JSON.stringify(toolNames)
          && (session.permissionProfile ?? 'readOnly') === run.scope.permissionProfile) {
          nativeThreadId = session.lastEpoch === connection.epoch
            ? session.nativeThreadId
            : await codexDesktopClient.resumeThread(connection.epoch, session.nativeThreadId, tools);
          if (session.lastEpoch !== connection.epoch) {
            await db.codexSessions.update(run.appThreadId, { lastEpoch: connection.epoch, updatedAt: Date.now() });
          }
        } else if (session) {
          throw new Error('This conversation needs an explicit new-thread handoff');
        } else {
          nativeThreadId = await codexDesktopClient.startThread({
            epoch: connection.epoch, workspaceRoot: connection.workspaceRoot,
            permissionProfile: run.scope.permissionProfile,
            approvalPolicy: 'on-request', model: run.scope.model, tools,
          });
          const now = Date.now();
          session = { appThreadId: run.appThreadId, nativeThreadId,
            workspaceRoot: connection.workspaceRoot, binaryVersion: connection.version,
            toolSchemaVersion: TOOL_SCHEMA_VERSION, toolNames, lastEpoch: connection.epoch,
            model: run.scope.model, effort: run.scope.effort,
            permissionProfile: run.scope.permissionProfile,
            createdAt: now, updatedAt: now } satisfies CodexSessionRecord;
          await db.codexSessions.add(session);
        }
        await db.codexRuns.update(run.runId, {
          nativeThreadId, executionEpoch: connection.epoch, updatedAt: Date.now(),
        });
        // From here until the returned native turn ID is persisted, a pipe loss is
        // an uncertain submit. Never send the same user text again automatically.
        const nativeTurnId = await codexDesktopClient.startTurn({
          epoch: connection.epoch, threadId: nativeThreadId,
          text: run.submittedText, model: run.scope.model, effort: run.scope.effort,
          images: run.scope.attachments?.filter((attachment) => attachment.kind === 'image')
            .map((attachment) => attachment.dataUrl!),
        });
        await db.codexRuns.update(run.runId, { nativeTurnId, status: 'running', updatedAt: Date.now() });
        await db.settings.delete(`codexHandoff:${run.appThreadId}`);
        await this.reconcileUnassigned(run.runId, connection.epoch, nativeThreadId, nativeTurnId);
        if ((await db.codexRuns.get(run.runId))?.status === 'cancelling') {
          await codexDesktopClient.interruptTurn(connection.epoch, nativeThreadId, nativeTurnId);
        }
      } catch (error) {
        const message = this.message(error);
        const latest = await db.codexRuns.get(run.runId);
        await db.codexRuns.update(run.runId, {
          status: latest?.nativeThreadId ? 'recovery_required' : 'failed',
          error: message, updatedAt: Date.now(),
        });
        this.error = message;
        this.activeRunId = null;
        this.activeAppThreadId = null;
        this.notify();
      }
    } catch (error) {
      // A queued pump may outlive a renderer or test database. Surface the
      // failure without leaving a detached, unhandled promise behind.
      this.error = this.message(error);
      this.notify();
    } finally {
      this.pumping = false;
      if (this.pumpRequested) {
        this.pumpRequested = false;
        void this.pump();
      }
    }
  }

  private async reconcileUnassigned(runId: string, epoch: number, nativeThreadId: string, nativeTurnId: string): Promise<void> {
    const candidates = await db.codexEvents.where('epoch').equals(epoch).filter((row) =>
      !row.runId && 'threadId' in row.event && 'turnId' in row.event
      && row.event.threadId === nativeThreadId && row.event.turnId === nativeTurnId).toArray();
    for (const row of candidates) await this.handleEvent(row.event, runId);
  }

  private async handleEvent(event: CodexHostEvent, knownRunId?: string): Promise<void> {
    const id = `${event.epoch}:${event.sequence}`;
    const run = knownRunId ? await db.codexRuns.get(knownRunId)
      : 'threadId' in event && 'turnId' in event
        ? await db.codexRuns.where('nativeTurnId').equals(event.turnId).filter((candidate) =>
          candidate.nativeThreadId === event.threadId && candidate.executionEpoch === event.epoch).first()
        : event.kind === 'request'
          ? await db.codexRuns.where('nativeTurnId').equals(event.request.turnId).filter((candidate) =>
            candidate.nativeThreadId === event.request.threadId && candidate.executionEpoch === event.epoch).first()
          : undefined;
    let projected = false;
    let businessError: string | null = null;
    let proposal: CodexPendingRecord['proposal'];
    if (run && event.kind === 'request' && event.request.kind === 'businessTool') {
      try {
        if (!event.request.toolName) throw new Error('Missing tool name');
        if (!isReadTool(event.request.toolName)) proposal = await prepareBusinessProposal(run, event.request);
      } catch (error) {
        businessError = this.message(error);
      }
    }
    await db.transaction('rw', db.codexEvents, db.codexRuns, db.codexPendingRequests, db.chatMessages, async () => {
      const existing = await db.codexEvents.get(id);
      if (existing?.runId || (existing && !run)) return;
      const row: CodexEventRecord = { id, epoch: event.epoch, sequence: event.sequence,
        runId: run?.runId, event, createdAt: Date.now() };
      await db.codexEvents.put(row);
      if (!run) return;
      const latest = await db.codexRuns.get(run.runId);
      // Recovery is a review boundary. Late native events may be journaled for
      // reconciliation, but must not reopen approvals or complete the run here.
      if (!latest || !OPEN_STATUSES.some((status) => status === latest.status)) return;
      projected = true;
      if (event.kind === 'textDelta') {
        const messageId = `codex:assistant:${run.runId}:${event.itemId}`;
        const old = await db.chatMessages.get(messageId);
        const message: ChatMessage = old ?? {
          id: messageId, threadId: run.appThreadId, mode: run.scope.mode,
          workspaceId: run.scope.workspaceId, taskId: run.scope.taskId,
          settingsTab: run.scope.settingsTab, agentId: run.scope.agentId,
          role: 'assistant', content: '', timestamp: Date.now(),
        };
        message.content = boundedDelta(message.content, event.delta);
        await db.chatMessages.put(message);
      } else if (event.kind === 'toolActivity') {
        const messageId = `codex:tool:${run.runId}:${event.itemId}`;
        const old = await db.chatMessages.get(messageId);
        const args = JSON.stringify(event.details).slice(0, 32 * 1024);
        const message: ChatMessage = old ?? {
          id: messageId, threadId: run.appThreadId, mode: run.scope.mode,
          workspaceId: run.scope.workspaceId, taskId: run.scope.taskId,
          settingsTab: run.scope.settingsTab, agentId: run.scope.agentId,
          role: 'tool_call', content: '', timestamp: Date.now(),
        };
        message.toolCall = {
          toolCallId: event.itemId, name: event.itemType, args,
          status: event.status === 'completed' ? 'done' : 'approved',
          resultSummary: event.status,
        };
        await db.chatMessages.put(message);
      } else if (event.kind === 'request') {
        const pending: CodexPendingRecord = {
          requestId: event.request.requestId, runId: run.runId, epoch: event.epoch,
          request: event.request, status: 'pending', proposal,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        await db.codexPendingRequests.put(pending);
        if (event.request.kind !== 'businessTool' || proposal) {
          await db.codexRuns.update(run.runId, { status: requestStatus(event), updatedAt: Date.now() });
        }
      } else if (event.kind === 'turnStatus') {
        const status = terminalStatus(event.status);
        if (status) {
          await db.codexRuns.update(run.runId, { status, updatedAt: Date.now() });
          await db.codexPendingRequests.where('runId').equals(run.runId).modify({
            status: 'invalidated', updatedAt: Date.now(), invalidationReason: 'Turn ended',
          });
        }
      }
    });
    if (projected && run) {
      if (event.kind === 'request' && event.request.kind === 'businessTool') {
        try {
          if (businessError) {
            await this.answerBusiness(event.request.requestId, run, false, businessError);
          } else if (!proposal) {
            let success = true;
            let result: string;
            try { result = await readBusinessTool(run, event.request); }
            catch (error) { success = false; result = this.message(error); }
            await this.answerBusiness(event.request.requestId, run, success, result);
          }
        } catch (error) {
          await this.failActive(event.epoch, this.message(error));
        }
      }
      if (event.kind === 'textDelta' || event.kind === 'toolActivity') {
        await useChatStore.getState().syncThreadMessages(run.appThreadId);
      }
      if (event.kind === 'turnStatus' && terminalStatus(event.status)) {
        this.activeRunId = null;
        this.activeAppThreadId = null;
        void this.pump();
      }
    }
    if (event.kind === 'status' && event.status !== 'ready') {
      await this.markOpenForRecovery(event.epoch, event.message ?? 'Codex connection closed');
      if (this.connection?.epoch === event.epoch) {
        this.stopEvents?.();
        this.stopEvents = null;
        this.connection = null;
        this.models = [];
      }
      this.activeRunId = null;
      this.activeAppThreadId = null;
    }
    await codexDesktopClient.ackEvents(event.epoch, event.sequence).catch((error: unknown) => {
      this.error = this.message(error);
    });
    this.notify();
  }

  private async markOpenForRecovery(epoch: number, reason: string): Promise<void> {
    const open = await db.codexRuns.where('status').anyOf(...OPEN_STATUSES).filter((run) => run.executionEpoch === epoch).toArray();
    for (const run of open) {
      await db.codexRuns.update(run.runId, { status: 'recovery_required', error: reason, updatedAt: Date.now() });
      await db.codexPendingRequests.where('runId').equals(run.runId).modify({
        status: 'invalidated', updatedAt: Date.now(), invalidationReason: reason,
      });
    }
  }

  private async failActive(epoch: number, reason: string): Promise<void> {
    if (this.connection?.epoch !== epoch) return;
    const active = this.activeRunId ? await db.codexRuns.get(this.activeRunId) : undefined;
    await this.markOpenForRecovery(epoch, reason);
    if (active?.executionEpoch === epoch && active.nativeThreadId && active.nativeTurnId) {
      await codexDesktopClient.interruptTurn(epoch, active.nativeThreadId, active.nativeTurnId)
        .catch(() => undefined);
    }
    this.activeRunId = null;
    this.activeAppThreadId = null;
    this.error = reason;
    this.notify();
  }

  async stop(runId: string): Promise<void> {
    const run = await db.codexRuns.get(runId);
    if (!run) throw new Error('Run not found');
    if (run.status === 'queued') {
      await db.codexRuns.update(runId, { status: 'cancelled', updatedAt: Date.now() });
      void this.pump();
      return;
    }
    if (!OPEN_STATUSES.some((status) => status === run.status)) return;
    await db.codexRuns.update(runId, { status: 'cancelling', updatedAt: Date.now() });
    if (run.executionEpoch && run.nativeThreadId && run.nativeTurnId) {
      await codexDesktopClient.interruptTurn(run.executionEpoch, run.nativeThreadId, run.nativeTurnId);
    }
    this.notify();
  }

  async reply(requestId: string, reply: CodexRequestReply): Promise<void> {
    const pending = await db.codexPendingRequests.get(requestId);
    if (!pending || pending.status !== 'pending') throw new Error('This request is no longer pending');
    if (pending.request.kind === 'businessTool' || reply.kind === 'businessTool') {
      throw new Error('Use the exact business proposal decision');
    }
    const run = await db.codexRuns.get(pending.runId);
    if (!run || run.executionEpoch !== pending.epoch || !this.connection
      || this.connection.epoch !== pending.epoch || run.status === 'recovery_required') {
      throw new Error('This approval belongs to an interrupted session');
    }
    await codexDesktopClient.replyRequest(pending.epoch, requestId, reply);
    await db.codexPendingRequests.update(requestId, { status: 'answered', updatedAt: Date.now() });
    await db.codexRuns.update(run.runId, { status: 'running', updatedAt: Date.now() });
    this.notify();
  }

  private async answerBusiness(requestId: string, run: CodexRunRecord, success: boolean, result: string): Promise<void> {
    if (!run.executionEpoch || !this.connection || this.connection.epoch !== run.executionEpoch) {
      throw new Error('The native turn is no longer connected');
    }
    await codexDesktopClient.replyRequest(run.executionEpoch, requestId,
      { kind: 'businessTool', success, text: result });
    await db.codexPendingRequests.update(requestId, { status: 'answered', updatedAt: Date.now() });
    await db.codexRuns.update(run.runId, { status: 'running', updatedAt: Date.now() });
    this.notify();
  }

  async decideBusiness(requestId: string, approve: boolean): Promise<void> {
    const pending = await db.codexPendingRequests.get(requestId);
    if (!pending || pending.status !== 'pending' || pending.request.kind !== 'businessTool' || !pending.proposal) {
      throw new Error('This business proposal is unavailable');
    }
    const run = await db.codexRuns.get(pending.runId);
    if (!run || run.executionEpoch !== pending.epoch || !this.connection
      || this.connection.epoch !== pending.epoch || run.nativeThreadId !== pending.request.threadId
      || run.nativeTurnId !== pending.request.turnId || run.status === 'recovery_required') {
      throw new Error('This proposal belongs to an interrupted turn');
    }
    await verifyBusinessProposal(run, pending.request, pending.proposal);
    const decision = approve ? 'approved' : 'rejected';
    await db.transaction('rw', db.codexPendingRequests, async () => {
      const current = await db.codexPendingRequests.get(requestId);
      if (!current || current.status !== 'pending') throw new Error('This proposal is no longer pending');
      if (current.decision && current.decision !== decision) {
        throw new Error('This proposal already has a different decision');
      }
      if (!current.decision) {
        await db.codexPendingRequests.update(requestId,
          { decision, decisionAt: Date.now(), updatedAt: Date.now() });
      }
    });
    let success = false;
    let result: string;
    try {
      const receipt = approve
        ? await executeBusinessProposal(run, pending.proposal)
        : await rejectBusinessProposal(run, pending.proposal);
      success = receipt.outcome === 'applied';
      result = receiptText(receipt);
    } catch (error) {
      const failure = await recordBusinessFailure(run, pending.proposal, error);
      success = failure.outcome === 'applied';
      result = receiptText(failure);
    }
    try { await this.answerBusiness(requestId, run, success, result); }
    catch (error) {
      await this.failActive(pending.epoch, this.message(error));
      throw error;
    }
  }

  async getPending(appThreadId?: string): Promise<CodexPendingRecord[]> {
    const rows = await db.codexPendingRequests.where('status').equals('pending').toArray();
    if (!appThreadId) return rows;
    const runIds = new Set((await db.codexRuns.where('appThreadId').equals(appThreadId).toArray()).map((run) => run.runId));
    return rows.filter((row) => runIds.has(row.runId));
  }

  async getRuns(appThreadId: string): Promise<CodexRunRecord[]> {
    return db.codexRuns.where('appThreadId').equals(appThreadId).sortBy('createdAt');
  }

  async disconnect(): Promise<void> {
    if (this.activeRunId) throw new Error('Stop the active Codex run before disconnecting');
    if (!this.connection) return;
    const epoch = this.connection.epoch;
    this.stopEvents?.();
    this.stopEvents = null;
    await codexDesktopClient.disconnect(epoch);
    this.connection = null;
    this.models = [];
    this.notify();
  }

  async reconcile(runId: string): Promise<CodexRunRecord> {
    const run = await db.codexRuns.get(runId);
    if (!run || run.status !== 'recovery_required') throw new Error('No interrupted run to reconcile');
    await reconcileDocumentIntents();
    if (!run.nativeThreadId) return run;
    const connection = await this.connect(run.scope.workspaceRoot);
    const session = await db.codexSessions.get(run.appThreadId);
    if (session?.lastEpoch !== connection.epoch) {
      await codexDesktopClient.resumeThread(connection.epoch, run.nativeThreadId, toolsForScope(run.scope));
      await db.codexSessions.update(run.appThreadId, { lastEpoch: connection.epoch, updatedAt: Date.now() });
    }
    const turns = await codexDesktopClient.readThread(connection.epoch, run.nativeThreadId);
    const matching = run.nativeTurnId ? turns.find((turn) => turn.id === run.nativeTurnId) : undefined;
    if (matching) {
      const status = terminalStatus(matching.status);
      if (status) {
        const decided = await db.codexPendingRequests.where('runId').equals(runId)
          .filter((row) => row.decision === 'approved').toArray();
        for (const pending of decided) {
          const operationId = pending.proposal?.operationId;
          const receipt = operationId ? await db.codexOperationReceipts.get(operationId)
            ?? await crmFormsDb.codexOperationReceipts.get(operationId) : undefined;
          if (operationId && (!receipt || receipt.outcome === 'partial'
            || receipt.projection === 'pending' || receipt.projection === 'failed')) {
            await db.codexRuns.update(runId, { error: 'An approved business proposal has an incomplete effect. Review the partial turn.',
              updatedAt: Date.now() });
            return (await db.codexRuns.get(runId)) ?? run;
          }
        }
        await this.eventChain;
        await db.transaction('rw', db.chatMessages, db.codexRuns, async () => {
          for (const item of matching.assistantItems) {
            const messageId = `codex:assistant:${run.runId}:${item.id}`;
            const existing = await db.chatMessages.get(messageId);
            const message: ChatMessage = existing ?? {
              id: messageId, threadId: run.appThreadId, mode: run.scope.mode,
              workspaceId: run.scope.workspaceId, taskId: run.scope.taskId,
              settingsTab: run.scope.settingsTab, agentId: run.scope.agentId,
              role: 'assistant', content: '', timestamp: Date.now(),
            };
            message.content = item.text;
            await db.chatMessages.put(message);
          }
          await db.codexRuns.update(runId, { status, updatedAt: Date.now(), error: undefined });
        });
        await useChatStore.getState().syncThreadMessages(run.appThreadId);
        void this.pump();
      }
    }
    return (await db.codexRuns.get(runId)) ?? run;
  }

  async acknowledgeRecovery(runId: string): Promise<void> {
    const run = await db.codexRuns.get(runId);
    if (!run || run.status !== 'recovery_required') throw new Error('No interrupted run to set aside');
    // This never retries the old submission or reverses completed effects.
    await db.codexRuns.update(runId, { status: 'cancelled', updatedAt: Date.now(),
      error: 'Set aside after review; completed native or business effects may remain.' });
    this.notify();
    void this.pump();
  }

  async handoff(appThreadId: string, newAppThreadId: string, selectedHistory: string): Promise<void> {
    if (selectedHistory.length > 32 * 1024) throw new Error('Handoff history is too long');
    if (await db.codexSessions.get(newAppThreadId)) throw new Error('The destination thread already has a native session');
    const old = await db.chatThreads.get(appThreadId);
    const destination = await db.chatThreads.get(newAppThreadId);
    if (!old || !destination) throw new Error('Handoff threads were not found');
    // A new app thread has no native mapping. Its first submitted turn carries
    // the explicitly selected history as context; it is never called a resume.
    await db.transaction('rw', db.chatThreads, db.settings, async () => {
      await db.chatThreads.update(newAppThreadId, { title: `Handoff from ${old.title}`, handoffFrom: appThreadId });
      await db.settings.put({ key: `codexHandoff:${newAppThreadId}`, value: selectedHistory });
    });
  }

  private message(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
    return 'Codex operation failed';
  }
}

export const codexSessionService = new CodexSessionService();
