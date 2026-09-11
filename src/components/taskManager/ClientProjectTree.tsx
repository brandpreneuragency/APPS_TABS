import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClientStore } from '../../stores/clientStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import type { Client, Project } from '../../types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { AddNewClientButton } from './AddNewClientButton';
import { AddNewProjectButton } from './AddNewProjectButton';
import './taskList.css';

const PROJECT_DOT_COLORS: Record<string, string> = {
  'text-blue-500': '#3b82f6',
  'text-emerald-500': '#10b981',
  'text-amber-500': '#f59e0b',
  'text-rose-500': '#f43f5e',
  'text-violet-500': '#8b5cf6',
  'text-cyan-500': '#06b6d4',
  'text-orange-500': '#f97316',
  'text-pink-500': '#ec4899',
};

function projectDotColor(color?: string): string {
  return (color && PROJECT_DOT_COLORS[color]) || 'var(--c-text-3)';
}

function sortByOrderThenName<T extends { order: number; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

type VisibleRow =
  | { kind: 'client'; id: string }
  | { kind: 'project'; id: string; clientId: string };

type PendingDelete =
  | { kind: 'client'; id: string; name: string }
  | { kind: 'project'; id: string; name: string };

function rowDomId(row: VisibleRow): string {
  return row.kind === 'client' ? `client-tree-client-${row.id}` : `client-tree-project-${row.id}`;
}

export function ClientProjectTree() {
  const { t } = useTranslation();
  const clients = useClientStore((s) => s.clients);
  const deleteClient = useClientStore((s) => s.deleteClient);
  const projects = useProjectStore((s) => s.projects);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const selectedClientId = useTaskStore((s) => s.selectedClientId);
  const selectedProjectId = useTaskStore((s) => s.selectedProjectId);
  const setSelection = useTaskStore((s) => s.setSelection);

  const sortedClients = useMemo(() => sortByOrderThenName(clients), [clients]);

  const [expandedClientIds, setExpandedClientIds] = useState<Set<string>>(
    () => new Set(selectedClientId ? [selectedClientId] : []),
  );
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [seenSelectedClientId, setSeenSelectedClientId] = useState(selectedClientId);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  if (selectedClientId !== seenSelectedClientId) {
    setSeenSelectedClientId(selectedClientId);
    if (selectedClientId && !expandedClientIds.has(selectedClientId)) {
      const next = new Set(expandedClientIds);
      next.add(selectedClientId);
      setExpandedClientIds(next);
    }
  }

  const expandClient = (id: string) => {
    setExpandedClientIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const collapseClient = (id: string) => {
    setExpandedClientIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleClient = (id: string) => {
    setExpandedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const projectsByClient = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const client of sortedClients) {
      map.set(
        client.id,
        sortByOrderThenName(projects.filter((p) => p.clientId === client.id)),
      );
    }
    return map;
  }, [sortedClients, projects]);

  const visibleRows = useMemo(() => {
    const rows: VisibleRow[] = [];
    for (const client of sortedClients) {
      rows.push({ kind: 'client', id: client.id });
      if (!expandedClientIds.has(client.id)) continue;
      for (const project of projectsByClient.get(client.id) ?? []) {
        rows.push({ kind: 'project', id: project.id, clientId: client.id });
      }
    }
    return rows;
  }, [sortedClients, expandedClientIds, projectsByClient]);

  const maxFocusIndex = Math.max(0, visibleRows.length - 1);
  const activeFocus = Math.min(focusedIndex, maxFocusIndex);

  const focusRow = (row: VisibleRow) => {
    const index = visibleRows.findIndex((r) => r.kind === row.kind && r.id === row.id);
    if (index >= 0) setFocusedIndex(index);
  };

  const selectRow = (row: VisibleRow) => {
    focusRow(row);
    if (row.kind === 'client') {
      setSelection(row.id, null);
      expandClient(row.id);
      return;
    }
    setSelection(row.clientId, row.id);
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (visibleRows.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex(Math.min(maxFocusIndex, activeFocus + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex(Math.max(0, activeFocus - 1));
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const row = visibleRows[activeFocus];
      if (row?.kind === 'client') expandClient(row.id);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const row = visibleRows[activeFocus];
      if (!row) return;
      if (row.kind === 'client') {
        collapseClient(row.id);
        return;
      }
      collapseClient(row.clientId);
      const clientIndex = visibleRows.findIndex((r) => r.kind === 'client' && r.id === row.clientId);
      if (clientIndex >= 0) setFocusedIndex(clientIndex);
      return;
    }
    if (event.key === 'Enter') {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      const row = visibleRows[activeFocus];
      if (row) selectRow(row);
    }
  };

  const focusedRow = visibleRows[activeFocus];
  const focusedId = focusedRow ? rowDomId(focusedRow) : undefined;

  const requestDelete = (event: MouseEvent, pending: PendingDelete) => {
    event.stopPropagation();
    setPendingDelete(pending);
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) return;
    const pending = pendingDelete;
    setPendingDelete(null);
    if (pending.kind === 'client') void deleteClient(pending.id);
    else void deleteProject(pending.id);
  };

  const renderClientRow = (client: Client) => {
    const expanded = expandedClientIds.has(client.id);
    const selected = selectedClientId === client.id && !selectedProjectId;
    const row: VisibleRow = { kind: 'client', id: client.id };
    const focused = focusedRow ? rowDomId(focusedRow) === rowDomId(row) : false;
    const childProjects = projectsByClient.get(client.id) ?? [];

    return (
      <div key={client.id} role="group" aria-label={client.name}>
        <div
          id={rowDomId(row)}
          className={`client-tree-row${selected ? ' client-tree-row--on' : ''}${focused ? ' client-tree-row--focus' : ''}`}
          role="treeitem"
          aria-expanded={expanded}
          aria-selected={selected}
          onClick={() => selectRow(row)}
        >
          <button
            type="button"
            className="client-tree-chevron"
            aria-label={expanded ? `Collapse ${client.name}` : `Expand ${client.name}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleClient(client.id);
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <span className="client-tree-dot" style={{ background: projectDotColor(client.color) }} />
          <button
            type="button"
            className="client-tree-name"
            onClick={() => selectRow(row)}
          >
            {client.name}
          </button>
          <button
            type="button"
            className="client-tree-delete-btn"
            aria-label={`${t('explorer.delete')} ${client.name}`}
            onClick={(event) => requestDelete(event, { kind: 'client', id: client.id, name: client.name })}
          >
            <Trash2 size={12} />
          </button>
          <AddNewProjectButton clientId={client.id} label={t('tasks.addProjectToClient')} />
        </div>
        {expanded && childProjects.map((project) => renderProjectRow(project, client.name))}
      </div>
    );
  };

  const renderProjectRow = (project: Project, clientName: string) => {
    const selected = selectedProjectId === project.id;
    const row: VisibleRow = { kind: 'project', id: project.id, clientId: project.clientId };
    const focused = focusedRow ? rowDomId(focusedRow) === rowDomId(row) : false;
    return (
      <div
        key={project.id}
        id={rowDomId(row)}
        className={`client-tree-row client-tree-row--project${selected ? ' client-tree-row--on' : ''}${focused ? ' client-tree-row--focus' : ''}`}
        role="treeitem"
        aria-selected={selected}
        onClick={() => selectRow(row)}
      >
        <span className="client-tree-chevron-spacer" aria-hidden="true" />
        <span className="client-tree-dot" style={{ background: projectDotColor(project.color) }} />
        <button
          type="button"
          className="client-tree-name"
          onClick={() => selectRow(row)}
        >
          {project.name}
        </button>
        <button
          type="button"
          className="client-tree-delete-btn"
          aria-label={`${t('explorer.delete')} ${clientName} ${project.name}`}
          onClick={(event) => requestDelete(event, { kind: 'project', id: project.id, name: project.name })}
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="client-tree">
      <div className="client-tree-header">
        <span className="client-tree-header-label">{t('tasks.clients')}</span>
        <AddNewClientButton />
      </div>
      <div
        className="client-tree-list"
        role="tree"
        tabIndex={0}
        aria-label={t('tasks.clients')}
        aria-activedescendant={focusedId}
        onKeyDown={handleTreeKeyDown}
      >
        {sortedClients.map(renderClientRow)}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          message={t(
            pendingDelete.kind === 'client' ? 'tasks.deleteClientConfirm' : 'tasks.deleteProjectConfirm',
            { name: pendingDelete.name },
          )}
          confirmLabel={t('explorer.delete')}
          onConfirm={confirmPendingDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
