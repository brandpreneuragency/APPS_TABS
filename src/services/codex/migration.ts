import { db } from '../db';
import { crmFormsDb } from '../../data/crmFormsDb';
import { isTauriRuntime } from '../runtime';
import { mkdir, readTextFile, writeTextFile } from '../fs-adapter';

const STATUS_KEY = 'codexMigrationStatus';
const BACKUP_KEY = 'codexMigrationBackupPath';
const BACKUP_HASH_KEY = 'codexMigrationBackupHash';
const MANIFEST_KEY = 'codexMigrationManifest';
const OLD_SETTING_KEYS = [
  'activeProviderId', 'appManagementProviderId', 'hiddenModels', 'modelDefaults',
  'exaKey', 'tavilyKey', 'firecrawlKey', 'braveKey', 'searchProvider', 'enabled',
];
const KNOWN_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'opencode-go',
  'opencode-zen', 'nvidia', 'openrouter'];
const PREFERENCE_ACCOUNTS = ['activeAgentId', 'activeProviderId',
  'appManagementProviderId', 'hiddenModels'];

export interface MigrationPorts {
  backupDir: () => Promise<string>;
  mkdir: (path: string) => Promise<void>;
  write: (path: string, text: string) => Promise<void>;
  read: (path: string) => Promise<string>;
  legacyAgentId: () => Promise<string | null>;
  cleanup: (accounts: string[]) => Promise<void>;
}

export interface MigrationBackup {
  format: 'tabs-pre-codex-v2';
  createdAt: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
  crmFormsTables: Record<string, unknown[]>;
  crmFormsCounts: Record<string, number>;
  omittedProviderCount: number;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      /^(?:api.?key|access.?token|refresh.?token|password|secret|credential)$/i.test(key)
        ? '[REDACTED]' : redact(entry)]));
  }
  return value;
}

function isOldSetting(key: string): boolean {
  return OLD_SETTING_KEYS.includes(key) || key.startsWith('providerApiKey_');
}

export async function collectMigrationBackup(): Promise<MigrationBackup> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const crmFormsTables: Record<string, unknown[]> = {};
  const crmFormsCounts: Record<string, number> = {};
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) {
      const rows = await table.toArray();
      counts[table.name] = rows.length;
      if (table.name === 'providerConfigs') continue;
      tables[table.name] = table.name === 'settings'
        ? rows.filter((row: { key: string }) => !isOldSetting(row.key)).map(redact)
        : rows.map(redact);
    }
  });
  await crmFormsDb.transaction('r', crmFormsDb.tables, async () => {
    for (const table of crmFormsDb.tables) {
      const rows = await table.toArray();
      crmFormsCounts[table.name] = rows.length;
      crmFormsTables[table.name] = rows.map(redact);
    }
  });
  return { format: 'tabs-pre-codex-v2', createdAt: new Date().toISOString(),
    tables, counts, crmFormsTables, crmFormsCounts, omittedProviderCount: counts.providerConfigs ?? 0 };
}

export function verifyMigrationBackup(text: string, expected: MigrationBackup): void {
  const parsed = JSON.parse(text) as MigrationBackup;
  if (parsed.format !== 'tabs-pre-codex-v2' || !parsed.tables || !parsed.counts
    || !parsed.crmFormsTables || !parsed.crmFormsCounts) {
    throw new Error('Migration backup could not be verified');
  }
  for (const [name, rows] of Object.entries(expected.tables)) {
    if (!Array.isArray(parsed.tables[name]) || parsed.tables[name].length !== rows.length
      || parsed.counts[name] !== expected.counts[name]) {
      throw new Error(`Migration backup table ${name} could not be verified`);
    }
  }
  for (const [name, rows] of Object.entries(expected.crmFormsTables)) {
    if (!Array.isArray(parsed.crmFormsTables[name]) || parsed.crmFormsTables[name].length !== rows.length
      || parsed.crmFormsCounts[name] !== expected.crmFormsCounts[name]) {
      throw new Error(`Migration backup CRM/Forms table ${name} could not be verified`);
    }
  }
  if (text !== JSON.stringify(expected)) throw new Error('Migration backup changed after writing');
}

async function hashBackup(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

function accountManifest(providerIds: string[]): string[] {
  const ids = new Set([...KNOWN_PROVIDER_IDS, ...providerIds]);
  for (const id of ids) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error('Unsupported legacy provider ID in credential cleanup');
  }
  return [...PREFERENCE_ACCOUNTS, ...[...ids].map((id) => `providerApiKey_${id}`)];
}

async function defaultPorts(): Promise<MigrationPorts> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { appDataDir } = await import('@tauri-apps/api/path');
  return {
    backupDir: async () => `${(await appDataDir()).replace(/[\\/]$/, '')}/migration-backups`,
    mkdir: async (path) => { await mkdir(path, true); },
    write: async (path, content) => { await writeTextFile(path, content); },
    read: readTextFile,
    legacyAgentId: async () => invoke<string | null>('legacy_ai_preference'),
    cleanup: async (accounts) => { await invoke('legacy_ai_cleanup', { accounts }); },
  };
}

let startupMigration: Promise<void> | null = null;

async function cleanupBrowserLegacyCredentials(): Promise<void> {
  if (typeof window === 'undefined') return;
  const prefix = 'tabs:web-secure:';
  const activeKey = `${prefix}activeAgentId`;
  const savedActive = await db.settings.get('activeAgentId');
  if (typeof savedActive?.value !== 'string') {
    const encrypted = localStorage.getItem(activeKey);
    const session = sessionStorage.getItem('tabs:web-secure-key');
    if (encrypted && session) {
      try {
        const payload = JSON.parse(encrypted) as { iv: string; ct: string };
        const decode = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', decode(session), 'AES-GCM', false, ['decrypt']);
        const content = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(payload.iv) },
          key, decode(payload.ct));
        const agentId = new TextDecoder().decode(content);
        if (await db.agents.get(agentId)) await db.settings.put({ key: 'activeAgentId', value: agentId });
      } catch { /* Historic session key may already be unusable. */ }
    }
  }
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(prefix)) localStorage.removeItem(key);
  }
  sessionStorage.removeItem('tabs:web-secure-key');
}

/** Backup first, commit scoped DB cleanup, then retryable keyring cleanup. */
export async function runCodexMigration(ports?: MigrationPorts): Promise<void> {
  if (!ports && !isTauriRuntime()) return cleanupBrowserLegacyCredentials();
  if (!ports) {
    startupMigration ??= defaultPorts().then((native) => performMigration(native))
      .catch((error: unknown) => { startupMigration = null; throw error; });
    return startupMigration;
  }
  return performMigration(ports);
}

async function performMigration(ports: MigrationPorts): Promise<void> {
  if ((await db.settings.get(STATUS_KEY))?.value === 'complete') return;
  let backupPath = (await db.settings.get(BACKUP_KEY))?.value;
  if (typeof backupPath !== 'string' || !backupPath) {
    const backup = await collectMigrationBackup();
    const dir = await ports.backupDir();
    await ports.mkdir(dir);
    const name = `tabs-ai-pre-codex-${Date.now()}.json`;
    const newBackupPath = `${dir}/${name}`;
    backupPath = newBackupPath;
    const content = JSON.stringify(backup);
    await ports.write(newBackupPath, content);
    verifyMigrationBackup(await ports.read(newBackupPath), backup);
    const hash = await hashBackup(content);
    await db.transaction('rw', db.settings, async () => {
      await db.settings.put({ key: BACKUP_KEY, value: newBackupPath });
      await db.settings.put({ key: BACKUP_HASH_KEY, value: hash });
    });
  } else {
    const content = await ports.read(backupPath);
    const parsed = JSON.parse(content) as MigrationBackup;
    verifyMigrationBackup(content, parsed);
    const expectedHash = (await db.settings.get(BACKUP_HASH_KEY))?.value;
    if (typeof expectedHash !== 'string' || await hashBackup(content) !== expectedHash) {
      throw new Error('Migration backup hash changed; cleanup is paused');
    }
  }

  let manifestRow = await db.settings.get(MANIFEST_KEY);
  if (!manifestRow) {
    const [agents, providers, active, settings] = await Promise.all([
      db.agents.toArray(), db.providerConfigs.toArray(), db.settings.get('activeAgentId'), db.settings.toArray(),
    ]);
    const legacyAgentId = await ports.legacyAgentId();
    const selectedAgentId = [active?.value, legacyAgentId]
      .find((id) => typeof id === 'string' && agents.some((agent) => agent.id === id))
      ?? agents[0]?.id;
    const legacySettingKeys = settings.filter((row) => isOldSetting(row.key)).map((row) => row.key);
    const providerIdsFromSettings = legacySettingKeys.filter((key) => key.startsWith('providerApiKey_'))
      .map((key) => key.slice('providerApiKey_'.length));
    const manifest = accountManifest([...providers.map((provider) => provider.id), ...providerIdsFromSettings]);
    await db.transaction('rw', db.settings, db.providerConfigs, async () => {
      if (selectedAgentId) await db.settings.put({ key: 'activeAgentId', value: selectedAgentId });
      await db.settings.bulkDelete(legacySettingKeys);
      await db.providerConfigs.clear();
      await db.settings.put({ key: MANIFEST_KEY, value: JSON.stringify(manifest) });
      await db.settings.put({ key: STATUS_KEY, value: 'cleanup_pending' });
    });
    manifestRow = await db.settings.get(MANIFEST_KEY);
  }
  if (typeof manifestRow?.value !== 'string') throw new Error('Legacy credential cleanup manifest is missing');
  const accounts: unknown = JSON.parse(manifestRow.value);
  if (!Array.isArray(accounts) || accounts.some((entry) => typeof entry !== 'string')
    || accounts.length > 256 || accounts.some((entry) => !PREFERENCE_ACCOUNTS.includes(entry)
      && !/^providerApiKey_[A-Za-z0-9._-]{1,128}$/.test(entry))) {
    throw new Error('Legacy credential cleanup manifest is invalid');
  }
  await ports.cleanup(accounts);
  await db.settings.put({ key: STATUS_KEY, value: 'complete' });
}
