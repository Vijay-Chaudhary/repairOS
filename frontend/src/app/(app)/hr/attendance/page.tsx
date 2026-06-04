'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Can } from '@/components/shared/Can';
import {
  hrApi, ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_COLORS, MONTHS,
  type AttendanceStatus,
} from '@/lib/api/hr';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'half_day', 'leave', 'holiday'];

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // Bulk mark form state
  const [bulkDateFrom, setBulkDateFrom] = useState('');
  const [bulkDateTo, setBulkDateTo] = useState('');
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>('present');

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    month,
    year,
  };

  const { data, isLoading } = useQuery({
    queryKey: qk.attendance(filters),
    queryFn: () => hrApi.listAttendance(filters),
    staleTime: 30_000,
  });

  const { data: empData } = useQuery({
    queryKey: qk.employees({ shop_id: isAllShops ? undefined : activeShopId ?? undefined, is_active: true }),
    queryFn: () => hrApi.listEmployees({ shop_id: isAllShops ? undefined : activeShopId ?? undefined, is_active: true }),
    staleTime: 300_000,
  });

  const bulkMutation = useMutation({
    mutationFn: () => hrApi.bulkMarkAttendance({
      shop_id: activeShopId ?? '',
      employee_ids: empData?.items.map((e) => e.id) ?? [],
      date_from: bulkDateFrom,
      date_to: bulkDateTo,
      status: bulkStatus,
    }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: qk.attendance() });
      toast.success(`Marked ${r.created + r.updated} records`);
      setBulkDateFrom('');
      setBulkDateTo('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const records = data?.items ?? [];

  // Group by employee → date map for grid display
  const employeeMap = new Map<string, { name: string; records: Map<string, AttendanceStatus> }>();
  for (const r of records) {
    if (!employeeMap.has(r.employee_id)) {
      employeeMap.set(r.employee_id, { name: r.employee_name, records: new Map() });
    }
    employeeMap.get(r.employee_id)!.records.set(r.date, r.status);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Attendance</h1>
      </div>

      {/* Period + bulk mark */}
      <div className="px-4 py-3 border-b border-[var(--border)] space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i+1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[year-1, year, year+1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Can permission="hr.attendance.mark">
          <div className="flex items-center gap-2 flex-wrap text-body-sm">
            <span className="text-[var(--text-muted)] shrink-0">Bulk mark:</span>
            <Input type="date" className="h-8 w-[130px]" value={bulkDateFrom} onChange={(e) => setBulkDateFrom(e.target.value)} />
            <span className="text-[var(--text-muted)]">–</span>
            <Input type="date" className="h-8 w-[130px]" value={bulkDateTo} onChange={(e) => setBulkDateTo(e.target.value)} />
            <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as AttendanceStatus)}>
              <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace('_',' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8"
              disabled={!bulkDateFrom || !bulkDateTo || bulkMutation.isPending}
              onClick={() => bulkMutation.mutate()}
            >
              Apply
            </Button>
          </div>
        </Can>
      </div>

      {/* Attendance grid */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : employeeMap.size === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">No attendance records for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-max">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-[var(--text-muted)] sticky left-0 bg-[var(--surface)] border-b border-r border-[var(--border)] min-w-[140px]">
                    Employee
                  </th>
                  {days.map((d) => (
                    <th key={d} className="px-1 py-2 font-medium text-[var(--text-muted)] border-b border-[var(--border)] w-8 text-center">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(employeeMap.entries()).map(([empId, { name, records }]) => (
                  <tr key={empId} className="hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-1.5 font-medium text-[var(--text)] sticky left-0 bg-[var(--surface)] border-r border-b border-[var(--border)]">
                      {name}
                    </td>
                    {days.map((d) => {
                      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                      const status = records.get(dateStr);
                      return (
                        <td key={d} className="p-0.5 border-b border-[var(--border)] text-center">
                          {status ? (
                            <span className={cn('inline-flex items-center justify-center h-6 w-6 rounded text-[10px] font-bold', ATTENDANCE_STATUS_COLORS[status])}>
                              {ATTENDANCE_STATUS_LABELS[status]}
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center h-6 w-6 text-[var(--border)]">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-3 flex-wrap mt-4">
          {STATUS_OPTIONS.map((s) => (
            <span key={s} className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <span className={cn('inline-flex items-center justify-center h-5 w-5 rounded text-[10px] font-bold', ATTENDANCE_STATUS_COLORS[s])}>
                {ATTENDANCE_STATUS_LABELS[s]}
              </span>
              {s.replace('_', ' ')}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
