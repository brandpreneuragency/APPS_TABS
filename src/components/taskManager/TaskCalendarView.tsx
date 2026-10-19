import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../types';
import { useKanbanDropIndicator } from '../../hooks/useKanbanDropIndicator';
import { sortKanbanCards } from '../../services/kanbanOrder';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import { filterTasksForSelection } from '../../stores/taskSelection';
import { TaskKanbanCard } from './TaskProjectsKanban';
import { TaskCalendarDatePicker } from './TaskCalendarDatePicker';
import { TaskQuickCreate } from './TaskQuickCreate';
import { formatTurkishClock } from './formatTurkishClock';
import { AssistantToggle } from '../layout/workspace/AssistantToggle';
import './taskCalendar.css';

interface TaskCalendarViewProps {
  tasks: Task[];
  onPrefillText: (text: string) => void;
  assignedDate?: string | null;
  onSetDate?: (date: string | null) => void;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function TaskCalendarView({ tasks }: TaskCalendarViewProps) {
  const { t } = useTranslation();
  const activeTaskId = useTaskStore((state) => state.activeTaskId);
  const selectedClientId = useTaskStore((state) => state.selectedClientId);
  const selectedProjectId = useTaskStore((state) => state.selectedProjectId);
  const updateTask = useTaskStore((state) => state.updateTask);
  const openTask = useTaskStore((state) => state.openTaskInActiveTab);
  const setActiveTaskPage = useUIStore((state) => state.setActiveTaskPage);
  const projects = useProjectStore((state) => state.projects);
  const [anchor, setAnchor] = useState(() => new Date());
  const [today, setToday] = useState(() => new Date());
  const [view, setView] = useState<'week' | 'month'>('week');
  const drop = useKanbanDropIndicator('application/x-task-card');
  const [error, setError] = useState(false);
  const [quickCreateDay, setQuickCreateDay] = useState<string | null>(null);
  const calendarBoard = useRef<HTMLDivElement>(null);
  const scrollToToday = useRef(false);

  useEffect(() => {
    if (scrollToToday.current) {
      calendarBoard.current?.querySelector('.task-calendar-day--today')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      scrollToToday.current = false;
    }
  }, [anchor]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleTasks = filterTasksForSelection(tasks, projects, selectedClientId, selectedProjectId);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), view === 'month' ? 1 : anchor.getDate());
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthLength = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const count = view === 'week' ? 7 : Math.ceil(((monthStart.getDay() + 6) % 7 + monthLength) / 7) * 7;
  const days = Array.from({ length: count }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  const format = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString('tr', options);
  const clockLabel = formatTurkishClock(today);
  const label = view === 'month' ? format(anchor, { month: 'long', year: 'numeric' }) : `${format(days[0], { day: 'numeric', month: 'short', year: 'numeric' })} - ${format(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const move = (direction: number) => setAnchor(view === 'week'
    ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + direction * 7)
    : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));

  return (
    <section className="task-calendar" aria-label={t('navigation.calendar')}>
      <div className="task-calendar-toolbar">
        <button className="ui-button task-calendar-today" type="button" title={t('navigation.today')} aria-label={t('navigation.today')} onClick={() => {
          const now = new Date();
          scrollToToday.current = true;
          setToday(now);
          setAnchor(now);
        }}>
          <time dateTime={today.toISOString()}>{clockLabel}</time>
        </button>
        <div className="task-calendar-navigation">
          <button className="ui-icon-button" type="button" title={t(`calendar.previous${view === 'week' ? 'Week' : 'Month'}`)} aria-label={t(`calendar.previous${view === 'week' ? 'Week' : 'Month'}`)} onClick={() => move(-1)}><ChevronLeft /></button>
          <TaskCalendarDatePicker value={anchor} label={label} onChange={setAnchor} />
          <button className="ui-icon-button" type="button" title={t(`calendar.next${view === 'week' ? 'Week' : 'Month'}`)} aria-label={t(`calendar.next${view === 'week' ? 'Week' : 'Month'}`)} onClick={() => move(1)}><ChevronRight /></button>
        </div>
        <div className="task-calendar-actions">
          <div className="task-calendar-switch" role="group" aria-label={t('calendar.view')}>
            {(['week', 'month'] as const).map((mode) => <button className="ui-button" key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{t(`calendar.${mode}`)}</button>)}
          </div>
          <AssistantToggle id="task-calendar-btn-assistant" variant="header" />
        </div>
      </div>
      {error && <div role="alert">{t('calendar.moveFailed')}</div>}
      <div ref={calendarBoard} className={`task-calendar-board task-calendar-board--${view}`}>
        {days.map((day) => {
          const key = dateKey(day);
          const dayTasks = sortKanbanCards(visibleTasks.filter((task) => task.date === key));
          return (
            <section key={key} aria-label={key} className={`crm-kanban-column task-calendar-day${key === dateKey(today) ? ' task-calendar-day--today' : ''}${day.getMonth() !== anchor.getMonth() && view === 'month' ? ' task-calendar-day--outside' : ''}${drop.targetColumn === key ? ' crm-kanban-column--drop-target' : ''}`}
              {...drop.handlers(key, (id, beforeId) => {
                if (!visibleTasks.some((task) => task.id === id)) return;
                setError(false);
                void updateTask(id, { date: key }, { field: 'date', beforeId }).catch(() => setError(true));
              })}>
              <div className="crm-kanban-column-header">
                <span className="task-calendar-day-label"><span>{format(day, { weekday: 'short' })}</span><strong>{day.getDate()}</strong></span>
                <button
                  type="button"
                  className="ui-icon-button"
                  aria-label={`${t('calendar.addTask')} ${key}`}
                  title={t('calendar.addTask')}
                  onClick={() => setQuickCreateDay(quickCreateDay === key ? null : key)}
                >
                  <Plus />
                </button>
              </div>
              {quickCreateDay === key && (
                <div className="task-quick-create-wrapper">
                  <TaskQuickCreate
                    date={key}
                    onClose={() => setQuickCreateDay(null)}
                    onSuccess={() => setQuickCreateDay(null)}
                  />
                </div>
              )}
              <div className="crm-kanban-column-body">
                {drop.indicator(key)}
                {!dayTasks.length && <div className="crm-kanban-column-empty">{t('navigation.noTasks')}</div>}
                {dayTasks.map((task) => <TaskKanbanCard key={task.id} task={task} isActive={task.id === activeTaskId} dragLabel={t('calendar.reschedule')} showActions onClick={(id) => { openTask(id); setActiveTaskPage('list'); }} />)}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
