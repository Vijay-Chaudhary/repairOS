'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, AlertTriangle } from 'lucide-react';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SparePartFormSheet } from '@/components/repair/SparePartFormSheet';
import { repairApi, type SparePartListItem, type SparePartStatus } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { formatDate } from '@/lib/format/date';
import { ApiError } from '@/lib/api/client';

const STATUS_OPTIONS: Array<{ value: SparePartStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'rejected', label: 'Rejected' },
];

// Allowed next actions per current status (mirrors the backend state machine)
const NEXT_ACTIONS: Partial<Record<SparePartStatus, Array<{ to: SparePartStatus; label: string }>>> = {
  requested: [{ to: 'approved', label: 'Approve' }, { to: 'rejected', label: 'Reject' }],
  approved: [{ to: 'ordered', label: 'Mark ordered' }],
  ordered: [{ to: 'received', label: 'Mark received' }],
};

export default function SparePartsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;

  const [status, setStatus] = useState<SparePartStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SparePartListItem | null>(null);

  const filters = useMemo(() => ({
    shop_id: shopId,
    status: status === 'all' ? undefined : status,
    page,
  }), [shopId, status, page]);

  React.useEffect(() => { setPage(1); }, [status, shopId]);

  const listQuery = useQuery({
    queryKey: qk.spareParts(filters),
    queryFn: () => repairApi.listSpareParts(filters),
    staleTime: 30_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: SparePartStatus }) => repairApi.reviewSparePart(id, { status: to }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.spareParts() });
      toast.success('Updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  });

  const columns: Column<SparePartListItem>[] = [
    {
      key: 'job', header: 'Job / Customer',
      cell: (r) => (
        <button
          className="text-left"
          onClick={(e) => { e.stopPropagation(); router.push(`/jobs/${r.job_id}`); }}
        >
          <span className="block text-body-sm font-medium text-[var(--accent)] hover:underline">{r.customer_name}</span>
          <span className="block text-xs font-mono text-[var(--text-muted)]">
            {r.job_number}
            <span className="font-sans"> · {r.device_type}</span>
          </span>
        </button>
      ),
    },
    {
      key: 'part', header: 'Part',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text)]">
          {r.is_urgent && <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] shrink-0" />}
          {r.custom_part_name || r.variant_id}
        </span>
      ),
    },
    { key: 'qty', header: 'Qty', headerClassName: 'w-[60px] text-right', className: 'text-right', cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
    { key: 'status', header: 'Status', headerClassName: 'w-[130px]', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'requested_by', header: 'Requested by', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.requested_by_name ?? '—'}</span> },
    { key: 'created', header: 'Requested', headerClassName: 'w-[110px]', cell: (r) => <span className="text-body-sm text-[var(--text-muted)] tabular-nums">{formatDate(r.created_at)}</span> },
    {
      key: 'actions', header: '', headerClassName: 'w-[200px]', className: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === 'requested' && (
            <Can permission="repair.spare_parts.request">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditTarget(r); setSheetOpen(true); }}>Edit</Button>
            </Can>
          )}
          <Can permission="repair.spare_parts.approve">
            {(NEXT_ACTIONS[r.status] ?? []).map((a) => (
              <Button
                key={a.to}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate({ id: r.id, to: a.to })}
              >
                {a.label}
              </Button>
            ))}
          </Can>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap">
        <h1 className="text-h1 text-[var(--text)] mr-2">Spare Parts</h1>
        <Select value={status} onValueChange={(v) => setStatus(v as SparePartStatus | 'all')}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Can permission="repair.spare_parts.request">
            <Button size="sm" className="h-9" onClick={() => { setEditTarget(null); setSheetOpen(true); }}>
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">New request</span>
            </Button>
          </Can>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={columns}
          data={listQuery.data?.items}
          loading={listQuery.isLoading}
          error={listQuery.error as Error | null}
          keyExtractor={(r) => r.id}
          emptyTitle="No spare-part requests"
          emptyDescription="Requests from jobs appear here. Create one with “New request”."
          page={page}
          totalPages={listQuery.data?.meta?.total_pages}
          onPageChange={setPage}
          totalCount={listQuery.data?.meta?.count}
        />
      </div>

      <SparePartFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editTarget={editTarget}
      />
    </div>
  );
}
