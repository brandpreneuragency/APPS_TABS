import type { Client, Project, Task } from '../types';
import { nameKey } from './taskTreeNames';

export function isNoClient(client: Pick<Client, 'name'>): boolean {
  return ['general', 'no client'].includes(nameKey(client.name));
}

export function clientProgress(projects: readonly Project[], tasks: readonly Task[], clientId: string | null, today: string) {
  const scopedProjects = clientId ? projects.filter((project) => project.clientId === clientId) : projects;
  const projectIds = new Set(scopedProjects.map((project) => project.id));
  const livingTasks = tasks.filter((task) => !task.deletedAt && projectIds.has(task.projectId));
  const completed = livingTasks.filter((task) => task.status === 'completed').length;
  const open = livingTasks.filter((task) => task.status !== 'completed');
  return {
    projects: scopedProjects.length,
    activeProjects: scopedProjects.filter((project) => open.some((task) => task.projectId === project.id)).length,
    total: livingTasks.length,
    completed,
    open: open.length,
    overdue: open.filter((task) => task.date && task.date < today).length,
    percent: livingTasks.length ? Math.round(completed / livingTasks.length * 100) : 0,
  };
}
