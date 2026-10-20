import { describe, expect, it, vi } from 'vitest';
import { createProviderAccountsStore } from './store';
import type { ProviderAccount, ProviderAccountsClient } from './types';

const slot = (id = 'codex-1'): ProviderAccount => ({
  id, providerId: 'openai-codex', label: id, identity: null, status: 'disconnected',
  duplicateOf: null, lastAttemptAt: null, lastSuccessAt: null, error: null, usage: null,
});
const connected = (): ProviderAccount => ({ ...slot(), status: 'connected', lastSuccessAt: 2000,
  identity: { key: 'synthetic-principal', email: 'synthetic@example.invalid', workspaceId: 'workspace-a', plan: 'pro' },
  usage: { windows: [{ id: 'fiveHour', windowMinutes: 300, usedPercent: 40, resetsAt: 3000 }], resetTokens: 3 },
});
function client(): ProviderAccountsClient {
  return {
    list: vi.fn().mockResolvedValue([slot(), slot('codex-2')]),
    refresh: vi.fn().mockResolvedValue([connected(), slot('codex-2')]),
    beginLogin: vi.fn().mockResolvedValue({ accountId: 'codex-1', loginId: 'login-a', authUrl: 'https://auth.openai.com/authorize' }),
    openLogin: vi.fn().mockResolvedValue(undefined),
    pollLogin: vi.fn().mockResolvedValue({ status: 'completed', account: connected(), error: null }),
    cancelLogin: vi.fn().mockResolvedValue(undefined), connections: vi.fn().mockResolvedValue([]),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('provider accounts state ownership', () => {
  it('loads real adapter results and never starts login merely to show a dashboard', async () => {
    const api = client(); const store = createProviderAccountsStore(api);
    await store.getState().load();
    expect(store.getState().accounts).toHaveLength(2);
    expect(api.beginLogin).not.toHaveBeenCalled();
    expect(api.openLogin).not.toHaveBeenCalled();
  });

  it('does not let an older list response overwrite a newly completed login', async () => {
    const api = client(); const pendingList = deferred<ProviderAccount[]>();
    vi.mocked(api.list).mockReturnValue(pendingList.promise);
    const store = createProviderAccountsStore(api);
    const loading = store.getState().load();
    await store.getState().connect('codex-1');
    await store.getState().pollLogins();
    pendingList.resolve([slot(), slot('codex-2')]); await loading;
    expect(store.getState().accounts.find((item) => item.id === 'codex-1')?.status).toBe('connected');
    expect(store.getState().accounts).toHaveLength(2);
  });

  it('preserves last-good limits and exposes a failed refresh instead of fabricating zero/full quota', async () => {
    const api = client(); const store = createProviderAccountsStore(api);
    await store.getState().load(); await store.getState().refresh();
    vi.mocked(api.refresh).mockRejectedValue(new Error('probe failed'));
    await store.getState().refresh();
    expect(store.getState().accounts[0].usage?.resetTokens).toBe(3);
    expect(store.getState().accounts[0].status).toBe('error');
    expect(store.getState().accounts[0].lastSuccessAt).toBe(2000);
  });

  it('withholds the old identity and quota immediately while a replacement sign-in starts', async () => {
    const api = client(); const store = createProviderAccountsStore(api);
    await store.getState().load(); await store.getState().refresh();
    const begin = deferred<Awaited<ReturnType<ProviderAccountsClient['beginLogin']>>>();
    vi.mocked(api.beginLogin).mockReturnValue(begin.promise);
    const connecting = store.getState().connect('codex-1');
    expect(store.getState().accounts[0]).toMatchObject({ identity: null, usage: null, lastSuccessAt: null, status: 'authRequired' });
    begin.resolve({ accountId: 'codex-1', loginId: 'replacement', authUrl: 'https://auth.openai.com/authorize' });
    await connecting;
  });

  it('discards a late login completion after cancellation', async () => {
    const api = client(); const pendingPoll = deferred<Awaited<ReturnType<ProviderAccountsClient['pollLogin']>>>();
    vi.mocked(api.pollLogin).mockReturnValue(pendingPoll.promise);
    const store = createProviderAccountsStore(api); await store.getState().load();
    await store.getState().connect('codex-1');
    const polling = store.getState().pollLogins();
    await store.getState().cancelLogin('codex-1');
    pendingPoll.resolve({ status: 'completed', account: connected(), error: null }); await polling;
    expect(store.getState().accounts[0].identity).toBeNull();
    expect(store.getState().pendingLogins).toEqual({});
  });

  it('does not replace a slot with a mismatched account returned by a login response', async () => {
    const api = client(); const store = createProviderAccountsStore(api); await store.getState().load();
    await store.getState().connect('codex-1');
    vi.mocked(api.pollLogin).mockResolvedValue({ status: 'completed', account: { ...connected(), id: 'codex-2' }, error: null });
    await store.getState().pollLogins();
    expect(store.getState().accounts.every((item) => item.identity === null)).toBe(true);
    expect(store.getState().actionErrors['codex-1']).toBeTruthy();
  });

  it('removes a previous consumer identity when its current observation fails', async () => {
    const api = client(); const store = createProviderAccountsStore(api);
    vi.mocked(api.connections).mockResolvedValue([{ id: 'hermes-mother', providerId: 'openai-codex',
      identity: connected().identity, evidence: 'configured', observedAt: 1000, error: 'runtimeUnverified' }]);
    await store.getState().refreshConnections();
    expect(store.getState().connections[0].identity).not.toBeNull();
    vi.mocked(api.connections).mockRejectedValue(new Error('fixture disconnected'));
    await store.getState().refreshConnections();
    expect(store.getState().connections[0]).toMatchObject({ identity: null, providerId: null, evidence: 'unavailable', observedAt: null });
  });
});
