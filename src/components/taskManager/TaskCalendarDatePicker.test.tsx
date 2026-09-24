import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TaskCalendarDatePicker } from './TaskCalendarDatePicker';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

const setup = (value = new Date(2026, 8, 20, 12)) => {
  const onChange = vi.fn();
  render(<TaskCalendarDatePicker value={value} label="September 2026" onChange={onChange} />);
  const trigger = screen.getByRole('button', { name: 'calendar.chooseDate' });
  fireEvent.click(trigger);
  return { onChange, trigger, popup: screen.getByRole('dialog', { name: 'calendar.chooseDate' }) };
};

describe('TaskCalendarDatePicker', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 20, 12)); });
  afterEach(() => vi.useRealTimers());

  it('opens a themed Monday-first calendar and selects an exact local date', () => {
    const { trigger, popup, onChange } = setup();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(popup).toHaveClass('task-calendar-date-popup');
    expect(popup.querySelector('.task-calendar-date-weekday')).toHaveTextContent('Mon');
    const selected = within(popup).getByRole('button', { name: 'Sunday, September 20, 2026' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveAttribute('aria-current', 'date');
    expect(selected).toHaveFocus();
    fireEvent.click(within(popup).getByRole('button', { name: 'Thursday, October 1, 2026' }));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 1, 12));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('browses months without changing the selection and clamps month ends to leap day', () => {
    const { onChange, popup } = setup(new Date(2028, 0, 31, 12));
    fireEvent.click(within(popup).getByRole('button', { name: 'calendar.nextMonth' }));
    expect(within(popup).getByText('February 2028')).toBeInTheDocument();
    expect(within(popup).getByRole('button', { name: 'Tuesday, February 29, 2028' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves keyboard focus across year boundaries and supports week and year jumps', () => {
    setup(new Date(2026, 11, 31, 12));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Friday, January 1, 2027' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('button', { name: 'Monday, December 28, 2026' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Sunday, January 3, 2027' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Monday, January 3, 2028' })).toHaveFocus();
  });

  it('dismisses on Escape and outside clicks without selecting a date', () => {
    const { trigger, onChange } = setup();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([false, true])('restores trigger focus without selecting when tabbing out (shift=%s)', (shiftKey) => {
    const { popup, trigger, onChange } = setup(new Date(2025, 0, 1, 12));
    const boundary = within(popup).getByRole('button', {
      name: shiftKey ? 'calendar.previousMonth' : 'Wednesday, January 1, 2025',
    });
    fireEvent.keyDown(boundary, { key: 'Tab', shiftKey });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Wednesday, January 1, 2025' })).toHaveFocus();
  });
});
