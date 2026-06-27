'use client';

import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, isSameMonth, isToday,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format/date';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/api/crm';

interface TaskCalendarProps {
  month: Date;
  tasks: Task[];
  onDayClick: (isoDate: string) => void;
  onTaskClick: (task: Task) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  loading?: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Chip colour: status wins (overdue/completed/cancelled), else priority. */
function chipClass(task: Task): string {
  if (task.status === 'completed') return 'bg-[var(--success)]/15 text-[var(--success)] line-through';
  if (task.status === 'cancelled') return 'bg-[var(--surface-2)] text-[var(--text-muted)] line-through';
  if (task.status === 'overdue') return 'bg-[var(--danger)]/15 text-[var(--danger)]';
  if (task.priority === 'high') return 'bg-[var(--danger)]/15 text-[var(--danger)]';
  if (task.priority === 'low') return 'bg-[var(--surface-2)] text-[var(--text-muted)]';
  return 'bg-[var(--info)]/15 text-[var(--info)]';
}

export function TaskCalendar({
  month, tasks, onDayClick, onTaskClick, onPrevMonth, onNextMonth, onToday, loading,
}: TaskCalendarProps) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Bucket tasks by their due_date string (compared as YYYY-MM-DD to avoid TZ drift).
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.due_date?.slice(0, 10);
    if (!key) continue;
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(t);
  }

  return (
    <div className={cn('rounded-lg border border-[var(--border)] bg-[var(--surface)]', loading && 'opacity-60')}>
      {/* Calendar header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)]">
        <h2 className="text-h2 text-[var(--text)]">{format(month, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onToday}>Today</Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Previous month" onClick={onPrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Next month" onClick={onNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-xs font-medium text-[var(--text-muted)] text-center">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, month);
          const dayTasks = byDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              className={cn(
                'min-h-[92px] border-b border-r border-[var(--border)] p-1 flex flex-col gap-0.5',
                !inMonth && 'bg-[var(--surface-2)]/40',
              )}
            >
              <button
                type="button"
                aria-label={format(day, 'MMMM d, yyyy')}
                onClick={() => onDayClick(iso)}
                className={cn(
                  'self-start rounded px-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]',
                  isToday(day) ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]' : 'text-[var(--text-muted)]',
                  !inMonth && 'opacity-50',
                )}
              >
                {format(day, 'd')}
              </button>

              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayTasks.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onTaskClick(t)}
                    title={t.title}
                    className={cn('truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight', chipClass(t))}
                  >
                    {t.due_time ? <span className="tabular-nums">{formatTime(t.due_time)} </span> : null}
                    {t.title}
                  </button>
                ))}
                {dayTasks.length > 4 && (
                  <span className="px-1 text-[10px] text-[var(--text-muted)]">+{dayTasks.length - 4} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
