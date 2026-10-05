import type { ClientNote } from '../../types/clients';
import type { Project, Task } from '../../types';

export interface ClientOverviewWork {
  projects: Project[];
  tasks: Task[];
  total: number;
  open: number;
  completed: number;
  overdue: number;
  activeProjects: number;
}

export function selectClientOverviewWork(input: {
  clientId: string | null;
  projects: readonly Project[];
  tasks: readonly Task[];
  today: string;
}): ClientOverviewWork {
  const projects = input.clientId === null
    ? [...input.projects]
    : input.projects.filter((project) => project.clientId === input.clientId);
  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = input.tasks.filter((task) => !task.deletedAt && !task.parentTaskId && projectIds.has(task.projectId));
  const openTasks = tasks.filter((task) => task.status !== 'completed');
  const activeProjectIds = new Set(openTasks.map((task) => task.projectId));
  return {
    projects,
    tasks,
    total: tasks.length,
    open: openTasks.length,
    completed: tasks.length - openTasks.length,
    overdue: openTasks.filter((task) => Boolean(task.date) && task.date < input.today).length,
    activeProjects: activeProjectIds.size,
  };
}

function compareNotes(left: ClientNote, right: ClientNote): number {
  return right.occurredAt - left.occurredAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function selectClientOverviewNotes(notes: readonly ClientNote[]): {
  latest: ClientNote[];
  pinned: ClientNote[];
  lastContact: ClientNote | null;
} {
  const live = notes.filter((note) => note.deletedAt === undefined).sort(compareNotes);
  return {
    latest: live.slice(0, 5),
    pinned: live.filter((note) => note.pinned).slice(0, 5),
    lastContact: live.find((note) => note.kind === 'call' || note.kind === 'meeting') ?? null,
  };
}
