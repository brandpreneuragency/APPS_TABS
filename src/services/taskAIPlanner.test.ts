import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProviderConfig, Task } from '../types';
import { buildTaskAIContext } from './taskAIContext';
import { planTaskAIDraft } from './taskAIPlanner';

vi.mock('./ai/router', () => ({
  completeChat: vi.fn(),
}));

import { completeChat } from './ai/router';

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

const provider: AIProviderConfig = {
  id: 'prov',
  name: 'Test',
  provider: 'custom',
  apiKey: 'k',
  selectedModel: 'm',
  isActive: true,
  baseUrl: 'http://localhost',
  customModels: [],
};

const context = buildTaskAIContext(task, []);

function plan() {
  return planTaskAIDraft({
    userText: 'Move this task',
    context,
    provider,
    systemPrompt: 'test',
    validProjectIds: new Set(['p1', 'p2']),
  });
}

describe('planTaskAIDraft projectId updates', () => {
  beforeEach(() => {
    vi.mocked(completeChat).mockReset();
  });

  it('documents update projectId as a required string', async () => {
    vi.mocked(completeChat).mockResolvedValue(JSON.stringify({
      assistantMessage: 'ok',
      summary: 'ok',
      operations: [],
    }));

    await planTaskAIDraft({
      userText: 'Plan the work',
      context,
      provider,
      systemPrompt: 'test',
      validProjectIds: new Set(['p1']),
    });

    const system = vi.mocked(completeChat).mock.calls[0][0][0].content;
    expect(system).toContain('"projectId": "string"');
    expect(system).not.toContain('"projectId": "string|null"');
  });

  it('rejects null projectId on update_task', async () => {
    vi.mocked(completeChat).mockResolvedValue(JSON.stringify({
      assistantMessage: 'ok',
      summary: 'ok',
      operations: [{ type: 'update_task', taskId: 't1', updates: { projectId: null } }],
    }));

    const draft = await plan();
    expect(draft.validation.errors.some((e) => /projectId/i.test(e))).toBe(true);
  });

  it('rejects empty projectId on update_task', async () => {
    vi.mocked(completeChat).mockResolvedValue(JSON.stringify({
      assistantMessage: 'ok',
      summary: 'ok',
      operations: [{ type: 'update_task', taskId: 't1', updates: { projectId: '' } }],
    }));

    const draft = await plan();
    expect(draft.validation.errors.some((e) => /projectId/i.test(e))).toBe(true);
  });

  it('accepts a known projectId string on update_task', async () => {
    vi.mocked(completeChat).mockResolvedValue(JSON.stringify({
      assistantMessage: 'ok',
      summary: 'ok',
      operations: [{ type: 'update_task', taskId: 't1', updates: { projectId: 'p2' } }],
    }));

    const draft = await plan();
    expect(draft.validation.errors).toEqual([]);
  });
});
