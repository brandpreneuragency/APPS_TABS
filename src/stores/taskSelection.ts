import { nameKey } from './taskTreeNames';

export function filterTasksForSelection<T extends { projectId: string; deletedAt?: number }>(
  tasks: readonly T[],
  projects: readonly { id: string; clientId: string }[],
  selectedClientId: string | null,
  selectedProjectId: string | null,
): T[] {
  const living = tasks.filter((t) => !t.deletedAt);

  if (selectedProjectId) {
    return living.filter((t) => t.projectId === selectedProjectId);
  }

  if (selectedClientId) {
    const projectIds = new Set(
      projects.filter((p) => p.clientId === selectedClientId).map((p) => p.id),
    );
    return living.filter((t) => projectIds.has(t.projectId));
  }

  return [...living];
}

export function projectsForClient<T extends { clientId: string }>(
  projects: readonly T[],
  clientId: string | null,
): T[] {
  if (!clientId) return [];
  return projects.filter((p) => p.clientId === clientId);
}

export function resolveQuickCreateProjectId(
  selectedClientId: string | null,
  selectedProjectId: string | null,
  projects: readonly { id: string; clientId: string; name: string }[],
): string | null {
  if (selectedProjectId) return selectedProjectId;
  if (!selectedClientId) return null;
  const general = projects.find(
    (p) => p.clientId === selectedClientId && nameKey(p.name) === nameKey('General'),
  );
  return general?.id ?? null;
}

export function kanbanColumnsForClient(
  projects: readonly { id: string; name: string; color: string; clientId: string }[],
  tasks: readonly { id: string; projectId: string; deletedAt?: number }[],
  selectedClientId: string | null,
): { id: string; name: string; color: string; taskIds: string[] }[] {
  const clientProjects = selectedClientId ? projectsForClient(projects, selectedClientId) : projects;
  return clientProjects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    taskIds: tasks
      .filter((t) => !t.deletedAt && t.projectId === p.id)
      .map((t) => t.id),
  }));
}
