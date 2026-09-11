import type { Project } from '../types';

export const NAME_MAX = 80;

export const TREE_COLORS = [
  'text-blue-500',
  'text-emerald-500',
  'text-amber-500',
  'text-rose-500',
  'text-violet-500',
  'text-cyan-500',
  'text-orange-500',
  'text-pink-500',
];

const FS_UNSAFE = /[<>:"/\\|?*\x00-\x1F]/g; // eslint-disable-line no-control-regex -- Sanitize for filesystem

export function normalizeTreeName(raw: string): string {
  return raw.trim().slice(0, NAME_MAX);
}

/** Case key: tr-TR lower, then fold dotless ı→i so ASCII I/i collide (WAGNER vs Wagner). */
export function nameKey(name: string): string {
  return name.toLocaleLowerCase('tr-TR').replace(/\u0131/g, 'i');
}

export function isNameTaken(name: string, existing: readonly string[]): boolean {
  const key = nameKey(name);
  return existing.some((e) => nameKey(e) === key);
}

export function uniqueClientName(desired: string, existing: readonly string[]): string {
  if (!isNameTaken(desired, existing)) return desired;
  let n = 2;
  let candidate = `${desired} ${n}`;
  while (isNameTaken(candidate, existing)) {
    n += 1;
    candidate = `${desired} ${n}`;
  }
  return candidate;
}

export function sanitizeFsName(name: string): string {
  return name.replace(FS_UNSAFE, '_');
}

export function projectMirrorDir(clientName: string, projectName: string): string {
  return `TASKS/${sanitizeFsName(clientName)}/${sanitizeFsName(projectName)}`;
}

export function taskMirrorDir(clientName: string, projectName: string, taskId: string): string {
  return `${projectMirrorDir(clientName, projectName)}/${taskId}`;
}

export function formatProjectIndex(projectName: string, tasks: readonly { id: string; title: string }[]): string {
  const list = tasks.map((t) => `- [${t.id}] ${t.title}`).join('\n');
  return `# ${projectName} Tasks\n\n${list}`;
}

/** Half-applied v13: no clients yet, and every project row still lacks clientId. */
export function shouldRepairClientsLayer(
  clients: { length: number },
  projects: readonly { clientId?: string }[],
): boolean {
  if (clients.length > 0 || projects.length === 0) return false;
  return projects.every((p) => typeof p.clientId !== 'string' || p.clientId.length === 0);
}

/** Seed General client+project only when clients, projects, and tasks are all gone. */
export function shouldSeedEmptyClientsLayer(
  clients: { length: number },
  projects: { length: number },
  tasks: { length: number },
): boolean {
  return clients.length === 0 && projects.length === 0 && tasks.length === 0;
}

export function findProjectByNameInClient<T extends { name: string; clientId: string }>(
  name: string,
  clientId: string,
  projects: readonly T[],
): T | undefined {
  if (!clientId) return undefined;
  const key = nameKey(name);
  return projects.find((p) => p.clientId === clientId && nameKey(p.name) === key);
}

/** Existing General for `clientId` (name key `general`), or a new record. */
export function ensureGeneralProjectRecord(
  clientId: string,
  existing: readonly Project[],
  opts: { id: () => string; now: number; color: string },
): { project: Project; created: boolean } {
  const found = existing.find(
    (p) => p.clientId === clientId && nameKey(p.name) === 'general',
  );
  if (found) return { project: found, created: false };
  return {
    project: {
      id: opts.id(),
      name: 'General',
      color: opts.color,
      clientId,
      createdAt: opts.now,
      order: 0,
    },
    created: true,
  };
}
