import type { Task, TaskComment } from '../types';

export interface TaskAIContextPayload {
  task: Task;
  comments: TaskComment[];
  baselineUpdatedAt: Record<string, number>;
  text: string;
}

function formatComment(comment: TaskComment): string {
  const timestamp = new Date(comment.createdAt).toISOString();
  const attachmentMeta = comment.attachmentDataUrl
    ? ' | attachment: [local file]'
    : '';
  return `- [${timestamp}] ${comment.text || '(no text)'}${attachmentMeta}`;
}

export function buildTaskAIContext(
  task: Task,
  comments: TaskComment[],
  meta?: { clientName?: string; projectName?: string },
): TaskAIContextPayload {
  const baselineUpdatedAt: Record<string, number> = {
    [task.id]: task.updatedAt,
  };

  const lines: string[] = [
    'ACTIVE TASK',
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `importance: ${task.importance}`,
    `date: ${task.date}`,
    `projectId: ${task.projectId ?? 'null'}`,
    `client: ${meta?.clientName ?? '(none)'}`,
    `project: ${meta?.projectName ?? '(none)'}`,
    `assignees: ${task.assignees.join(', ') || '(none)'}`,
    `updatedAt: ${task.updatedAt}`,
    '',
    'NOTES',
    task.content?.trim() ? task.content : '(empty)',
    '',
    'COMMENTS',
  ];

  if (comments.length === 0) {
    lines.push('- (none)');
  } else {
    for (const comment of comments) {
      lines.push(formatComment(comment));
    }
  }

  return {
    task,
    comments,
    baselineUpdatedAt,
    text: lines.join('\n'),
  };
}

export type ScopedWorkTask = { title: string; status: string };
export type ScopedWorkProject = { name: string; openTaskCount: number };

export type ScopedWorkAIContextInput =
  | {
      kind: 'client';
      clientName: string;
      projects: ScopedWorkProject[];
      openTasks: ScopedWorkTask[];
    }
  | {
      kind: 'project';
      clientName: string;
      projectName: string;
      openTasks: ScopedWorkTask[];
    }
  | {
      kind: 'page';
      page: string;
    };

function formatOpenTasks(tasks: ScopedWorkTask[]): string[] {
  if (tasks.length === 0) return ['- (none)'];
  return tasks.slice(0, 30).map((task) => `- [${task.status}] ${task.title}`);
}

/** Snapshot of the selected client/project (or CRM page) for Task Manager chat. */
export function buildScopedWorkAIContext(input: ScopedWorkAIContextInput): string {
  if (input.kind === 'page') {
    return ['ACTIVE VIEW', `page: ${input.page}`].join('\n');
  }

  if (input.kind === 'project') {
    return [
      'ACTIVE PROJECT',
      `client: ${input.clientName}`,
      `project: ${input.projectName}`,
      '',
      'OPEN TASKS',
      ...formatOpenTasks(input.openTasks),
    ].join('\n');
  }

  return [
    'ACTIVE CLIENT',
    `client: ${input.clientName}`,
    `projects: ${input.projects.length}`,
    ...input.projects.map(
      (project) => `- ${project.name} (${project.openTaskCount} open)`,
    ),
    '',
    'OPEN TASKS',
    ...formatOpenTasks(input.openTasks),
  ].join('\n');
}
