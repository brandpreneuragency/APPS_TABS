import { create } from 'zustand';
import { providerAccountsClient } from './desktopClient';
import { CONSUMER_IDS, type AccountLoginStart, type ConsumerObservation, type ProviderAccount, type ProviderAccountsClient } from './types';

interface ProviderAccountsState {
  accounts: ProviderAccount[];
  connections: ConsumerObservation[];
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  observing: boolean;
  error: string | null;
  connectionError: string | null;
  actionErrors: Record<string, string>;
  pendingLogins: Record<string, AccountLoginStart>;
  load(): Promise<void>;
  refresh(accountId?: string): Promise<void>;
  refreshConnections(): Promise<void>;
  connect(accountId: string): Promise<void>;
  openLogin(accountId: string): Promise<void>;
  pollLogins(): Promise<void>;
  cancelLogin(accountId: string): Promise<void>;
}

export function createProviderAccountsStore(client: ProviderAccountsClient) {
  const versions = new Map<string, number>();
  const starting = new Set<string>();
  const polling = new Set<string>();
  const version = (id: string) => versions.get(id) ?? 0;
  const invalidate = (id: string) => versions.set(id, version(id) + 1);
  return create<ProviderAccountsState>((set, get) => {
    const merge = (rows: ProviderAccount[], expected: Map<string, number>, only?: Set<string>) => {
      const accounts = new Map(get().accounts.map((row) => [row.id, row]));
      for (const row of rows) {
        if ((!only || only.has(row.id)) && version(row.id) === (expected.get(row.id) ?? 0)) accounts.set(row.id, row);
      }
      set({ accounts: [...accounts.values()].sort((left, right) => left.id.localeCompare(right.id)) });
    };
    const actionError = (id: string, error: string) => set({ actionErrors: { ...get().actionErrors, [id]: error } });
    const clearActionError = (id: string) => {
      const actionErrors = { ...get().actionErrors }; delete actionErrors[id]; set({ actionErrors });
    };
    const removeLogin = (id: string) => {
      const pendingLogins = { ...get().pendingLogins }; delete pendingLogins[id]; set({ pendingLogins });
    };
    return {
      accounts: [], connections: CONSUMER_IDS.map((id) => ({ id, providerId: null, identity: null,
        evidence: 'unavailable', observedAt: null, error: null })),
      loaded: false, loading: false, refreshing: false, observing: false, error: null, connectionError: null,
      actionErrors: {}, pendingLogins: {},
      load: async () => {
        if (get().loading) return;
        const expected = new Map(versions); set({ loading: true, error: null });
        try { merge(await client.list(), expected); set({ loaded: true }); }
        catch { set({ error: 'loadFailed' }); }
        finally { set({ loading: false }); }
      },
      refresh: async (accountId) => {
        if (get().refreshing) return;
        const targets = new Set(get().accounts.filter((row) => (!accountId || row.id === accountId)
          && !get().pendingLogins[row.id] && !starting.has(row.id)).map((row) => row.id));
        if (!targets.size) return;
        targets.forEach(invalidate); const expected = new Map(versions);
        set({ refreshing: true, error: null });
        try { merge(await client.refresh(accountId), expected, targets); }
        catch {
          const accounts = get().accounts.map((row) => targets.has(row.id) && version(row.id) === expected.get(row.id)
            ? { ...row, status: 'error' as const, error: 'refreshFailed', lastAttemptAt: Date.now() } : row);
          set({ accounts, error: 'refreshFailed' });
        } finally { set({ refreshing: false }); }
      },
      refreshConnections: async () => {
        if (get().observing) return;
        set({ observing: true, connectionError: null });
        try {
          const rows = await client.connections();
          set({ connections: CONSUMER_IDS.map((id) => rows.find((row) => row.id === id)
            ?? { id, providerId: null, identity: null, evidence: 'unavailable', observedAt: null, error: 'sourceUnavailable' }) });
        } catch {
          set({ connectionError: 'connectionFailed', connections: get().connections.map((row) => ({
            ...row, providerId: null, identity: null, observedAt: null, evidence: 'unavailable', error: 'connectionFailed',
          })) });
        } finally { set({ observing: false }); }
      },
      connect: async (accountId) => {
        if (starting.has(accountId) || get().pendingLogins[accountId]) return;
        starting.add(accountId); invalidate(accountId); clearActionError(accountId);
        set({ accounts: get().accounts.map((row) => row.id === accountId ? {
          ...row, identity: null, usage: null, lastSuccessAt: null, status: 'authRequired', duplicateOf: null, error: null,
        } : row) });
        try {
          const login = await client.beginLogin(accountId);
          if (login.accountId !== accountId) { actionError(accountId, 'loginMismatch'); return; }
          set({ pendingLogins: { ...get().pendingLogins, [accountId]: login } });
          await get().openLogin(accountId);
        } catch { actionError(accountId, 'loginFailed'); }
        finally { starting.delete(accountId); }
      },
      openLogin: async (accountId) => {
        const login = get().pendingLogins[accountId]; if (!login) return;
        try { await client.openLogin(accountId, login.loginId); clearActionError(accountId); }
        catch { actionError(accountId, 'browserFailed'); }
      },
      pollLogins: async () => {
        await Promise.all(Object.entries(get().pendingLogins).map(async ([id, login]) => {
          if (polling.has(id)) return; polling.add(id);
          const epoch = version(id);
          try {
            const result = await client.pollLogin(id, login.loginId);
            if (version(id) !== epoch || get().pendingLogins[id]?.loginId !== login.loginId) return;
            if (result.status === 'pending') return;
            removeLogin(id);
            if (result.status !== 'completed' || result.account?.id !== id) {
              actionError(id, result.account && result.account.id !== id ? 'loginMismatch' : 'loginFailed'); return;
            }
            invalidate(id);
            set({ accounts: [...get().accounts.filter((row) => row.id !== id), result.account]
              .sort((left, right) => left.id.localeCompare(right.id)) });
          } catch {
            if (version(id) === epoch) actionError(id, 'loginFailed');
          } finally { polling.delete(id); }
        }));
      },
      cancelLogin: async (accountId) => {
        const login = get().pendingLogins[accountId]; if (!login) return;
        invalidate(accountId);
        try { await client.cancelLogin(accountId, login.loginId); removeLogin(accountId); clearActionError(accountId); }
        catch { actionError(accountId, 'cancelFailed'); }
      },
    };
  });
}

export const useProviderAccountsStore = createProviderAccountsStore(providerAccountsClient);
