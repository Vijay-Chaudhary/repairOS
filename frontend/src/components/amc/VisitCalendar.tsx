'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { amcApi, type AmcContract } from '@/lib/api/amc';
import { qk } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildCalendarDays(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startPad = (firstOfMonth.getDay() + 6) % 7; // Mon=0 … Sun=6
  const days: Date[] = [];

  for (let i = startPad; i > 0; i--) {
    days.push(new Date(year, month, 1 - i));
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  while (days.length % 7 !== 0) {
    days.push(new Date(year, month + 1, days.length - lastOfMonth.getDate() - startPad + 1));
  }
  return days;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface VisitPill {
  contractId: string;
  title: string;
  status: AmcContract['status'];
}

interface Props {
  shopId?: string;
}

export function VisitCalendar({ shopId }: Props) {
  const router = useRouter();
  const today = new Date();
  const [displayDate, setDisplayDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = displayDate.getFullYear();
  const month = displayDate.getMonth();

  const filters = shopId ? { shop_id: shopId } : {};

  const { data, isLoading } = useQuery({
    queryKey: qk.amcContracts(filters),
    queryFn: () => amcApi.listContracts(filters),
    staleTime: 60_000,
  });

  const contracts = data?.items ?? [];

  const visitsByDay = useMemo<Map<string, VisitPill[]>>(() => {
    const map = new Map<string, VisitPill[]>();
    for (const c of contracts) {
      if (!c.next_visit_date) continue;
      const ymd = c.next_visit_date.slice(0, 10);
      if (!map.has(ymd)) map.set(ymd, []);
      map.get(ymd)!.push({ contractId: c.id, title: c.title, status: c.status });
    }
    return map;
  }, [contracts]);

  const days = useMemo(() => buildCalendarDays(year, month), [year, month]);
  const todayYMD = toYMD(today);

  const monthLabel = displayDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <Button variant="ghost" size="sm" onClick={() => setDisplayDate(new Date(year, month - 1, 1))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-body font-semibold text-[var(--text)]">{monthLabel}</span>
        <Button variant="ghost" size="sm" onClick={() => setDisplayDate(new Date(year, month + 1, 1))} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-[var(--text-muted)]">
            {d}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="p-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-7 border-l border-[var(--border)]">
            {days.map((day, idx) => {
              const ymd = toYMD(day);
              const isCurrentMonth = day.getMonth() === month;
              const isToday = ymd === todayYMD;
              const pills = visitsByDay.get(ymd) ?? [];

              return (
                <div
                  key={idx}
                  className={cn(
                    'min-h-[80px] p-1.5 border-r border-b border-[var(--border)] flex flex-col gap-1',
                    !isCurrentMonth && 'bg-[var(--surface-2)]/40',
                  )}
                >
                  <span className={cn(
                    'text-xs font-medium self-start w-6 h-6 flex items-center justify-center rounded-full',
                    isToday
                      ? 'bg-[var(--accent)] text-white'
                      : isCurrentMonth
                        ? 'text-[var(--text)]'
                        : 'text-[var(--text-muted)]',
                  )}>
                    {day.getDate()}
                  </span>
                  {pills.map((pill) => (
                    <button
                      key={pill.contractId}
                      onClick={() => router.push(`/amc/${pill.contractId}`)}
                      className={cn(
                        'w-full text-left text-[10px] font-medium rounded px-1.5 py-0.5 truncate leading-tight',
                        pill.status === 'active'
                          ? 'bg-[var(--info)]/15 text-[var(--info)]'
                          : pill.status === 'pending_renewal'
                            ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                            : 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]',
                      )}
                      title={pill.title}
                    >
                      {pill.title.length > 18 ? pill.title.slice(0, 16) + '…' : pill.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)] px-4 py-2 border-t border-[var(--border)]">
        Showing next scheduled visit per active contract. Click any visit to open the contract.
      </p>
    </div>
  );
}
