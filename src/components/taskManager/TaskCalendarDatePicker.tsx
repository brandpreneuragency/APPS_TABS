import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './taskCalendarDatePicker.css';
import { parseIsoDateToLocal, toLocalIsoDate } from './taskMetadataUtils';

interface TaskCalendarDatePickerProps {
  value: Date;
  label: string;
  onChange: (date: Date) => void;
}

function sameDay(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

function shiftMonth(date: Date, offset: number) {
  const month = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return new Date(month.getFullYear(), month.getMonth(), Math.min(date.getDate(), lastDay), 12);
}

export function TaskCalendarDatePicker({ value, label, onChange }: TaskCalendarDatePickerProps) {
  const { t } = useTranslation();
  const popupId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const focusedDay = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<Date | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const open = cursor !== null;
  const today = new Date();
  const format = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString('tr', options);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!trigger.current || !popup.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = popup.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left + (anchor.width - bounds.width) / 2, window.innerWidth - bounds.width - 8));
      const top = anchor.bottom + bounds.height + 8 <= window.innerHeight
        ? anchor.bottom + 6
        : Math.max(8, anchor.top - bounds.height - 6);
      setPosition({ top, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) {
        setCursor(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (cursor) focusedDay.current?.focus();
  }, [cursor]);

  const close = () => {
    setCursor(null);
    trigger.current?.focus();
  };
  const select = (date: Date) => {
    onChange(date);
    close();
  };
  const first = cursor && new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  if (first) first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = first ? Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12)) : [];

  return <>
    <button
      ref={trigger}
      type="button"
      className="task-calendar-picker"
      aria-label={t('calendar.chooseDate')}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? popupId : undefined}
      title={t('calendar.chooseDate')}
      onClick={() => setCursor(open ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12))}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
      }}
    >
      <CalendarDays size={16} />
      <span aria-live="polite">{label}</span>
      <ChevronDown size={12} />
    </button>
    {cursor && createPortal(
      <div
        ref={popup}
        id={popupId}
        className="task-calendar-date-popup"
        role="dialog"
        aria-label={t('calendar.chooseDate')}
        style={position}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === 'Tab') {
            const buttons = popup.current?.querySelectorAll<HTMLButtonElement>('button:not([tabindex="-1"])');
            if (buttons && ((event.shiftKey && event.target === buttons[0]) || (!event.shiftKey && event.target === buttons[buttons.length - 1]))) {
              event.preventDefault();
              close();
            }
          }
        }}
      >
        <div className="task-calendar-date-header">
          <button type="button" title={t('calendar.previousMonth')} aria-label={t('calendar.previousMonth')} onClick={() => setCursor(shiftMonth(cursor, -1))}><ChevronLeft size={16} /></button>
          <strong aria-live="polite">{format(cursor, { month: 'long', year: 'numeric' })}</strong>
          <button type="button" title={t('calendar.nextMonth')} aria-label={t('calendar.nextMonth')} onClick={() => setCursor(shiftMonth(cursor, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="task-calendar-date-grid">
          {days.slice(0, 7).map((day) => <span className="task-calendar-date-weekday" key={day.getDay()} title={format(day, { weekday: 'long' })}>{format(day, { weekday: 'short' })}</span>)}
          {days.map((day) => <button
            key={day.getTime()}
            ref={sameDay(day, cursor) ? focusedDay : undefined}
            type="button"
            className={`task-calendar-date-day${day.getMonth() !== cursor.getMonth() ? ' task-calendar-date-day--outside' : ''}`}
            aria-label={format(day, { dateStyle: 'full' })}
            aria-pressed={sameDay(day, value)}
            aria-current={sameDay(day, today) ? 'date' : undefined}
            tabIndex={sameDay(day, cursor) ? 0 : -1}
            onClick={() => select(day)}
            onKeyDown={(event) => {
              const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(day.getDay() + 6) % 7, End: 6 - (day.getDay() + 6) % 7 }[event.key];
              if (offset !== undefined) {
                event.preventDefault();
                setCursor(new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, 12));
              } else if (event.key === 'PageUp' || event.key === 'PageDown') {
                event.preventDefault();
                setCursor(shiftMonth(day, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)));
              }
            }}
          >{day.getDate()}</button>)}
        </div>
      </div>, document.body,
    )}
  </>;
}

interface TaskDueDateCalendarProps {
  value: string;
  onSelect: (iso: string) => void;
  onClear?: () => void;
  allowClear?: boolean;
}

export function TaskDueDateCalendar({ value, onSelect, onClear, allowClear = true }: TaskDueDateCalendarProps) {
  const { t } = useTranslation();
  const focusedDay = useRef<HTMLButtonElement>(null);
  const selected = parseIsoDateToLocal(value);
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12));
  const today = new Date();
  const format = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString('tr', options);

  useEffect(() => {
    focusedDay.current?.focus();
  }, [cursor]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12));

  return <>
    <div className="task-calendar-date-header">
      <button type="button" title={t('calendar.previousMonth')} aria-label={t('calendar.previousMonth')} onClick={() => setCursor(shiftMonth(cursor, -1))}><ChevronLeft size={16} /></button>
      <strong aria-live="polite">{format(cursor, { month: 'long', year: 'numeric' })}</strong>
      <button type="button" title={t('calendar.nextMonth')} aria-label={t('calendar.nextMonth')} onClick={() => setCursor(shiftMonth(cursor, 1))}><ChevronRight size={16} /></button>
    </div>
    <div className="task-calendar-date-grid">
      {days.slice(0, 7).map((day) => <span className="task-calendar-date-weekday" key={day.getDay()} title={format(day, { weekday: 'long' })}>{format(day, { weekday: 'short' })}</span>)}
      {days.map((day) => <button
        key={day.getTime()}
        ref={sameDay(day, cursor) ? focusedDay : undefined}
        type="button"
        className={`task-calendar-date-day${day.getMonth() !== cursor.getMonth() ? ' task-calendar-date-day--outside' : ''}`}
        aria-label={format(day, { dateStyle: 'full' })}
        aria-pressed={selected ? sameDay(day, selected) : false}
        aria-current={sameDay(day, today) ? 'date' : undefined}
        tabIndex={sameDay(day, cursor) ? 0 : -1}
        onClick={() => onSelect(toLocalIsoDate(day))}
        onKeyDown={(event) => {
          const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(day.getDay() + 6) % 7, End: 6 - (day.getDay() + 6) % 7 }[event.key];
          if (offset !== undefined) {
            event.preventDefault();
            setCursor(new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, 12));
          } else if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            setCursor(shiftMonth(day, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)));
          }
        }}
      >{day.getDate()}</button>)}
    </div>
    {allowClear && (value || onClear) && (
      <div className="task-calendar-date-footer">
        <button
          type="button"
          className="task-calendar-date-clear"
          onClick={() => { if (onClear) onClear(); else onSelect(''); }}
          disabled={!value}
        >
          {t('tasks.noDate')}
        </button>
      </div>
    )}
  </>;
}

interface TaskDueDatePickerProps {
  value: string;
  onChange: (iso: string) => void;
  children: ReactNode;
  buttonClassName?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  allowClear?: boolean;
  buttonProps?: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children' | 'className' | 'aria-label' | 'title' | 'disabled' | 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'type' | 'ref'>;
}

export function TaskDueDatePicker({ value, onChange, children, buttonClassName, ariaLabel, title, disabled, allowClear = true, buttonProps }: TaskDueDatePickerProps) {
  const { t } = useTranslation();
  const popupId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!trigger.current || !popup.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = popup.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left + (anchor.width - bounds.width) / 2, window.innerWidth - bounds.width - 8));
      const top = anchor.bottom + bounds.height + 8 <= window.innerHeight
        ? anchor.bottom + 6
        : Math.max(8, anchor.top - bounds.height - 6);
      setPosition({ top, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open ]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const select = (iso: string) => {
    onChange(iso);
    close();
  };

  return <>
    <button
      ref={trigger}
      type="button"
      {...buttonProps}
      className={buttonClassName}
      aria-label={ariaLabel ?? t('calendar.chooseDate')}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? popupId : undefined}
      title={title ?? ariaLabel ?? t('calendar.chooseDate')}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
      }}
    >
      {children}
    </button>
    {open && createPortal(
      <div
        ref={popup}
        id={popupId}
        className="task-calendar-date-popup"
        role="dialog"
        aria-label={t('calendar.chooseDate')}
        style={position}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === 'Tab') {
            const buttons = popup.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled]):not([tabindex="-1"])');
            if (buttons && ((event.shiftKey && event.target === buttons[0]) || (!event.shiftKey && event.target === buttons[buttons.length - 1]))) {
              event.preventDefault();
              close();
            }
          }
        }}
      >
        <TaskDueDateCalendar value={value} onSelect={select} allowClear={allowClear} />
      </div>, document.body,
    )}
  </>;
}
