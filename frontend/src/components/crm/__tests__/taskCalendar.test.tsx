import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCalendar } from '../TaskCalendar';
import type { Task } from '@/lib/api/crm';

const MONTH = new Date(2026, 6, 1); // July 2026

function task(over: Partial<Task>): Task {
  return {
    id: 'id', title: 'Task', due_date: '2026-07-15', due_time: null,
    status: 'pending', priority: 'normal', assigned_to: 'u-1',
    description: null, customer_id: null, lead_id: null, job_id: null,
    assigned_to_name: null, completed_at: null, completed_by: null,
    ...over,
  };
}

describe('TaskCalendar', () => {
  it('renders the month title', () => {
    render(<TaskCalendar month={MONTH} tasks={[]} onDayClick={vi.fn()} onTaskClick={vi.fn()} onPrevMonth={vi.fn()} onNextMonth={vi.fn()} onToday={vi.fn()} />);
    expect(screen.getByText(/July 2026/i)).toBeInTheDocument();
  });

  it('renders a chip for a task on its due day', () => {
    render(<TaskCalendar month={MONTH} tasks={[task({ id: 't1', title: 'Call Ravi', due_date: '2026-07-15' })]} onDayClick={vi.fn()} onTaskClick={vi.fn()} onPrevMonth={vi.fn()} onNextMonth={vi.fn()} onToday={vi.fn()} />);
    expect(screen.getByText('Call Ravi')).toBeInTheDocument();
  });

  it('calls onTaskClick when a task chip is clicked', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();
    const t = task({ id: 't1', title: 'Call Ravi', due_date: '2026-07-15' });
    render(<TaskCalendar month={MONTH} tasks={[t]} onDayClick={vi.fn()} onTaskClick={onTaskClick} onPrevMonth={vi.fn()} onNextMonth={vi.fn()} onToday={vi.fn()} />);
    await user.click(screen.getByText('Call Ravi'));
    expect(onTaskClick).toHaveBeenCalledWith(t);
  });

  it('calls onDayClick with the ISO date when a day cell is clicked', async () => {
    const user = userEvent.setup();
    const onDayClick = vi.fn();
    render(<TaskCalendar month={MONTH} tasks={[]} onDayClick={onDayClick} onTaskClick={vi.fn()} onPrevMonth={vi.fn()} onNextMonth={vi.fn()} onToday={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'July 15, 2026' }));
    expect(onDayClick).toHaveBeenCalledWith('2026-07-15');
  });

  it('wires prev/next/today navigation', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onToday = vi.fn();
    render(<TaskCalendar month={MONTH} tasks={[]} onDayClick={vi.fn()} onTaskClick={vi.fn()} onPrevMonth={onPrev} onNextMonth={onNext} onToday={onToday} />);
    await user.click(screen.getByRole('button', { name: /previous month/i }));
    await user.click(screen.getByRole('button', { name: /next month/i }));
    await user.click(screen.getByRole('button', { name: /today/i }));
    expect(onPrev).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
    expect(onToday).toHaveBeenCalled();
  });
});
