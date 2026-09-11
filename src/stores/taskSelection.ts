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

export function kanbanColumnsForClient(
  projects: readonly { id: string; name: string; color: string; clientId: string }[],
  tasks: readonly { id: string; projectId: string; deletedAt?: number }[],
  selectedClientId: string | null,
): { id: string; name: string; color: string; taskIds: string[] }[] {
  if (!selectedClientId) return [];

  const clientProjects = projectsForClient(projects, selectedClientId);
  return clientProjects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    taskIds: tasks
      .filter((t) => !t.deletedAt && t.projectId === p.id)
      .map((t) => t.id),
  }));
}
