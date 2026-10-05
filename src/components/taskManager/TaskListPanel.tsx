import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './taskList.css';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';
import { filterTasksForSelection } from '../../stores/taskSelection';
import { TaskListItem } from './TaskListItem';
import { QuickCreateInput } from './QuickCreateInput';
import { TaskCalendarView } from './TaskCalendarView';
import { formatTurkishClock } from './formatTurkishClock';

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

export function TaskListPanel() {
  const { t } = useTranslation();
  const tasks = useTaskStore((state) => state.tasks);
  const activeTaskId = useTaskStore((state) => state.activeTaskId);
  const selectedClientId = useTaskStore((state) => state.selectedClientId);
  const selectedProjectId = useTaskStore((state) => state.selectedProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeTab = useUIStore((state) => state.activeTaskPage);
  const [now, setNow] = useState(() => new Date());
  const [assignedDate, setAssignedDate] = useState<string | null>(null);
  const [prefillText, setPrefillText] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const clockLabel = formatTurkishClock(now);
  const filteredTasks = useMemo(
    () => filterTasksForSelection(tasks, projects, selectedClientId, selectedProjectId),
    [tasks, projects, selectedClientId, selectedProjectId],
  );
  const groupedTasks = useMemo(() => {
    const groups: Record<DateCategory, typeof filteredTasks> = { today: [], thisWeek: [], notYet: [], completed: [] };
    for (const task of filteredTasks) groups[task.status === 'completed' ? 'completed' : getDateCategory(task.date)].push(task);
    for (const category of ['today', 'thisWeek', 'notYet'] as const) groups[category].sort((left, right) => left.date.localeCompare(right.date));
    groups.completed.sort((left, right) => right.updatedAt - left.updatedAt);
    return groups;
  }, [filteredTasks]);

  return (
    <div id="task-list-panel" className="panel flex-col h-full overflow-hidden">
      <div id="task-list-main-wrapper" className="panel-body">
        {activeTab === 'list' && (
          <div className="task-list-sticky-header">
            <div className="task-list-clock-header">
              <time dateTime={now.toISOString()}>{clockLabel}</time>
            </div>
          </div>
        )}
        <div id="task-list-content" className="task-scope-content ai-scroll">
          <div hidden={activeTab !== 'list'}>
            {filteredTasks.length === 0 && <p className="task-scope-empty">{t('navigation.noTasks')}</p>}
            {(['today', 'thisWeek', 'notYet', 'completed'] as const).flatMap((category) => groupedTasks[category]).map((task) => (
              <TaskListItem key={task.id} task={task} isActive={task.id === activeTaskId}
                onClick={() => useTaskStore.getState().openTaskInActiveTab(task.id)} />
            ))}
          </div>
          <div hidden={activeTab !== 'calendar'}>
            <TaskCalendarView tasks={tasks} onPrefillText={setPrefillText} assignedDate={assignedDate} onSetDate={setAssignedDate} />
          </div>
        </div>
        <div id="task-quick-create-footer" className="panel-footer" hidden={activeTab === 'calendar'}>
          <QuickCreateInput prefillText={prefillText} onClearPrefillText={() => setPrefillText(null)}
            assignedDate={assignedDate} onSetDate={setAssignedDate} />
        </div>
      </div>
    </div>
  );
}
