import type { CodexHostEvent } from './types';
import type { CodexRunStatus } from './sessionTypes';

export function terminalStatus(nativeStatus: string): CodexRunStatus | null {
  switch (nativeStatus) {
    case 'completed': return 'completed';
    case 'interrupted': case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    default: return null;
  }
}

export function requestStatus(event: Extract<CodexHostEvent, { kind: 'request' }>): CodexRunStatus {
  return event.request.kind === 'question' ? 'awaiting_input' : 'awaiting_approval';
}

export function boundedDelta(content: string, delta: string): string {
  // The native frame is bounded; the displayed message also has a hard ceiling.
  const max = 1024 * 1024;
  if (content.length >= max) return content;
  return content + delta.slice(0, max - content.length);
}
