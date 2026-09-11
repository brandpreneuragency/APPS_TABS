import type {
  AIProviderConfig,
  TaskAIContextScope,
  TaskAIDraft,
  TaskAIOperation,
  TaskStatus,
  TaskImportance,
} from '../types';
import { TASK_TITLE_MAX_LENGTH } from '../types';
import type { TaskAIContextPayload } from './taskAIContext';
import { completeChat } from './ai/router';

function shortId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BROAD_SCOPE_HINTS = ['all tasks', 'backlog', 'project plan', 'roadmap', 'sprint', 'everything'];

function extractJson(raw: string): string | null {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) return cleaned;

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeOperation(op: any): TaskAIOperation | null {
  const id = typeof op?.id === 'string' ? op.id : shortId('op');
  if (op?.type === 'create_task' && typeof op?.title === 'string') {
    const status = op.status as TaskStatus | undefined;
    const importance = op.importance as TaskImportance | undefined;
    return {
      id,
      type: 'create_task',
      title: op.title.trim().slice(0, TASK_TITLE_MAX_LENGTH),
      status,
      importance,
      date: typeof op.date === 'string' ? op.date : undefined,
      projectId: typeof op.projectId === 'string' ? op.projectId : '',
      content: typeof op.content === 'string' ? op.content : undefined,
      assignees: Array.isArray(op.assignees)
        ? op.assignees.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
    };
  }
  if (op?.type === 'update_task' && typeof op?.taskId === 'string' && op?.updates) {
    return {
      id,
      type: 'update_task',
      taskId: op.taskId,
      updates: op.updates?.title !== undefined
        ? { ...op.updates, title: op.updates.title.slice(0, TASK_TITLE_MAX_LENGTH) }
        : op.updates,
    };
  }
  if (op?.type === 'soft_delete_task' && typeof op?.taskId === 'string') {
    return {
      id,
      type: 'soft_delete_task',
      taskId: op.taskId,
      reason: typeof op.reason === 'string' ? op.reason : undefined,
    };
  }
  if (op?.type === 'add_comment' && typeof op?.taskId === 'string' && typeof op?.text === 'string') {
    return {
      id,
      type: 'add_comment',
      taskId: op.taskId,
      text: op.text.trim(),
    };
  }
  return null;
}

function hasBroadScopeIntent(text: string): boolean {
  const lowered = text.toLowerCase();
  return BROAD_SCOPE_HINTS.some((hint) => lowered.includes(hint));
}

function validateOperations(
  context: TaskAIContextPayload,
  operations: TaskAIOperation[],
  validProjectIds: Set<string>
) {
  const knownTaskIds = new Set([context.task.id]);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const operation of operations) {
    if (operation.type === 'create_task') {
      if (!operation.title.trim()) {
        errors.push('Create task operation is missing a title.');
      }
      if (operation.date && !ISO_DATE_RE.test(operation.date)) {
        errors.push(`Create task operation "${operation.title}" has invalid date format.`);
      }
      if (!operation.projectId.trim()) {
        errors.push(`Create task operation "${operation.title}" must include projectId.`);
      } else if (!validProjectIds.has(operation.projectId)) {
        errors.push(`Create task operation "${operation.title}" uses an unknown project.`);
      }
      continue;
    }

    if (operation.type === 'update_task') {
      if (!knownTaskIds.has(operation.taskId)) {
        errors.push(`Update operation references unknown task id "${operation.taskId}".`);
        continue;
      }
      if (typeof operation.updates.date === 'string' && !ISO_DATE_RE.test(operation.updates.date)) {
        errors.push(`Update operation for "${operation.taskId}" has invalid date format.`);
      }
      if (
        typeof operation.updates.projectId === 'string' &&
        operation.updates.projectId.trim() &&
        !validProjectIds.has(operation.updates.projectId)
      ) {
        errors.push(`Update operation for "${operation.taskId}" uses an unknown project.`);
      }
      continue;
    }

    if (operation.type === 'soft_delete_task') {
      if (!knownTaskIds.has(operation.taskId)) {
        errors.push(`Soft delete operation references unknown task id "${operation.taskId}".`);
      }
      continue;
    }

    if (operation.type === 'add_comment') {
      if (!knownTaskIds.has(operation.taskId)) {
        errors.push(`Add comment operation references unknown task id "${operation.taskId}".`);
      }
      if (!operation.text.trim()) {
        errors.push('Add comment operation cannot be empty.');
      }
    }
  }

  return {
    errors,
    warnings,
    duplicateSubtasks: [] as string[],
    staleTaskIds: [] as string[],
  };
}

interface PlannerOptions {
  userText: string;
  context: TaskAIContextPayload;
  provider: AIProviderConfig;
  systemPrompt: string;
  validProjectIds: Set<string>;
  searchResultsText?: string;
  signal?: AbortSignal;
}

export async function planTaskAIDraft({
  userText,
  context,
  provider,
  systemPrompt,
  validProjectIds,
  searchResultsText,
  signal,
}: PlannerOptions): Promise<TaskAIDraft> {
  const scope: TaskAIContextScope = 'active_task';

  if (hasBroadScopeIntent(userText)) {
    return {
      id: shortId('draft'),
      taskId: context.task.id,
      scope,
      assistantMessage:
        'This request sounds broader than the active task. Reply with "include visible tasks" or "include all tasks" if you want a broader planning pass.',
      summary: 'Scope confirmation required',
      operations: [],
      createdAt: Date.now(),
      baselineUpdatedAt: context.baselineUpdatedAt,
      needsScopeConfirmation:
        'This request appears to require broader context than the active task. Confirm broader scope to continue.',
      validation: {
        errors: [],
        warnings: [],
        duplicateSubtasks: [],
        staleTaskIds: [],
      },
    };
  }

  const schemaDescription = `Return ONLY JSON object with this shape:
{
  "assistantMessage": "string",
  "summary": "short summary",
  "operations": [
    { "type": "create_task", "title": "string", "status": "pending|in_progress|completed", "importance": "low|medium|high", "date": "YYYY-MM-DD", "projectId": "string", "content": "optional notes", "assignees": ["name"] },
    { "type": "update_task", "taskId": "string", "updates": { "title": "string", "status": "pending|in_progress|completed", "importance": "low|medium|high", "date": "YYYY-MM-DD", "projectId": "string|null", "content": "string", "assignees": ["name"] } },
    { "type": "soft_delete_task", "taskId": "string", "reason": "optional" },
    { "type": "add_comment", "taskId": "string", "text": "string" }
  ]
}
Do not include markdown.`;

  const messages = [
    {
      role: 'system' as const,
      content: `${systemPrompt}

You are in task mode with ACTIVE TASK context only. Propose safe operations.
Never propose permanent delete. Use soft_delete_task only when explicitly requested.
If uncertain, keep operations empty and explain in assistantMessage.
${schemaDescription}`,
    },
    {
      role: 'user' as const,
      content: `User request:
${userText}

Task context:
${context.text}
${searchResultsText ? `\n\nWeb search context:\n${searchResultsText}` : ''}`,
    },
  ];

  const raw = await completeChat(messages, provider, signal);
  const parsedJson = extractJson(raw);
  if (!parsedJson) {
    return {
      id: shortId('draft'),
      taskId: context.task.id,
      scope,
      assistantMessage: raw.trim() || 'I could not produce a structured draft. Please rephrase the request.',
      summary: 'No structured draft generated',
      operations: [],
      createdAt: Date.now(),
      baselineUpdatedAt: context.baselineUpdatedAt,
      validation: {
        errors: ['The model did not return valid JSON.'],
        warnings: [],
        duplicateSubtasks: [],
        staleTaskIds: [],
      },
    };
  }

  try {
    const parsed = JSON.parse(parsedJson);
    const operations = Array.isArray(parsed.operations)
      ? parsed.operations
          .map((operation: unknown) => normalizeOperation(operation))
          .filter((operation: TaskAIOperation | null): operation is TaskAIOperation => Boolean(operation))
          .map((operation: TaskAIOperation) => {
            if (operation.type === 'create_task' && !operation.projectId.trim()) {
              return { ...operation, projectId: context.task.projectId };
            }
            return operation;
          })
      : [];

    const validation = validateOperations(context, operations, validProjectIds);
    return {
      id: shortId('draft'),
      taskId: context.task.id,
      scope,
      assistantMessage:
        typeof parsed.assistantMessage === 'string'
          ? parsed.assistantMessage
          : 'Draft generated. Review the proposed operations below.',
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Task AI draft',
      operations,
      createdAt: Date.now(),
      baselineUpdatedAt: context.baselineUpdatedAt,
      validation,
    };
  } catch {
    return {
      id: shortId('draft'),
      taskId: context.task.id,
      scope,
      assistantMessage: raw.trim() || 'I could not parse a structured draft from the model output.',
      summary: 'Draft parsing failed',
      operations: [],
      createdAt: Date.now(),
      baselineUpdatedAt: context.baselineUpdatedAt,
      validation: {
        errors: ['Failed to parse the model JSON output.'],
        warnings: [],
        duplicateSubtasks: [],
        staleTaskIds: [],
      },
    };
  }
}
