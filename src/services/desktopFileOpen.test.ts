import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToDesktopFileOpen } from './desktopFileOpen';

const mocks = vi.hoisted(() => ({ native: vi.fn(), listen: vi.fn(), invoke: vi.fn(), unlisten: vi.fn() }));
vi.mock('./runtime', () => ({ isTauriRuntime: mocks.native }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

let send: (event: { payload: unknown }) => void;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockReturnValue(true);
  mocks.invoke.mockResolvedValue(null);
  mocks.listen.mockImplementation(async (_event: string, listener: typeof send) => {
    send = listener;
    return mocks.unlisten;
  });
});

describe('desktop file-open delivery', () => {
  it('recovers the document passed while the frontend was restoring its saved state', async () => {
    mocks.invoke.mockResolvedValue('C:\\Notes\\requested.md');
    const openFile = vi.fn().mockResolvedValue(undefined);
    const stop = await subscribeToDesktopFileOpen(openFile);
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith('C:\\Notes\\requested.md'));
    expect(mocks.listen).toHaveBeenCalledWith('tabs://open-file', expect.any(Function));
    expect(mocks.invoke).toHaveBeenCalledWith('take_pending_open_file');
    stop();
  });

  it('does not let a late startup snapshot replace a more recent Explorer request', async () => {
    let resolvePending!: (path: string) => void;
    mocks.invoke.mockReturnValue(new Promise<string>((resolve) => { resolvePending = resolve; }));
    const openFile = vi.fn().mockResolvedValue(undefined);
    const stop = await subscribeToDesktopFileOpen(openFile);
    send({ payload: 'C:/Notes/current.md' });
    resolvePending('C:/Notes/old.md');
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledOnce());
    expect(openFile).toHaveBeenCalledWith('C:/Notes/current.md');
    stop();
  });

  it('finishes one file before opening the next so the latest request stays selected', async () => {
    let finishFirst!: () => void;
    const openFile = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(undefined);
    const stop = await subscribeToDesktopFileOpen(openFile);
    send({ payload: 'C:/Notes/first.md' });
    send({ payload: 'C:/Notes/second.md' });
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledOnce());
    finishFirst();
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledTimes(2));
    expect(openFile.mock.calls.map(([path]) => path)).toEqual(['C:/Notes/first.md', 'C:/Notes/second.md']);
    stop();
  });

  it('ignores invalid payloads and pending startup data after cleanup', async () => {
    let resolvePending!: (path: string) => void;
    mocks.invoke.mockReturnValue(new Promise<string>((resolve) => { resolvePending = resolve; }));
    const openFile = vi.fn();
    const stop = await subscribeToDesktopFileOpen(openFile);
    send({ payload: null });
    send({ payload: '  ' });
    stop();
    resolvePending('C:/Notes/late.md');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openFile).not.toHaveBeenCalled();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it('does not call native APIs in browser preview', async () => {
    mocks.native.mockReturnValue(false);
    const stop = await subscribeToDesktopFileOpen(vi.fn());
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    stop();
  });
});
