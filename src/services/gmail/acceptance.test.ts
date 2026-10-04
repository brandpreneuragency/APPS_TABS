import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptance, authErrorCode, checkAcceptanceStorage } from './acceptance';
import { isClientsAcceptanceRuntime } from '../runtime';

vi.mock('../runtime', () => ({ isClientsAcceptanceRuntime: vi.fn(() => false) }));

afterEach(async () => { vi.mocked(isClientsAcceptanceRuntime).mockReturnValue(false); await Dexie.delete('TABSClientsAcceptanceProbe'); });

describe('acceptance boundary', () => {
  it('refuses browser and production runtime before native invocation or database access', async () => {
    await expect(acceptance.connect('fixture@example.invalid')).rejects.toEqual({ code: 'UNSUPPORTED_RUNTIME' });
    await expect(acceptance.checkReadAccess()).rejects.toEqual({ code: 'UNSUPPORTED_RUNTIME' });
    await expect(checkAcceptanceStorage(100)).rejects.toEqual({ code: 'UNSUPPORTED_RUNTIME' });
  });
  it('does not display raw provider errors or unknown error content', () => {
    expect(authErrorCode('private provider response')).toBe('CONFLICT');
    expect(authErrorCode({ code: 'private-content', detail: 'private' })).toBe('CONFLICT');
    expect(authErrorCode({ code: 'SCOPE_MISSING' })).toBe('SCOPE_MISSING');
  });
  it('distinguishes a repeated same-process read from persistence across restart', async () => {
    vi.mocked(isClientsAcceptanceRuntime).mockReturnValue(true);
    expect(await checkAcceptanceStorage(100)).toBe(false);
    expect(await checkAcceptanceStorage(100)).toBe(false);
    expect(await checkAcceptanceStorage(200)).toBe(true);
  });
});
