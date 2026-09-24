import { describe, expect, it } from 'vitest';
import {
  isSyntheticTaskContextId,
  resolveTaskAssistantBinding,
} from './taskAssistantBinding';

const base = {
  taskMode: false,
  crmMode: false,
  activeCRMPage: 'clients',
  activeTaskId: null as string | null,
  selectedClientId: null as string | null,
  selectedProjectId: null as string | null,
};

describe('isSyntheticTaskContextId', () => {
  it('accepts client, project, and page keys', () => {
    expect(isSyntheticTaskContextId('client:c1')).toBe(true);
    expect(isSyntheticTaskContextId('project:p1')).toBe(true);
    expect(isSyntheticTaskContextId('page:clients')).toBe(true);
  });

  it('rejects real task ids and empty values', () => {
    expect(isSyntheticTaskContextId('t1')).toBe(false);
    expect(isSyntheticTaskContextId('')).toBe(false);
    expect(isSyntheticTaskContextId(null)).toBe(false);
  });
});

describe('resolveTaskAssistantBinding', () => {
  it('uses the active task on the Tasks module', () => {
    expect(
      resolveTaskAssistantBinding({ ...base, taskMode: true, activeTaskId: 't1' }),
    ).toEqual({ mode: 'task', taskId: 't1' });
  });

  it('keeps writer surfaces (documents) unbound', () => {
    expect(resolveTaskAssistantBinding(base)).toBeNull();
  });

  it('binds Clients to the selected project, then client, then page', () => {
    expect(
      resolveTaskAssistantBinding({
        ...base,
        crmMode: true,
        activeCRMPage: 'clients',
        selectedProjectId: 'p1',
        selectedClientId: 'c1',
      }),
    ).toEqual({ mode: 'task', taskId: 'project:p1' });

    expect(
      resolveTaskAssistantBinding({
        ...base,
        crmMode: true,
        activeCRMPage: 'clients',
        selectedClientId: 'c1',
      }),
    ).toEqual({ mode: 'task', taskId: 'client:c1' });

    expect(
      resolveTaskAssistantBinding({
        ...base,
        crmMode: true,
        activeCRMPage: 'clients',
      }),
    ).toEqual({ mode: 'task', taskId: 'page:clients' });
  });

  it('binds Projects the same way as Clients', () => {
    expect(
      resolveTaskAssistantBinding({
        ...base,
        crmMode: true,
        activeCRMPage: 'projects',
        selectedClientId: 'c1',
      }),
    ).toEqual({ mode: 'task', taskId: 'client:c1' });
  });

  it('uses Task Manager agents on remaining CRM pages', () => {
    expect(
      resolveTaskAssistantBinding({
        ...base,
        crmMode: true,
        activeCRMPage: 'leads',
      }),
    ).toEqual({ mode: 'task', taskId: 'page:leads' });
  });
});
