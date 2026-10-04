import Dexie, { type Table } from 'dexie';
import { isClientsAcceptanceRuntime } from '../runtime';

export interface AcceptanceDiagnostics {
  schemaVersion: number;
  identifier: string;
  pid: number;
  executablePath: string;
  executableSha256: string;
  appData: string;
  appLocalData: string;
  appConfig: string;
  webviewProfile: string;
  credentialService: string;
  privateRoot: string;
  databaseName: string;
  startupAt: number;
  previousStartupAt: number | null;
  uiIpcReached: boolean;
  sendsEnabled: false;
  g1Passed: false;
}

export interface GmailAuthStatus {
  configReady: boolean;
  accountPresent: boolean;
  mailbox: string | null;
  verifiedThisRun: boolean;
  refreshVerifiedThisRun: boolean;
  checkedAt: number | null;
  busy: boolean;
  sendsEnabled: false;
}

export interface ReadAccessReport {
  status: 'passed';
  checkedAt: number;
  listEndpointVerified: boolean;
  messageContentDownloaded: false;
  noSendPerformed: true;
  g1Passed: false;
}

export const authErrorCodes = [
  'AUTH_REQUIRED', 'AUTH_CANCELLED', 'AUTH_TIMEOUT', 'ACCOUNT_MISMATCH', 'SCOPE_MISSING',
  'OFFLINE', 'RATE_LIMITED', 'ACCESS_BLOCKED', 'VALIDATION', 'CONFLICT', 'FILE_UNAVAILABLE',
  'CREDENTIAL_STORAGE', 'CALLBACK_UNAVAILABLE', 'BROWSER_UNAVAILABLE', 'RANDOM_UNAVAILABLE', 'UNSUPPORTED_RUNTIME',
] as const;
export type AuthErrorCode = typeof authErrorCodes[number];

export function authErrorCode(error: unknown): AuthErrorCode {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return authErrorCodes.find((code) => code === error.code) ?? 'CONFLICT';
  }
  return 'CONFLICT';
}

async function invokeAcceptance<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isClientsAcceptanceRuntime()) throw { code: 'UNSUPPORTED_RUNTIME' };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export const acceptance = {
  diagnostics: () => invokeAcceptance<AcceptanceDiagnostics>('clients_acceptance_diagnostics'),
  status: () => invokeAcceptance<GmailAuthStatus>('gmail_status'),
  connect: (expectedMailbox: string) => invokeAcceptance<GmailAuthStatus>('gmail_connect', { expectedMailbox }),
  refresh: () => invokeAcceptance<GmailAuthStatus>('gmail_refresh'),
  checkReadAccess: () => invokeAcceptance<ReadAccessReport>('gmail_check_read_access'),
  cancel: () => invokeAcceptance<void>('gmail_cancel'),
  disconnect: () => invokeAcceptance<GmailAuthStatus>('gmail_disconnect'),
  quit: () => invokeAcceptance<void>('clients_acceptance_quit'),
};

interface Sentinel { id: string; firstStartup: number; lastStartup: number }

/** Synthetic sentinel only; never imports the production database or migrations. */
export async function checkAcceptanceStorage(startupAt: number): Promise<boolean> {
  if (!isClientsAcceptanceRuntime()) throw { code: 'UNSUPPORTED_RUNTIME' };
  const db = new Dexie('TABSClientsAcceptanceProbe');
  db.version(1).stores({ sentinel: 'id' });
  const table: Table<Sentinel, string> = db.table('sentinel');
  try {
    return await db.transaction('rw', table, async () => {
      const previous = await table.get('isolation');
      const firstStartup = previous?.firstStartup ?? startupAt;
      await table.put({ id: 'isolation', firstStartup, lastStartup: startupAt });
      return firstStartup !== startupAt;
    });
  } finally { db.close(); }
}
