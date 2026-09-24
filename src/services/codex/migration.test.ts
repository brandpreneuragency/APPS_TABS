// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { crmFormsDb } from '../../data/crmFormsDb';
import { runCodexMigration, type MigrationBackup, type MigrationPorts } from './migration';

describe('Codex data and credential migration', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await Promise.all([db.delete(), crmFormsDb.delete()]);
    await Promise.all([db.open(), crmFormsDb.open()]);
    await db.agents.bulkAdd([
      { id: 'agent-1', name: 'First', avatarUrl: '', systemPrompt: 'Write', isDefault: true },
      { id: 'agent-2', name: 'Second', avatarUrl: '', systemPrompt: 'Plan', isDefault: false },
    ]);
    await db.chatThreads.add({ id: 'old-chat', origin: 'legacy_api', mode: 'writer',
      title: 'Older chat', createdAt: 1, updatedAt: 2 });
    await db.chatMessages.add({ id: 'old-message', threadId: 'old-chat', mode: 'writer',
      agentId: 'agent-1', role: 'assistant', content: 'A complete old answer', timestamp: 2 });
    await db.settings.bulkPut([
      { key: 'tavilyKey', value: 'synthetic-secret' },
      { key: 'providerApiKey_custom', value: 'synthetic-secret' },
      { key: 'systemInstructions', value: 'Keep the original instructions' },
    ]);
    await db.table('providerConfigs').add({ id: 'custom', name: 'Old API', apiKey: 'synthetic-secret' });
    await crmFormsDb.crmContacts.add({ id: 'contact-1', firstName: 'Synthetic', lastName: 'Person',
      tags: [], createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z' });
    await crmFormsDb.crmSettings.add({ key: 'formsDisplayMode', value: 'compact' });
  });

  it('removes only old TABS browser credential entries', async () => {
    localStorage.setItem('tabs:web-secure:providerApiKey_openai', 'synthetic-ciphertext');
    localStorage.setItem('unrelated-app-data', 'keep');
    sessionStorage.setItem('tabs:web-secure-key', 'synthetic-session-key');
    await runCodexMigration();
    expect(localStorage.getItem('tabs:web-secure:providerApiKey_openai')).toBeNull();
    expect(sessionStorage.getItem('tabs:web-secure-key')).toBeNull();
    expect(localStorage.getItem('unrelated-app-data')).toBe('keep');
  });

  it('backs up redacted data, restores a fixture, and resumes interrupted cleanup', async () => {
    const files = new Map<string, string>();
    const calls: string[][] = [];
    let failOnce = true;
    const ports: MigrationPorts = {
      backupDir: async () => 'isolated-backups',
      mkdir: async () => undefined,
      write: async (path, content) => { files.set(path, content); },
      read: async (path) => {
        const content = files.get(path);
        if (!content) throw new Error('Missing backup');
        return content;
      },
      legacyAgentId: async () => 'agent-2',
      cleanup: async (accounts) => {
        calls.push(accounts);
        if (failOnce) { failOnce = false; throw new Error('Synthetic keyring interruption'); }
      },
    };

    await expect(runCodexMigration(ports)).rejects.toThrow('Synthetic keyring interruption');
    expect(files.size).toBe(1);
    const backup = JSON.parse([...files.values()][0]) as MigrationBackup;
    expect(backup.tables.chatMessages).toMatchObject([{ id: 'old-message', content: 'A complete old answer' }]);
    expect(backup.tables.settings).toEqual(expect.arrayContaining([
      { key: 'systemInstructions', value: 'Keep the original instructions' },
    ]));
    expect(JSON.stringify(backup)).not.toContain('synthetic-secret');
    expect(backup.omittedProviderCount).toBe(1);
    expect(backup.crmFormsTables.crmContacts).toMatchObject([{ id: 'contact-1', firstName: 'Synthetic' }]);
    expect(backup.crmFormsTables.crmSettings).toEqual([{ key: 'formsDisplayMode', value: 'compact' }]);

    const restored = new Dexie('CodexMigrationRestoreFixture');
    restored.version(1).stores({ chatMessages: 'id, threadId', chatThreads: 'id', agents: 'id' });
    await restored.open();
    await restored.table('chatMessages').bulkAdd(backup.tables.chatMessages);
    await restored.table('chatThreads').bulkAdd(backup.tables.chatThreads);
    await restored.table('agents').bulkAdd(backup.tables.agents);
    expect(await restored.table('chatMessages').count()).toBe(1);
    expect((await restored.table('chatMessages').get('old-message')).content).toBe('A complete old answer');
    restored.close();
    await restored.delete();

    const restoredCrm = new Dexie('CodexMigrationCRMRestoreFixture');
    restoredCrm.version(1).stores({ crmContacts: 'id', crmSettings: 'key' });
    await restoredCrm.open();
    await restoredCrm.table('crmContacts').bulkAdd(backup.crmFormsTables.crmContacts);
    await restoredCrm.table('crmSettings').bulkAdd(backup.crmFormsTables.crmSettings);
    expect((await restoredCrm.table('crmContacts').get('contact-1')).firstName).toBe('Synthetic');
    expect((await restoredCrm.table('crmSettings').get('formsDisplayMode')).value).toBe('compact');
    restoredCrm.close();
    await restoredCrm.delete();

    expect(await db.providerConfigs.count()).toBe(0);
    expect(await db.settings.get('tavilyKey')).toBeUndefined();
    expect(await db.settings.get('providerApiKey_custom')).toBeUndefined();
    expect((await db.settings.get('activeAgentId'))?.value).toBe('agent-2');
    expect((await db.settings.get('codexMigrationStatus'))?.value).toBe('cleanup_pending');

    await runCodexMigration(ports);
    expect(files.size).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('providerApiKey_custom');
    expect((await db.settings.get('codexMigrationStatus'))?.value).toBe('complete');
    expect(await db.chatMessages.count()).toBe(1);
  });
});
