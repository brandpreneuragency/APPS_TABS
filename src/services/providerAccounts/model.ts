import type { AccountUsage, ConsumerObservation, ProviderAccount, UsageWindow } from './types';

export const USAGE_REFRESH_MS = 5 * 60 * 1000;
export const SNAPSHOT_MAX_AGE_MS = USAGE_REFRESH_MS + 60 * 1000;

export function remainingPercent(used: number | null): number | null {
  if (used === null || !Number.isFinite(used) || used < 0 || used > 100) return null;
  return 100 - used;
}

export function usageWindow(usage: AccountUsage | null, minutes: number): UsageWindow | null {
  return usage?.windows.find((window) => window.windowMinutes === minutes) ?? null;
}

export function accountIsStale(account: ProviderAccount, now: number): boolean {
  return account.status !== 'connected' || account.lastSuccessAt === null
    || now - account.lastSuccessAt > SNAPSHOT_MAX_AGE_MS;
}

export function accountConnections(account: ProviderAccount, observations: ConsumerObservation[]): ConsumerObservation[] {
  const key = account.identity?.key;
  if (!key) return [];
  return observations.filter((observation) => observation.evidence !== 'unavailable'
    && observation.providerId === account.providerId && observation.identity?.key === key);
}
