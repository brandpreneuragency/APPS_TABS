import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { useTranslation } from 'react-i18next';
import type { ClientNote } from '../../types/clients';
import type { Project, Task } from '../../types';
import type { ClientRecordsAdapter } from '../../hooks/useClientAutosave';
import { isNoClient } from '../../stores/clientOverview';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { selectClientOverviewNotes, selectClientOverviewWork } from '../../services/clients/selectors';
import './clients.css';

interface ClientOverviewProps {
  clientId: string | null;
  records: ClientRecordsAdapter;
  onViewNotes: () => void;
  onCreateNote?: () => void;
  onProfile?: () => void;
}

type NotesState =
  | { scope: string; status: 'loading' }
  | { scope: string; status: 'error' }
  | { scope: string; status: 'ready'; notes: ClientNote[] };

function scopeKey(clientId: string | null): string {
  return clientId === null ? 'everything' : clientId;
}

function noteDisplayName(note: ClientNote, clients: ReturnType<typeof useClientStore.getState>['clients']): string {
  return clients.find((client) => client.id === note.clientId)?.name ?? note.clientId;
}

export function ClientOverview({ clientId, records, onViewNotes, onCreateNote, onProfile }: ClientOverviewProps) {
  const { t } = useTranslation();
  const projects = useProjectStore((state) => state.projects);
  const tasks = useTaskStore((state) => state.tasks);
  const clients = useClientStore((state) => state.clients);
  const client = clients.find((entry) => entry.id === clientId);
  const isLiveBrand = Boolean(client && !isNoClient(client));
  const key = scopeKey(clientId);
  const [notesState, setNotesState] = useState<NotesState>({ scope: key, status: 'loading' });
  const work = useMemo(() => selectClientOverviewWork({
    clientId,
    projects,
    tasks,
    today: new Date().toLocaleDateString('en-CA'),
  }), [clientId, projects, tasks]);

  useEffect(() => {
    let active = true;
    const subscription = liveQuery(() => records.listNotes({
      clientId,
      deleted: false,
      archived: false,
      query: '',
    })).subscribe({
      next: (result) => {
        if (!active) return;
        setNotesState(result.ok
          ? { scope: key, status: 'ready', notes: result.value }
          : { scope: key, status: 'error' });
      },
      error: () => {
        if (active) setNotesState({ scope: key, status: 'error' });
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [clientId, key, records]);

  const visibleNotes = notesState.scope === key && notesState.status === 'ready' ? notesState.notes : [];
  const noteSummary = selectClientOverviewNotes(visibleNotes);
  const projectsById = useMemo(() => new Map(work.projects.map((project) => [project.id, project])), [work.projects]);

  const openProject = (project: Project) => {
    useTaskStore.getState().setSelection(project.clientId, project.id);
    useUIStore.getState().setActiveTaskPage('projects');
  };
  const openTask = (task: Task, project: Project) => {
    useTaskStore.getState().setSelection(project.clientId, project.id);
    useUIStore.getState().setTaskMode(true);
    useTaskStore.getState().openTaskInActiveTab(task.id);
  };

  return (
    <div className="clients-overview" aria-busy={notesState.scope !== key || notesState.status === 'loading'}>
      <section className="clients-overview-actions" aria-label={t('clients.overviewActions')}>
        {onProfile && isLiveBrand && <button type="button" className="clients-button" onClick={onProfile}>
          {t('clients.profile')}
        </button>}
        {onCreateNote && (clientId === null || isLiveBrand)
          && <button type="button" className="clients-button clients-button--primary" onClick={onCreateNote}>
          {t('clients.addNote')}
        </button>}
      </section>

      <section className="clients-overview-metrics" aria-label={t('clients.workSummary')}>
        <div><span>{t('clients.projectsCount')}</span><strong>{work.projects.length}</strong></div>
        <div><span>{t('clients.openTasks')}</span><strong>{work.open}</strong></div>
        <div><span>{t('clients.completedTasks')}</span><strong>{work.completed}</strong></div>
        <div><span>{t('clients.overdueTasks')}</span><strong>{work.overdue}</strong></div>
      </section>

      <section className="clients-overview-section" aria-labelledby="clients-overview-projects-title">
        <h2 id="clients-overview-projects-title">{t('clients.projects')}</h2>
        {work.projects.length === 0 ? <p className="clients-muted">{t('clients.noProjects')}</p> :
          <ul className="clients-overview-list">
            {work.projects.map((project) => <li key={project.id}>
              <button type="button" className="clients-link-button"
                aria-label={t('clients.openProject', { project: project.name })} onClick={() => openProject(project)}>
                {project.name}
              </button>
            </li>)}
          </ul>}
      </section>

      <section className="clients-overview-section" aria-labelledby="clients-overview-tasks-title">
        <h2 id="clients-overview-tasks-title">{t('clients.tasks')}</h2>
        {work.tasks.length === 0 ? <p className="clients-muted">{t('clients.noTasks')}</p> :
          <ul className="clients-overview-list">
            {work.tasks.map((task) => {
              const project = projectsById.get(task.projectId);
              if (!project) return null;
              return <li key={task.id}>
                <button type="button" className="clients-link-button"
                  aria-label={t('clients.openTask', { task: task.title })} onClick={() => openTask(task, project)}>
                  {task.title}
                </button>
                <span className="clients-overview-task-project">{project.name}</span>
              </li>;
            })}
          </ul>}
      </section>

      {notesState.scope !== key || notesState.status === 'loading'
        ? <p className="clients-muted" role="status">{t('clients.loading')}</p>
        : notesState.status === 'error'
          ? <p className="clients-error" role="alert">{t('clients.loadFailed')}</p>
          : <>
            {noteSummary.lastContact && <section className="clients-overview-section" aria-label={t('clients.lastContact')}>
              <h2>{t('clients.lastContact')}</h2>
              <p className="clients-overview-last-contact">
                {noteSummary.lastContact.title} <time dateTime={new Date(noteSummary.lastContact.occurredAt).toISOString()}>
                  {new Date(noteSummary.lastContact.occurredAt).toLocaleString()}
                </time>
              </p>
            </section>}
            <section className="clients-overview-section" aria-labelledby="clients-overview-latest-title">
              <div className="clients-overview-section-heading">
                <h2 id="clients-overview-latest-title">{t('clients.latestNotes')}</h2>
                <button type="button" className="clients-link-button" onClick={onViewNotes}>{t('clients.viewAllNotes')}</button>
              </div>
              {noteSummary.latest.length === 0 ? <p className="clients-muted">{t('clients.noNotes')}</p> :
                <ul className="clients-overview-list">
                  {noteSummary.latest.map((note) => <li key={note.id}>
                    <span>{note.title || t('clients.untitledNote')}</span>
                    {clientId === null && <span className="clients-overview-task-project">{noteDisplayName(note, clients)}</span>}
                  </li>)}
                </ul>}
            </section>
            {noteSummary.pinned.length > 0 && <section className="clients-overview-section" aria-labelledby="clients-overview-pinned-title">
              <div className="clients-overview-section-heading">
                <h2 id="clients-overview-pinned-title">{t('clients.pinnedNotes')}</h2>
                <button type="button" className="clients-link-button" onClick={onViewNotes}>{t('clients.viewAllNotes')}</button>
              </div>
              <ul className="clients-overview-list">
                {noteSummary.pinned.map((note) => <li key={note.id}>
                  <span>{note.title || t('clients.untitledNote')}</span>
                  {clientId === null && <span className="clients-overview-task-project">{noteDisplayName(note, clients)}</span>}
                </li>)}
              </ul>
            </section>}
          </>}
    </div>
  );
}
