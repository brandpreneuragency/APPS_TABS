import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Task } from '../../types';
import { createRecordsFixture, cleanupRecordsFixtures } from '../../services/clients/recordsTestFixtures';
import type { RecordsFixture } from '../../services/clients/recordsTestFixtures';
import { ClientOverview } from './ClientOverview';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import i18n from '../../i18n';

let fixture: RecordsFixture;
let project: Project;
let tasks: Task[];

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, content: '', status: 'pending', importance: 'medium', date: '2099-01-01',
    projectId: project.id, assignees: [], createdAt: 1, updatedAt: 1, order: 0, ...overrides,
  };
}

beforeEach(async () => {
  fixture = await createRecordsFixture();
  await i18n.changeLanguage('en');
  project = { id: 'project-a', name: 'Northwind Roadmap', color: '#123456', clientId: 'client-a', createdAt: 1, order: 0 };
  await fixture.database.projects.add(project);
  tasks = [makeTask('open-task', { title: 'Prepare launch' }),
    makeTask('completed-task', { title: 'Closed work', status: 'completed' }),
    makeTask('deleted-task', { title: 'Removed work', deletedAt: 5 }),
    makeTask('child-task', { title: 'Subtask work', parentTaskId: 'open-task' })];
  useClientStore.setState({ clients: await fixture.database.clients.toArray(), isLoaded: true });
  useProjectStore.setState({ projects: [project], isLoaded: true });
  useTaskStore.setState({
    ...useTaskStore.getInitialState(), selectedClientId: 'client-a', selectedProjectId: null, tasks,
    openTabs: [{ tabId: 'empty', taskId: null, colorIndex: 0 }], activeTabId: 'empty', isLoaded: true,
  });
  useUIStore.setState({ ...useUIStore.getInitialState(), taskMode: false, crmMode: true, activeCRMPage: 'clients' });
});

afterEach(async () => {
  cleanup();
  await cleanupRecordsFixtures();
});

describe('ClientOverview', () => {
  it('shows real work and opens the exact project and task through existing actions', async () => {
    const onViewNotes = vi.fn();
    render(<ClientOverview clientId="client-a" records={fixture.records} onViewNotes={onViewNotes} />);

    expect(await screen.findByText('Prepare launch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project: Northwind Roadmap' })).toBeInTheDocument();
    expect(screen.queryByText('Removed work')).not.toBeInTheDocument();
    expect(screen.queryByText('Subtask work')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Work summary' })).getAllByText('1')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Open task: Prepare launch' }));
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'client-a', selectedProjectId: 'project-a', activeTaskId: 'open-task' });
    expect(useUIStore.getState().taskMode).toBe(true);
    expect(await screen.findByText('No notes found.')).toBeInTheDocument();

    act(() => {
      useUIStore.getState().setTaskMode(false);
      useUIStore.getState().setActiveTaskPage('list');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open project: Northwind Roadmap' }));
    expect(useTaskStore.getState()).toMatchObject({ selectedClientId: 'client-a', selectedProjectId: 'project-a' });
    expect(useUIStore.getState()).toMatchObject({ crmMode: true, activeCRMPage: 'projects' });
    fireEvent.click(screen.getAllByRole('button', { name: 'View all notes' })[0]);
    expect(onViewNotes).toHaveBeenCalledOnce();
  });

  it('shows actual latest notes, pinned notes, and last call or meeting', async () => {
    const noteInput = (id: string, kind: 'call' | 'meeting' | 'decision' | 'note', occurredAt: number, pinned = false) =>
      fixture.records.saveNote({ id, clientId: 'client-a', expectedRevision: null,
        value: { title: id, bodyText: 'Synthetic content', kind, occurredAt, contactId: null },
        draftId: null, generation: null, editSessionId: null }).then(async (result) => {
          if (!result.ok) throw new Error(`Could not seed ${id}`);
          if (pinned) await fixture.records.setNotePinned({ id, clientId: 'client-a', expectedRevision: result.value.revision, pinned: true });
        });
    await Promise.all([
      noteInput('decision-note', 'decision', 500, true),
      noteInput('call-note', 'call', 400),
      noteInput('meeting-note', 'meeting', 300),
    ]);

    render(<ClientOverview clientId="client-a" records={fixture.records} onViewNotes={vi.fn()} />);
    expect(await screen.findAllByText('decision-note')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Last call or meeting' })).toHaveTextContent('call-note');
  });

  it('shows and routes real No Client work without adding brand-only actions', async () => {
    const generalProject: Project = {
      id: 'project-general', name: 'Unassigned project', color: '#654321', clientId: 'general', createdAt: 2, order: 0,
    };
    const generalTask = makeTask('general-task', { projectId: generalProject.id, title: 'Unassigned follow-up' });
    await fixture.database.projects.add(generalProject);
    useProjectStore.setState({ projects: [project, generalProject], isLoaded: true });
    useTaskStore.setState({ ...useTaskStore.getState(), selectedClientId: 'general', tasks: [...tasks, generalTask] });

    render(<ClientOverview clientId="general" records={fixture.records} onViewNotes={vi.fn()}
      onCreateNote={vi.fn()} onProfile={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Open project: Unassigned project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open task: Unassigned follow-up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open task: Unassigned follow-up' }));
    expect(useTaskStore.getState()).toMatchObject({
      selectedClientId: 'general', selectedProjectId: 'project-general', activeTaskId: 'general-task',
    });
  });
});
