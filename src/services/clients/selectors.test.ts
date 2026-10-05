import { describe, expect, it } from 'vitest';
import type { ClientNote } from '../../types/clients';
import type { Project, Task } from '../../types';
import { selectClientOverviewNotes, selectClientOverviewWork } from './selectors';

const projects: Project[] = [
  { id: 'project-a', name: 'A', color: '#123456', clientId: 'brand-a', createdAt: 1, order: 0 },
  { id: 'project-b', name: 'B', color: '#654321', clientId: 'brand-b', createdAt: 2, order: 0 },
  { id: 'project-general', name: 'General', color: '#777777', clientId: 'general', createdAt: 3, order: 0 },
];

const task = (id: string, projectId: string, overrides: Partial<Task> = {}): Task => ({
  id, title: id, content: '', status: 'pending', importance: 'medium', date: '2026-10-01',
  projectId, assignees: [], createdAt: 1, updatedAt: 1, order: 0, ...overrides,
});

const note = (id: string, occurredAt: number, overrides: Partial<ClientNote> = {}): ClientNote => ({
  id, clientId: 'brand-a', title: id, bodyText: '', kind: 'note', occurredAt,
  contactId: null, contactSnapshot: null, pinned: false, authorId: 'synthetic', revision: 1,
  createdAt: occurredAt, updatedAt: occurredAt, ...overrides,
});

describe('client overview selectors', () => {
  it('counts only live top-level tasks in the selected client scope', () => {
    const tasks = [
      task('open', 'project-a', { date: '2026-10-05' }),
      task('overdue', 'project-a', { date: '2026-10-02' }),
      task('completed', 'project-a', { status: 'completed', date: '2026-10-01' }),
      task('deleted', 'project-a', { deletedAt: 20 }),
      task('subtask', 'project-a', { parentTaskId: 'open' }),
      task('other-client', 'project-b'),
    ];

    expect(selectClientOverviewWork({ clientId: 'brand-a', projects, tasks, today: '2026-10-05' }))
      .toMatchObject({ total: 3, open: 2, completed: 1, overdue: 1, activeProjects: 1 });
    expect(selectClientOverviewWork({ clientId: 'general', projects, tasks: [task('unassigned', 'project-general')], today: '2026-10-05' }))
      .toMatchObject({ total: 1, open: 1, completed: 0, overdue: 1, activeProjects: 1 });
    expect(selectClientOverviewWork({ clientId: null, projects, tasks, today: '2026-10-05' }).total).toBe(4);
  });

  it('returns the latest five live notes, at most five pins, and only a call or meeting as last contact', () => {
    const notes = [
      ...Array.from({ length: 7 }, (_, index) => note(`note-${index}`, index + 1, { pinned: index < 6 })),
      note('decision', 20, { kind: 'decision', pinned: true }),
      note('call', 18, { kind: 'call' }),
      note('meeting', 17, { kind: 'meeting' }),
      note('deleted', 30, { deletedAt: 31, kind: 'call' }),
    ];

    const selected = selectClientOverviewNotes(notes);
    expect(selected.latest.map((item) => item.id)).toEqual(['decision', 'call', 'meeting', 'note-6', 'note-5']);
    expect(selected.pinned).toHaveLength(5);
    expect(selected.lastContact?.id).toBe('call');
    expect(selected.latest).not.toContainEqual(expect.objectContaining({ id: 'deleted' }));
  });
});
