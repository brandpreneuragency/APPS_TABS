import { isTauriRuntime } from '../runtime';
import type {
  CodexConnection, CodexDiscovery, CodexHostEvent, CodexLoginStart, CodexModel, CodexNativeTurn,
  CodexReplay, CodexRequestReply, CodexThreadRequest, CodexToolSpec, CodexTurnRequest,
} from './types';

export interface CodexScopedDocument {
  path: string;
  name: string;
  relativePath: string;
  size: number;
}

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new Error('Codex execution requires the TABS desktop app');
}

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  requireDesktop();
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export const codexDesktopClient = {
  discover: (path?: string) => call<CodexDiscovery>('codex_discover', { path }),
  connect: (workspaceRoot: string, executablePath?: string) =>
    call<CodexConnection>('codex_connect', { workspaceRoot, executablePath }),
  beginLogin: (workspaceRoot: string, executablePath?: string) =>
    call<CodexLoginStart>('codex_begin_login', { workspaceRoot, executablePath }),
  cancelLogin: (epoch: number, loginId: string) =>
    call<void>('codex_cancel_login', { epoch, loginId }),
  status: () => call<CodexConnection | null>('codex_status'),
  listModels: (epoch: number) => call<CodexModel[]>('codex_list_models', { epoch }),
  defaultWorkspace: () => call<string>('codex_default_workspace'),
  readScopedTextFile: (workspaceRoot: string, path: string) =>
    call<string>('codex_read_scoped_text_file', { workspaceRoot, path }),
  listScopedDocuments: (workspaceRoot: string) =>
    call<CodexScopedDocument[]>('codex_list_scoped_documents', { workspaceRoot }),
  scopedDocumentHash: (workspaceRoot: string, fileName: string) =>
    call<string | null>('codex_scoped_document_hash', { workspaceRoot, fileName }),
  createScopedDocument: (workspaceRoot: string, fileName: string,
    contentBase64: string, expectedSha256: string) =>
    call<{ path: string; sha256: string }>('codex_create_scoped_document',
      { workspaceRoot, fileName, contentBase64, expectedSha256 }),
  readThread: (epoch: number, threadId: string) =>
    call<CodexNativeTurn[]>('codex_read_thread', { epoch, threadId }),
  startThread: (request: CodexThreadRequest) => call<string>('codex_start_thread', { request }),
  resumeThread: (epoch: number, threadId: string, tools: CodexToolSpec[] = []) =>
    call<string>('codex_resume_thread', { epoch, threadId, tools }),
  startTurn: (request: CodexTurnRequest) => call<string>('codex_start_turn', { request }),
  interruptTurn: (epoch: number, threadId: string, turnId: string) =>
    call<void>('codex_interrupt_turn', { epoch, threadId, turnId }),
  replyRequest: (epoch: number, requestId: string, reply: CodexRequestReply) =>
    call<void>('codex_reply_request', { epoch, requestId, reply }),
  replay: (epoch: number, afterSequence: number, limit = 512) =>
    call<CodexReplay>('codex_replay_events', { epoch, afterSequence, limit }),
  ackEvents: (epoch: number, sequence: number) =>
    call<void>('codex_ack_events', { epoch, sequence }),
  disconnect: (epoch: number) => call<void>('codex_disconnect', { epoch }),
};

/** Attach before replay so events emitted during subscription are not lost. */
export async function subscribeCodexEvents(
  epoch: number,
  afterSequence: number,
  onEvent: (event: CodexHostEvent) => void,
  onGap: (error: Error) => void = () => undefined,
): Promise<{ stop: () => void; replayGap: boolean }> {
  requireDesktop();
  const { listen } = await import('@tauri-apps/api/event');
  let replaying = true;
  let cursor = afterSequence;
  const live: CodexHostEvent[] = [];
  let stopped = false;
  let draining: Promise<void> = Promise.resolve();
  const deliver = (event: CodexHostEvent) => {
    if (event.epoch !== epoch || event.sequence <= cursor) return;
    cursor = event.sequence;
    onEvent(event);
  };
  const unlisten = await listen<CodexHostEvent>('codex://event', ({ payload }) => {
    if (stopped || payload.epoch !== epoch) return;
    live.push(payload);
    if (!replaying) scheduleDrain();
  });
  const scheduleDrain = () => {
    draining = draining.then(async () => {
      live.sort((a, b) => a.sequence - b.sequence);
      while (!stopped && live.length) {
        const next = live[0];
        if (next.sequence <= cursor) { live.shift(); continue; }
        if (cursor === 0 || next.sequence > cursor + 1) {
          const replay = await codexDesktopClient.replay(epoch, cursor, 512);
          if (replay.gap) throw new Error('Codex event replay has a gap');
          let advanced = false;
          for (const event of replay.events) {
            if (cursor > 0 && event.sequence > cursor + 1) throw new Error('Codex events are out of sequence');
            if (event.sequence > cursor) { deliver(event); advanced = true; }
          }
          if (!advanced) return; // Wait for a delayed event or another notification.
          live.sort((a, b) => a.sequence - b.sequence);
          continue;
        }
        live.shift();
        deliver(next);
      }
    }).catch((error: unknown) => onGap(error instanceof Error ? error : new Error('Codex event replay failed')));
  };
  try {
    let replayGap = false;
    for (let page = 0; page < 128; page += 1) {
      const replay = await codexDesktopClient.replay(epoch, cursor, 512);
      replayGap ||= replay.gap;
      for (const event of replay.events) deliver(event);
      if (replay.events.length < 512) break;
      if (page === 127) replayGap = true;
    }
    replaying = false;
    scheduleDrain();
    return { stop: () => { stopped = true; unlisten(); }, replayGap };
  } catch (error) {
    unlisten();
    throw error;
  }
}
