'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  platformApi, DB_STATUS_LABELS, DB_STATUS_COLORS, SUB_STATUS_LABELS,
  type Tenant, type DbStatus,
} from '@/lib/api/platform';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { money } from '@/lib/format/money';
import { qk } from '@/lib/query/keys';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

export default function TenantsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DbStatus | 'all'>('all');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [suspendTarget, setSuspendTarget] = useState<Tenant | null>(null);

  const debouncedSearch = useDebounce(search, 350);

  const filters = {
    search: debouncedSearch || undefined,
    db_status: statusFilter === 'all' ? undefined : statusFilter,
    cursor,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.tenants(filters),
    queryFn: () => platformApi.listTenants(filters),
    staleTime: 30_000,
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => platformApi.suspendTenant(id),
    onSuccess: (updated) => {
      queryClient.setQueryData<{ items: Tenant[] }>(
        qk.tenants(filters),
        (old) => old ? { ...old, items: old.items.map((t) => (t.id === updated.id ? updated : t)) } : old,
      );
      toast.success(`${updated.name} has been suspended`);
      setSuspendTarget(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to suspend'),
  });

  const tenants = data?.items ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Tenants</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            {data?.meta?.count != null ? `${data.meta.count} total` : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: qk.tenants() })}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            className="pl-9 h-9 w-[220px]"
            placeholder="Search name or slug…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCursor(undefined); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as DbStatus | 'all'); setCursor(undefined); }}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(DB_STATUS_LABELS) as DbStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{DB_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : error ? (
        <p className="text-body-sm text-[var(--danger)] py-8 text-center">Failed to load tenants.</p>
      ) : tenants.length === 0 ? (
        <p className="text-body-sm text-[var(--text-muted)] py-12 text-center">No tenants found.</p>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left">
                <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Tenant</th>
                <th className="px-4 py-3 font-medium text-[var(--text-muted)]">DB status</th>
                <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Plan</th>
                <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Subscription</th>
                <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr
                  key={tenant.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]/50 cursor-pointer"
                  onClick={() => router.push(`/platform/tenants/${tenant.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--text)]">{tenant.name}</p>
                    <p className="font-mono text-xs text-[var(--text-muted)]">{tenant.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('font-medium', DB_STATUS_COLORS[tenant.db_status])}>
                      {DB_STATUS_LABELS[tenant.db_status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text)]">{tenant.plan_name}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs font-medium px-2 py-1 rounded-full',
                      tenant.subscription_status === 'active' || tenant.subscription_status === 'trialing'
                        ? 'bg-[var(--success)]/10 text-[var(--success)]'
                        : 'bg-[var(--danger)]/10 text-[var(--danger)]',
                    )}>
                      {SUB_STATUS_LABELS[tenant.subscription_status]}
                    </span>
                    {tenant.trial_ends_at && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        until {formatDate(tenant.trial_ends_at)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{formatDate(tenant.created_at)}</td>
                  <td className="px-4 py-3">
                    {tenant.db_status === 'active' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                        onClick={(e) => { e.stopPropagation(); setSuspendTarget(tenant); }}
                      >
                        Suspend
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {(data?.meta?.next_cursor || cursor) && (
            <div className="flex gap-2 p-3 border-t border-[var(--border)]">
              {cursor && (
                <Button size="sm" variant="outline" onClick={() => setCursor(undefined)}>← Previous</Button>
              )}
              {data?.meta?.next_cursor && (
                <Button size="sm" variant="outline" onClick={() => setCursor(data.meta.next_cursor ?? undefined)}>
                  Next →
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!suspendTarget}
        onOpenChange={(v) => { if (!v) setSuspendTarget(null); }}
        title={`Suspend ${suspendTarget?.name}?`}
        description="Their users will be blocked from logging in immediately. You can reactivate from the database."
        confirmLabel="Suspend tenant"
        loading={suspendMutation.isPending}
        onConfirm={() => suspendTarget && suspendMutation.mutate(suspendTarget.id)}
      />
    </div>
  );
}
