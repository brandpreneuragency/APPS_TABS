import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexHostEvent, CodexReplay } from './types';

const fake = vi.hoisted(() => ({
  listener: null as ((event: { payload: CodexHostEvent }) => void) | null,
}));
vi.mock('../runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, listener: (event: { payload: CodexHostEvent }) => void) => {
    fake.listener = listener;
    return () => { fake.listener = null; };
  }),
}));

import { codexDesktopClient, subscribeCodexEvents } from './desktopClient';

const event = (sequence: number): CodexHostEvent => ({ epoch: 1, sequence, kind: 'diagnostic', message: `event-${sequence}` });

describe('Codex event subscription', () => {
  beforeEach(() => { fake.listener = null; vi.restoreAllMocks(); });

  it('fills an out-of-order live delivery from the native journal', async () => {
    let calls = 0;
    vi.spyOn(codexDesktopClient, 'replay').mockImplementation(async (): Promise<CodexReplay> => {
      calls += 1;
      return { events: calls === 1 ? [] : [event(1), event(2)], latestSequence: 2, gap: false };
    });
    const seen: number[] = [];
    const subscription = await subscribeCodexEvents(1, 0, (row) => seen.push(row.sequence));
    fake.listener?.({ payload: event(2) });
    await vi.waitFor(() => expect(seen).toEqual([1, 2]));
    fake.listener?.({ payload: event(1) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([1, 2]);
    subscription.stop();
  });

  it('reports a live replay gap without projecting the future event', async () => {
    let calls = 0;
    vi.spyOn(codexDesktopClient, 'replay').mockImplementation(async (): Promise<CodexReplay> => {
      calls += 1;
      return calls === 1
        ? { events: [event(1)], latestSequence: 1, gap: false }
        : { events: [], latestSequence: 3, gap: true };
    });
    const seen: number[] = [];
    const gaps: string[] = [];
    const subscription = await subscribeCodexEvents(1, 0, (row) => seen.push(row.sequence),
      (error) => gaps.push(error.message));
    fake.listener?.({ payload: event(3) });
    await vi.waitFor(() => expect(gaps).toHaveLength(1));
    expect(seen).toEqual([1]);
    subscription.stop();
  });
});
