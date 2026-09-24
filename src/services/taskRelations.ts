import type { Task } from '../types';

/** First-release subtasks are one level deep and remain in the parent's project. */
export function assertSubtaskParent(parent: Task | undefined, projectId: string): asserts parent is Task {
  if (!parent || parent.deletedAt || parent.parentTaskId || parent.projectId !== projectId) {
    throw new Error('Subtask parent must be an active top-level task in the same project');
  }
}

export function assertTaskProjectChange(task: Task, projectId: string, activeChildCount: number): void {
  if (projectId === task.projectId) return;
  if (task.parentTaskId) throw new Error('Move the parent task before assigning its subtask');
  if (activeChildCount > 0) throw new Error('Move or remove the subtasks before assigning their parent');
}

export function assertTaskSoftDelete(activeChildCount: number): void {
  if (activeChildCount > 0) throw new Error('Move or remove the subtasks before deleting their parent');
}
