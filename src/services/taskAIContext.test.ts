import { describe, expect, it } from 'vitest';
import type { Task, TaskComment } from '../types';
import { buildScopedWorkAIContext, buildTaskAIContext } from './taskAIContext';

const task: Task = {
  id: 't1',
  title: 'Write brief',
  content: 'Kickoff notes',
  status: 'pending',
  importance: 'medium',
  date: '2026-09-11',
  projectId: 'p1',
  assignees: ['Ada'],
  createdAt: 1,
  updatedAt: 2,
  order: 0,
};

const comments: TaskComment[] = [
  {
    id: 'c1',
    taskId: 't1',
    text: 'Need the client logo',
    createdAt: 3,
  },
];

describe('buildTaskAIContext', () => {
  it('includes client and project lines and omits SUBTASKS', () => {
    const payload = buildTaskAIContext(task, comments, {
      clientName: 'Brandpreneur',
      projectName: 'General',
    });

    expect(payload.text).toContain('client: Brandpreneur');
    expect(payload.text).toContain('project: General');
    expect(payload.text).not.toContain('SUBTASKS');
    expect(payload).not.toHaveProperty('subtasks');
  });

  it('falls back to (none) when client/project meta is omitted', () => {
    const payload = buildTaskAIContext(task, []);

    expect(payload.text).toContain('client: (none)');
    expect(payload.text).toContain('project: (none)');
    expect(payload.text).not.toContain('SUBTASKS');
    expect(payload.text).toContain('COMMENTS');
    expect(payload.text).toContain('- (none)');
  });
});

describe('buildScopedWorkAIContext', () => {
  it('summarizes a selected client', () => {
    const text = buildScopedWorkAIContext({
      kind: 'client',
      clientName: 'Brandpreneur',
      projects: [{ name: 'General', openTaskCount: 2 }],
      openTasks: [{ title: 'Write brief', status: 'pending' }],
    });

    expect(text).toContain('ACTIVE CLIENT');
    expect(text).toContain('client: Brandpreneur');
    expect(text).toContain('- General (2 open)');
    expect(text).toContain('- [pending] Write brief');
  });

  it('summarizes a selected project', () => {
    const text = buildScopedWorkAIContext({
      kind: 'project',
      clientName: 'Brandpreneur',
      projectName: 'Website',
      openTasks: [{ title: 'Ship header', status: 'in_progress' }],
    });

    expect(text).toContain('ACTIVE PROJECT');
    expect(text).toContain('project: Website');
    expect(text).toContain('- [in_progress] Ship header');
  });
});
