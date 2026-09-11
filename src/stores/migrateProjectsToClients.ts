export type LegacyProject = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  order?: number;
  clientId?: string;
};

export type LegacyTask = {
  id: string;
  projectId: string | null;
  parentId?: string;
  deletedAt?: number;
  [key: string]: unknown;
};

export type MigratedClient = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  order: number;
};

export type MigratedProject = {
  id: string;
  name: string;
  color: string;
  clientId: string;
  createdAt: number;
  order: number;
};

const DEFAULT_COLOR = 'text-blue-500';

/** Case key: tr-TR lower, then fold dotless ı→i so ASCII I/i collide (WAGNER vs Wagner). */
function nameKey(name: string): string {
  return name.toLocaleLowerCase('tr-TR').replace(/\u0131/g, 'i');
}

function stripParentId(tasks: readonly LegacyTask[]): LegacyTask[] {
  return tasks.map((t) => {
    const { parentId, ...rest } = t;
    void parentId;
    return rest;
  });
}

function uniqueClientName(desired: string, usedLower: Set<string>): string {
  let candidate = desired;
  let n = 2;
  while (usedLower.has(nameKey(candidate))) {
    candidate = `${desired} ${n}`;
    n += 1;
  }
  usedLower.add(nameKey(candidate));
  return candidate;
}

function seedGeneral(opts: { id: () => string; now: number }): {
  clients: MigratedClient[];
  projects: MigratedProject[];
} {
  const clientId = opts.id();
  const projectId = opts.id();
  return {
    clients: [
      {
        id: clientId,
        name: 'General',
        color: DEFAULT_COLOR,
        createdAt: opts.now,
        order: 0,
      },
    ],
    projects: [
      {
        id: projectId,
        name: 'General',
        color: DEFAULT_COLOR,
        clientId,
        createdAt: opts.now,
        order: 0,
      },
    ],
  };
}

export function migrateProjectsToClients(
  oldProjects: readonly LegacyProject[],
  oldTasks: readonly LegacyTask[],
  opts: { id: () => string; now: number },
): { clients: MigratedClient[]; projects: MigratedProject[]; tasks: LegacyTask[] } {
  if (
    oldProjects.length > 0 &&
    oldProjects.every((p) => typeof p.clientId === 'string' && p.clientId.length > 0)
  ) {
    return {
      clients: [],
      projects: [...oldProjects] as MigratedProject[],
      tasks: stripParentId(oldTasks),
    };
  }

  if (oldProjects.length === 0 && oldTasks.length === 0) {
    const seeded = seedGeneral(opts);
    return { ...seeded, tasks: [] };
  }

  const clients: MigratedClient[] = [];
  const projects: MigratedProject[] = [];
  const usedLower = new Set<string>();
  const rewrite = new Map<string, string>();

  oldProjects.forEach((p, index) => {
    const clientId = opts.id();
    const generalProjectId = opts.id();
    const name = uniqueClientName(p.name, usedLower);
    clients.push({
      id: clientId,
      name,
      color: p.color,
      createdAt: p.createdAt,
      order: p.order ?? index,
    });
    projects.push({
      id: generalProjectId,
      name: 'General',
      color: p.color,
      clientId,
      createdAt: opts.now,
      order: 0,
    });
    rewrite.set(p.id, generalProjectId);
  });

  const hasOrphans = oldTasks.some(
    (t) => t.projectId == null || !rewrite.has(t.projectId),
  );

  let orphanProjectId: string | undefined;
  if (hasOrphans) {
    let generalClient = clients.find((c) => nameKey(c.name) === 'general');
    if (!generalClient) {
      const clientId = opts.id();
      generalClient = {
        id: clientId,
        name: 'General',
        color: DEFAULT_COLOR,
        createdAt: opts.now,
        order: clients.length,
      };
      clients.push(generalClient);
      usedLower.add('general');
    }

    let generalProject = projects.find(
      (p) => p.clientId === generalClient!.id && p.name === 'General',
    );
    if (!generalProject) {
      generalProject = {
        id: opts.id(),
        name: 'General',
        color: generalClient.color,
        clientId: generalClient.id,
        createdAt: opts.now,
        order: 0,
      };
      projects.push(generalProject);
    }
    orphanProjectId = generalProject.id;
  }

  const tasks = oldTasks.map((t) => {
    const { parentId, ...rest } = t;
    void parentId;
    const projectId =
      t.projectId != null && rewrite.has(t.projectId)
        ? rewrite.get(t.projectId)!
        : orphanProjectId!;
    return { ...rest, projectId };
  });

  return { clients, projects, tasks };
}
