'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PaginationBar } from '@/components/shared/PaginationBar';
import { StaffPicker } from '@/components/shared/StaffPicker';
import { Can } from '@/components/shared/Can';
import { hrApi, LEAVE_TYPE_LABELS, type LeaveStatus, type LeaveType } from '@/lib/api/hr';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

export default function LeavePage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>('pending');
  const [createOpen, setCreateOpen] = useState(false);
  const [listPage, setListPage] = useState(1);

  useEffect(() => { setListPage(1); }, [statusFilter]);

  // Create form
  const [empId, setEmpId] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('casual');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');

  const leaveFilters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page: listPage,
  };

  const { data, isLoading } = useQuery({
    queryKey: qk.leaves(leaveFilters),
    queryFn: () => hrApi.listLeaves(leaveFilters),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () => hrApi.createLeave({
      employee_id: empId,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      days,
      reason,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.leaves() });
      toast.success('Leave request submitted');
      setEmpId(''); setFromDate(''); setToDate(''); setReason('');
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      hrApi.reviewLeave(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.leaves() });
      toast.success('Leave request updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const requests = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Leave Requests</h1>
        <Can permission="hr.leaves.manage">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New request</span>
          </Button>
        </Can>
      </div>

      <div className="px-4 py-2 border-b border-[var(--border)]">
        <div className="flex rounded-md border border-[var(--border)] overflow-hidden w-fit">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors capitalize',
                statusFilter === s ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : requests.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">No leave requests.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div key={req.id} className="flex items-start justify-between gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-body-sm font-medium text-[var(--text)]">{req.employee_name}</p>
                    <span className="text-xs bg-[var(--surface-2)] rounded px-1.5 py-0.5 text-[var(--text-muted)]">
                      {LEAVE_TYPE_LABELS[req.leave_type]}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
                    {formatDate(req.from_date)} – {formatDate(req.to_date)} · {req.days} day{req.days !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 italic">{req.reason}</p>
                </div>
                {req.status === 'pending' && (
                  <Can permission="hr.leaves.manage">
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        size="sm" variant="outline"
                        className="h-8 w-8 p-0 border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                        onClick={() => reviewMutation.mutate({ id: req.id, status: 'rejected' })}
                        disabled={reviewMutation.isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 bg-[var(--success)] hover:bg-[var(--success)]/90"
                        onClick={() => reviewMutation.mutate({ id: req.id, status: 'approved' })}
                        disabled={reviewMutation.isPending}
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  </Can>
                )}
              </div>
            ))}
          </div>
        )}
        {data?.meta?.total_pages !== undefined && data.meta.total_pages > 1 && (
          <PaginationBar
            page={listPage}
            totalPages={data.meta.total_pages}
            totalCount={data.meta.count}
            loading={isLoading}
            onPageChange={setListPage}
          />
        )}
      </div>

      {/* New leave request dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New leave request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Employee *</label>
              <StaffPicker
                source="employees"
                placeholder="Select employee…"
                value={empId}
                onChange={setEmpId}
              />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Leave type</label>
              <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
                    <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">From *</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">To *</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Days</label>
              <Input type="number" min={0.5} step={0.5} value={days} onChange={(e) => setDays(parseFloat(e.target.value) || 1)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Reason *</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!empId || !fromDate || !toDate || !reason || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
