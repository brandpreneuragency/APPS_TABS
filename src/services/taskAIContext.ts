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
