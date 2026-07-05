'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { auditApi, type AuditAction, type AuditLogEntry } from '@/lib/api/audit';
import { qk } from '@/lib/query/keys';
import { formatDatetime } from '@/lib/format/date';

const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  login: 'Login',
  logout: 'Logout',
  permission_denied: 'Permission denied',
};

const ACTION_CLASSES: Record<AuditAction, string> = {
  create: 'bg-[var(--success)]/10 text-[var(--success)]',
  update: 'bg-[var(--info)]/10 text-[var(--info)]',
  delete: 'bg-[var(--danger)]/10 text-[var(--danger)]',
  login: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
  logout: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
  permission_denied: 'bg-[var(--warning)]/10 text-[var(--warning)]',
};

function ActionBadge({ action }: { action: AuditAction }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${ACTION_CLASSES[action] ?? ''}`}>
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return (
    <div>
      <div className="text-caption font-medium text-[var(--text-muted)] mb-1">{label}</div>
      <pre className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-caption overflow-auto max-h-56">
        {value ? JSON.stringify(value, null, 2) : '—'}
      </pre>
    </div>
  );
}

const columns: Column<AuditLogEntry>[] = [
  {
    key: 'when',
    header: 'When',
    cell: (r) => <span className="text-body-sm whitespace-nowrap">{formatDatetime(r.created_at)}</span>,
  },
  {
    key: 'user',
    header: 'User',
    cell: (r) => <span className="text-body-sm">{r.user_name ?? '—'}</span>,
  },
  {
    key: 'action',
    header: 'Action',
    cell: (r) => <ActionBadge action={r.action} />,
  },
  {
    key: 'model',
    header: 'Model',
    cell: (r) => <span className="text-body-sm font-medium">{r.model_name}</span>,
  },
  {
    key: 'object',
    header: 'Object',
    cell: (r) => (
      <span className="text-caption font-mono text-[var(--text-muted)]">
        {r.object_id ? `${r.object_id.slice(0, 8)}…` : '—'}
      </span>
    ),
  },
  {
    key: 'ip',
    header: 'IP',
    cell: (r) => <span className="text-caption text-[var(--text-muted)]">{r.ip_address ?? '—'}</span>,
  },
];

export default function AuditPage() {
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listPage, setListPage] = useState(1);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  useEffect(() => { setListPage(1); }, [userFilter, actionFilter, modelFilter, dateFrom, dateTo]);

  const filters = {
    user_id: userFilter === 'all' ? undefined : userFilter,
    action: actionFilter === 'all' ? undefined : actionFilter,
    model_name: modelFilter === 'all' ? undefined : modelFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page: listPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.auditLogs(filters),
    queryFn: () => auditApi.list(filters),
    staleTime: 30_000,
  });

  const { data: facetData } = useQuery({
    queryKey: qk.auditFacets(),
    queryFn: () => auditApi.facets(),
    staleTime: 300_000,
  });

  const hasFilters =
    userFilter !== 'all' || actionFilter !== 'all' || modelFilter !== 'all' || !!dateFrom || !!dateTo;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Audit log</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          Who changed what, when — system-wide record of writes and sign-ins
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {(facetData?.users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {(facetData?.actions ?? []).map((a) => (
              <SelectItem key={a} value={a}>{ACTION_LABELS[a] ?? a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={modelFilter} onValueChange={setModelFilter}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {(facetData?.model_names ?? []).map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-[140px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="text-[var(--text-muted)] text-body-sm">–</span>
          <Input type="date" className="h-9 w-[140px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setUserFilter('all'); setActionFilter('all'); setModelFilter('all');
              setDateFrom(''); setDateTo('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 p-4">
        <DataTable
          columns={columns}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={setSelected}
          emptyTitle="No audit entries"
          emptyDescription="Actions across the app will appear here as they happen."
          page={data?.meta.page}
          totalPages={data?.meta.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta.count}
        />
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit entry</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm">
                <div><span className="text-[var(--text-muted)]">When</span><div>{formatDatetime(selected.created_at)}</div></div>
                <div><span className="text-[var(--text-muted)]">User</span><div>{selected.user_name ?? '—'}</div></div>
                <div><span className="text-[var(--text-muted)]">Action</span><div><ActionBadge action={selected.action} /></div></div>
                <div><span className="text-[var(--text-muted)]">Model</span><div>{selected.model_name}</div></div>
                <div><span className="text-[var(--text-muted)]">Object ID</span><div className="font-mono text-caption break-all">{selected.object_id ?? '—'}</div></div>
                <div><span className="text-[var(--text-muted)]">IP</span><div>{selected.ip_address ?? '—'}</div></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <JsonBlock label="Old value" value={selected.old_value} />
                <JsonBlock label="New value" value={selected.new_value} />
              </div>
              {selected.user_agent && (
                <p className="text-caption text-[var(--text-muted)] break-all">{selected.user_agent}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
