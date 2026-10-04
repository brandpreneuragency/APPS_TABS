import { liveQuery } from 'dexie';
import { db } from '../db';
import { isTauriRuntime, isClientsAcceptanceRuntime } from '../runtime';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore, syncCodexTaskProjection } from '../../stores/taskStore';
import type { Task } from '../../types';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { DexieTaskCache, readMetadata } from './cache';
import { desktopTaskTransport } from './desktop';
import { TaskAuthorityEngine } from './engine';
import { META_KEY, TASK_TABLES, stable } from './model';

async function refreshTaskViews() {
  // Generated files are secondary projections. Keep a durable retry queue so a
  // failed disk write cannot lose the authoritative acknowledgement or collide
  // with the next existing Codex projection receipt. Never overwrite manual text.
  const jobs = (await readMetadata(db))?.projectionJobs ?? [];
  for (const job of jobs) {
    const before = job.before as unknown as Task | null;
    const after = job.after as unknown as Task | null;
    try {
      let previous = before ?? undefined;
      if (previous && after && previous.projectId !== after.projectId && !await db.projects.get(previous.projectId)) {
        // The old project no longer resolves. Preserve its old files; publish
        // only the new, valid location with the existing collision protection.
        previous = undefined;
      }
      if (after) await syncCodexTaskProjection(after, previous);
      else if (before) await syncCodexTaskProjection({ ...before, deletedAt: Date.now() }, before);
      await db.transaction('rw', db.settings, async () => {
        const meta = await readMetadata(db);
        if (meta) await db.settings.put({ key: META_KEY, value: { ...meta,
          projectionJobs: (meta.projectionJobs ?? []).filter(item => item.key !== job.key) } });
      });
    } catch {
      // Preserve ordering: a later generated version must not skip a failed
      // earlier one. The VPS panel reports this separately from task sync.
      break;
    }
  }
  const [clients, projects] = await Promise.all([db.clients.toArray(), db.projects.toArray()]);
  useClientStore.setState({ clients });
  useProjectStore.setState({ projects });
  await useTaskStore.getState().refreshTasksFromDb();
  await Promise.all(Object.keys(useTaskCommentStore.getState().commentsByTask)
    .map(id => useTaskCommentStore.getState().loadComments(id)));
}

function inputIsSaved() {
  const element = document.activeElement;
  return !(element instanceof HTMLElement
    && (element.isContentEditable || element.matches('input, textarea, select')));
}

export const taskAuthority = new TaskAuthorityEngine(new DexieTaskCache(db),
  desktopTaskTransport, refreshTaskViews, inputIsSaved);

export function startTaskAuthority(): () => void {
  if (!isTauriRuntime() || isClientsAcceptanceRuntime()) return () => {};
  void taskAuthority.start();
  let previous = '';
  const subscription = liveQuery(async () => stable(await Promise.all(
    TASK_TABLES.map(table => db.table(table).toArray()),
  ))).subscribe({
    next: current => { if (current !== previous) { previous = current; taskAuthority.localChanged(); } },
    error: () => { void taskAuthority.sync(); },
  });
  const resume = () => taskAuthority.localChanged();
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('focusout', resume);
  return () => {
    subscription.unsubscribe();
    window.removeEventListener('online', resume);
    window.removeEventListener('focus', resume);
    document.removeEventListener('focusout', resume);
    taskAuthority.stop();
  };
}
