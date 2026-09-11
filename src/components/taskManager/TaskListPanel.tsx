import React, { useState, useMemo, useEffect } from 'react';
import './taskList.css';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';
import { filterTasksForSelection } from '../../stores/taskSelection';
import { ClientProjectTree } from './ClientProjectTree';
import { TaskListItem } from './TaskListItem';
import { QuickCreateInput } from './QuickCreateInput';
import { TaskCalendarView } from './TaskCalendarView';
import { TaskProjectView } from './TaskProjectView';

type DateCategory = 'today' | 'thisWeek' | 'notYet' | 'completed';

function getDateCategory(dateStr: string): DateCategory {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const taskDate = new Date(dateStr);
  taskDate.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays > 0 && diffDays <= 6) return 'thisWeek';
  return 'notYet';
}

function getCategoryLabel(category: DateCategory): string {
  switch (category) {
    case 'today':
      return 'TODAY';
    case 'thisWeek':
      return 'THIS WEEK';
    case 'notYet':
      return 'NOT YET';
    case 'completed':
      return 'COMPLETED TASKS';
  }
}

export function TaskListPanel() {
  const { tasks, activeTaskId, selectedClientId, selectedProjectId } = useTaskStore();
  const projects = useProjectStore((s) => s.projects);
  const activeTab = useUIStore((s) => s.activeTaskPage);
  const [prefillText, setPrefillText] = useState<string | null>(null);
  const [assignedDate, setAssignedDate] = useState<string | null>(null);
  const [assignedProject, setAssignedProject] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clockLabel = now
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase()
    + ' · '
    + now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const filteredTasks = useMemo(
    () => filterTasksForSelection(tasks, projects, selectedClientId, selectedProjectId),
    [tasks, projects, selectedClientId, selectedProjectId],
  );

  const groupedTasks = useMemo(() => {
    const groups: Record<DateCategory, typeof filteredTasks> = {
      today: [],
      thisWeek: [],
      notYet: [],
      completed: [],
    };

    for (const task of filteredTasks) {
      if (task.status === 'completed') {
        groups.completed.push(task);
        continue;
      }
      const category = getDateCategory(task.date);
      groups[category].push(task);
    }

    // Sort tasks within each category by date
    for (const category of ['today', 'thisWeek', 'notYet'] as DateCategory[]) {
      groups[category].sort((a, b) => a.date.localeCompare(b.date));
    }
    // Sort completed tasks by most recently updated first
    groups.completed.sort((a, b) => b.updatedAt - a.updatedAt);

    return groups;
  }, [filteredTasks]);

  const categoriesWithTasks = useMemo(() => {
    return (['today', 'thisWeek', 'notYet', 'completed'] as DateCategory[]).filter(
      (cat) => groupedTasks[cat].length > 0
    );
  }, [groupedTasks]);

  return (
    <div id="task-list-panel" className="panel flex-col h-full overflow-hidden" style={{ marginLeft: '0px', marginRight: '0px' }}>
      <div id="task-list-main-wrapper" className="panel-body" style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: '0px', backgroundColor: 'var(--c-background-2)', border: 'none' }}>
        <div className="client-tree-panel">
          <ClientProjectTree />
        </div>
        {activeTab === 'list' && (
          <>
            <div className="task-list-sticky-header">
              <div className="task-list-clock-header">
                {clockLabel}
              </div>
            </div>
            <div
              id="task-list-content"
              className="ai-scroll flex-1 overflow-y-a"
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 0',
                minHeight: 0,
                gap: '6px',
                paddingLeft: '18px',
                paddingRight: '12px',
                paddingTop: '0px',
                paddingBottom: '0px',
                verticalAlign: 'middle',
              }}
            >
              {filteredTasks.length === 0 && (
                <div className="flex-col items-center justify-center py-12 text-center" style={{ padding: '6px 16px', verticalAlign: 'middle' }}>
                  <p className="txt-xs subtle">No tasks yet</p>
                  <p className="label mt-1">Type below to create your first task</p>
                </div>
              )}
              {categoriesWithTasks.map((category) => (
                <React.Fragment key={category}>
                  <div className="task-list-category-header">
                    {getCategoryLabel(category)}
                  </div>
                  {groupedTasks[category].map((task) => (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      isActive={task.id === activeTaskId}
                      onClick={() => useTaskStore.getState().openTaskInActiveTab(task.id)}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </>
        )}

        {activeTab === 'calendar' && (
          <div
            id="task-list-content"
            className="ai-scroll flex-1 overflow-y-a"
            style={{ flex: '1 1 0', minHeight: 0 }}
          >
            <TaskCalendarView
              tasks={tasks}
              onPrefillText={setPrefillText}
              assignedDate={assignedDate}
              onSetDate={setAssignedDate}
            />
          </div>
        )}

        {activeTab === 'projects' && (
          <div
            id="task-list-content"
            className="ai-scroll flex-1 overflow-y-a"
            style={{ flex: '1 1 0', minHeight: 0 }}
          >
            <TaskProjectView
              tasks={tasks}
              onPrefillText={setPrefillText}
              assignedProject={assignedProject}
              onSetProject={setAssignedProject}
            />
          </div>
        )}

        <div id="task-quick-create-footer" className="panel-footer">
          <QuickCreateInput
            prefillText={prefillText}
            onClearPrefillText={() => setPrefillText(null)}
            assignedDate={assignedDate}
            onSetDate={setAssignedDate}
            assignedProject={assignedProject}
            onSetProject={setAssignedProject}
          />
        </div>
      </div>
    </div>
  );
}
