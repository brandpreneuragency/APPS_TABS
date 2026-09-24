/** Which assistant agent surface is active, and the chat-thread context key. */

export type TaskAssistantBinding = {
  mode: 'task';
  /** Real task id, or a synthetic `client:` / `project:` / `page:` key. */
  taskId: string | null;
};

const SYNTHETIC_PREFIXES = ['client:', 'project:', 'page:'] as const;

export function isSyntheticTaskContextId(id: string | null | undefined): id is string {
  if (!id) return false;
  return SYNTHETIC_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * Task Manager agents are used on the Tasks module and on CRM Clients /
 * Projects (and remaining CRM/Forms pages after CRM agents were removed).
 * Returns null for Documents / Settings, which keep writer agents.
 */
export function resolveTaskAssistantBinding(input: {
  taskMode: boolean;
  crmMode: boolean;
  activeCRMPage: string;
  activeTaskId: string | null;
  selectedClientId: string | null;
  selectedProjectId: string | null;
}): TaskAssistantBinding | null {
  if (input.taskMode) {
    return { mode: 'task', taskId: input.activeTaskId };
  }
  if (!input.crmMode) return null;

  const page = input.activeCRMPage;
  if (page === 'clients' || page === 'projects') {
    if (input.selectedProjectId) {
      return { mode: 'task', taskId: `project:${input.selectedProjectId}` };
    }
    if (input.selectedClientId) {
      return { mode: 'task', taskId: `client:${input.selectedClientId}` };
    }
    return { mode: 'task', taskId: `page:${page}` };
  }

  return { mode: 'task', taskId: `page:${page}` };
}
