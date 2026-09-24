import { isTauriRuntime } from './runtime';

/** Recover a cold-start file and receive Explorer opens in an existing window. */
export async function subscribeToDesktopFileOpen(
  openFile: (path: string) => Promise<void>,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};

  const [{ listen }, { invoke }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
  ]);
  let stopped = false;
  let receivedLiveFile = false;
  let queue = Promise.resolve();

  const enqueue = (payload: unknown) => {
    if (typeof payload !== 'string' || !payload.trim()) return;
    const path = payload.trim();
    // Two OS events must not create workspaces concurrently or finish out of order.
    queue = queue.then(async () => {
      if (!stopped) await openFile(path);
    }).catch((error: unknown) => console.warn('[desktopFileOpen] Could not open file:', error));
  };

  const unlisten = await listen<unknown>('tabs://open-file', ({ payload }) => {
    if (typeof payload !== 'string' || !payload.trim()) return;
    receivedLiveFile = true;
    enqueue(payload);
  });
  // Subscribe first, then drain the native startup slot. A live event supersedes
  // that snapshot so a slow invoke cannot reopen an older document afterwards.
  void invoke<string | null>('take_pending_open_file').then((pending) => {
    if (!receivedLiveFile) enqueue(pending);
  }).catch(() => {
    // Older installed shells may not expose the startup command.
  });

  return () => {
    stopped = true;
    unlisten();
  };
}
