import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Trash2, Folder, Calendar, X } from 'lucide-react';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { projectsForClient } from '../../stores/taskSelection';
import { findProjectByNameInClient } from '../../stores/taskTreeNames';

interface TaskContextMenuProps {
  taskId: string;
  x: number;
  y: number;
  onClose: () => void;
}

type Panel = 'main' | 'project' | 'date';

export function TaskContextMenu({ taskId, x, y, onClose }: TaskContextMenuProps) {
  const { tasks, updateTask, deleteTask } = useTaskStore();
  const { projects, createProject } = useProjectStore();
  const task = tasks.find((t) => t.id === taskId);

  const [panel, setPanel] = useState<Panel>('main');
  const [newProjectName, setNewProjectName] = useState('');
  const [customDate, setCustomDate] = useState(task?.date ?? '');

  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });

  // Close on outside click / escape (deferred capture listener avoids the opening click)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKey);
    }, 0);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Keep menu in viewport
  const adjustPos = useCallback(() => {
    const el = rootRef.current;
    if (!el) return { left: x, top: y };
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    return { left, top };
  }, [x, y]);

  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    setPos(adjustPos()); // eslint-disable-line react-hooks/set-state-in-effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  if (!task) return null;

  const clientId = projects.find((p) => p.id === task.projectId)?.clientId ?? '';
  const clientProjects = projectsForClient(projects, clientId || null);

  const dateOptions: { label: string; value: string }[] = [
    { label: 'No date', value: '' },
    { label: 'Today', value: new Date().toISOString().slice(0, 10) },
  ];
  {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    dateOptions.push({ label: 'Tomorrow', value: d.toISOString().slice(0, 10) });
    d.setDate(d.getDate() + 6);
    dateOptions.push({ label: 'Next week', value: d.toISOString().slice(0, 10) });
  }

  const removeTask = () => {
    deleteTask(task.id);
    onClose();
  };

  const assignProject = (projectId: string) => {
    updateTask(task.id, { projectId });
    setPanel('main');
  };

  const addNewProject = async () => {
    const name = newProjectName.trim();
    if (!name || !clientId) return;
    const existing = findProjectByNameInClient(name, clientId, projects);
    if (existing) {
      assignProject(existing.id);
      return;
    }
    const created = await createProject(name, clientId);
    if (created) assignProject(created.id);
    setNewProjectName('');
  };

  const assignDate = (dateStr: string) => {
    updateTask(task.id, { date: dateStr || new Date().toISOString().slice(0, 10) });
    setPanel('main');
  };

  const applyCustomDate = () => {
    if (customDate) assignDate(customDate);
  };

  const removeDate = () => {
    updateTask(task.id, { date: new Date().toISOString().slice(0, 10) });
    setPanel('main');
  };

  const itemStyle = { fontSize: 'var(--fs-base)' } as const;

  return (
    <div
      ref={rootRef}
      className="drop"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 1001, minWidth: 180 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {panel === 'main' && (
        <>
          <button type="button" className="drop-item" onClick={removeTask} style={itemStyle}>
            <Trash2 size={12} /> Remove Task
          </button>
          <button type="button" className="drop-item" onClick={() => setPanel('project')} style={itemStyle}>
            <Folder size={12} /> Assign Project
          </button>
          <button type="button" className="drop-item" onClick={() => { setCustomDate(task.date); setPanel('date'); }} style={itemStyle}>
            <Calendar size={12} /> Edit Due Date
          </button>
        </>
      )}

      {panel === 'project' && (
        <>
          {clientProjects.map((p) => (
            <button
              key={p.id}
              type="button"
              className="drop-item"
              onClick={() => assignProject(p.id)}
              style={{ ...itemStyle, fontWeight: task.projectId === p.id ? 700 : 400 }}
            >
              <Folder size={12} /> {p.name}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--c-border-1)', margin: '4px 0' }} />
          <div style={{ padding: '4px 12px' }}>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addNewProject(); }
                if (e.key === 'Escape') setPanel('main');
              }}
              placeholder="New project name..."
              style={{
                width: '100%', fontSize: 'var(--fs-base)', padding: '6px 8px',
                border: '1px solid var(--c-border-1)', borderRadius: 'var(--radius-sm)',
                background: 'var(--c-background-1)', color: 'var(--c-text-1)',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '4px 12px 6px' }}>
            <button type="button" className="drop-item" onClick={addNewProject} disabled={!newProjectName.trim()} style={{ ...itemStyle, flex: 1, justifyContent: 'center', opacity: newProjectName.trim() ? 1 : 0.4 }}>
              Create &amp; Assign
            </button>
            <button type="button" className="drop-item" onClick={() => setPanel('main')} style={{ ...itemStyle, flex: 1, justifyContent: 'center' }}>
              Back
            </button>
          </div>
        </>
      )}

      {panel === 'date' && (
        <>
          {dateOptions.map((opt) => (
            <button
              key={opt.value || '__none__'}
              type="button"
              className="drop-item"
              onClick={() => assignDate(opt.value)}
              style={{ ...itemStyle, fontWeight: task.date === opt.value ? 700 : 400 }}
            >
              {opt.value ? <Calendar size={12} /> : <X size={12} />} {opt.label}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--c-border-1)', margin: '4px 0' }} />
          <div style={{ padding: '4px 12px' }}>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              title="Custom due date"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyCustomDate(); }
                if (e.key === 'Escape') setPanel('main');
              }}
              style={{
                width: '100%', fontSize: 'var(--fs-base)', padding: '6px 8px',
                border: '1px solid var(--c-border-1)', borderRadius: 'var(--radius-sm)',
                background: 'var(--c-background-1)', color: 'var(--c-text-1)',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '4px 12px 6px' }}>
            <button type="button" className="drop-item" onClick={applyCustomDate} disabled={!customDate} style={{ ...itemStyle, flex: 1, justifyContent: 'center', opacity: customDate ? 1 : 0.4 }}>
              Apply
            </button>
            <button type="button" className="drop-item" onClick={removeDate} style={{ ...itemStyle, flex: 1, justifyContent: 'center' }}>
              Reset
            </button>
            <button type="button" className="drop-item" onClick={() => setPanel('main')} style={{ ...itemStyle, flex: 1, justifyContent: 'center' }}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
