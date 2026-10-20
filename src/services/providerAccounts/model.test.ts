import { describe, expect, it } from 'vitest';
import { accountConnections, accountIsStale, remainingPercent, usageWindow } from './model';
import type { ConsumerObservation, ProviderAccount } from './types';

const account: ProviderAccount = {
  id: 'codex-1', providerId: 'openai-codex', label: 'Codex 1',
  identity: { key: 'principal-a:workspace-a', email: 'synthetic@example.invalid', workspaceId: 'workspace-a', plan: 'pro' },
  status: 'connected', duplicateOf: null, lastAttemptAt: 1000, lastSuccessAt: 1000, error: null,
  usage: { windows: [], resetTokens: null },
};

describe('provider account presentation rules', () => {
  it('keeps unavailable and invalid percentages unknown rather than reporting full quota', () => {
    expect(remainingPercent(null)).toBeNull();
    expect(remainingPercent(Number.NaN)).toBeNull();
    expect(remainingPercent(-1)).toBeNull();
    expect(remainingPercent(101)).toBeNull();
    expect(remainingPercent(0)).toBe(100);
    expect(remainingPercent(100)).toBe(0);
    expect(remainingPercent(33.5)).toBe(66.5);
  });

  it('identifies five-hour and weekly windows by duration, not response order', () => {
    const usage = { windows: [
      { id: 'primary', windowMinutes: 10080, usedPercent: 70, resetsAt: 9000 },
      { id: 'secondary', windowMinutes: 300, usedPercent: 25, resetsAt: 5000 },
    ], resetTokens: 3 };
    expect(usageWindow(usage, 300)?.usedPercent).toBe(25);
    expect(usageWindow(usage, 10080)?.usedPercent).toBe(70);
    expect(usageWindow(null, 300)).toBeNull();
    expect(usageWindow({ ...usage, windows: [] }, 300)).toBeNull();
  });

  it('never claims old snapshots became fresh because a reset time passed', () => {
    expect(accountIsStale(account, 400000)).toBe(true);
    expect(accountIsStale({ ...account, status: 'error', lastAttemptAt: 2000 }, 2000)).toBe(true);
    expect(accountIsStale({ ...account, lastSuccessAt: null }, 1000)).toBe(true);
    expect(accountIsStale(account, 2000)).toBe(false);
  });

  it('matches consumer bindings by provider and principal/workspace key, never email alone', () => {
    const observation: ConsumerObservation = {
      id: 'hermes-mother', providerId: 'openai-codex', identity: account.identity,
      evidence: 'configured', observedAt: 1000, error: null,
    };
    expect(accountConnections(account, [observation])).toEqual([observation]);
    expect(accountConnections(account, [{ ...observation, identity: { ...account.identity!, key: 'other-workspace' } }])).toEqual([]);
    expect(accountConnections(account, [{ ...observation, evidence: 'unavailable' }])).toEqual([]);
    expect(accountConnections(account, [{ ...observation, providerId: 'another-provider' }])).toEqual([]);
    expect(accountConnections({ ...account, identity: null }, [observation])).toEqual([]);
  });
});
