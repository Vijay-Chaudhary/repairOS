'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Can } from '@/components/shared/Can';
import { accountsApi, type Account, type AccountType } from '@/lib/api/accounts';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';

const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('asset');
  const [parentId, setParentId] = useState('');

  const filters = { shop_id: isAllShops ? undefined : activeShopId ?? undefined };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.accounts(filters),
    queryFn: () => accountsApi.listAccounts(filters),
    staleTime: 30_000,
  });

  const accounts = useMemo(() => data?.items ?? [], [data]);
  const grouped = useMemo(() => {
    const map = new Map<AccountType, Account[]>();
    for (const t of TYPE_ORDER) map.set(t, []);
    for (const a of accounts) map.get(a.account_type)?.push(a);
    return map;
  }, [accounts]);

  const resetForm = () => {
    setCode(''); setName(''); setAccountType('asset'); setParentId(''); setEditing(null);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      accountsApi.createAccount({
        code, name, account_type: accountType,
        parent_id: parentId || undefined,
        shop_id: activeShopId ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accounts() });
      toast.success('Account created');
      resetForm();
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      accountsApi.updateAccount(editing!.id, { name, parent_id: parentId || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accounts() });
      toast.success('Account updated');
      resetForm();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const seedMutation = useMutation({
    mutationFn: () => accountsApi.seedChart(activeShopId ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accounts() });
      toast.success('Default chart created');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => accountsApi.deactivateAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.accounts() });
      toast.success('Account deactivated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const openEdit = (a: Account) => {
    setEditing(a);
    setCode(a.code); setName(a.name); setAccountType(a.account_type); setParentId(a.parent_id ?? '');
  };

  const isEmpty = !isLoading && !error && accounts.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Chart of Accounts</h1>
        <Can permission="accounts.chart.manage">
          <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New account</span>
          </Button>
        </Can>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {isLoading && <p className="text-body-sm text-[var(--text-muted)]">Loading…</p>}
        {error && <p className="text-body-sm text-[var(--danger)]">Failed to load accounts.</p>}

        {isEmpty && (
          <div className="text-center py-12">
            <p className="text-body-sm text-[var(--text-muted)] mb-4">No accounts yet.</p>
            <Can permission="accounts.chart.manage">
              <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                {seedMutation.isPending ? 'Seeding…' : 'Seed default chart'}
              </Button>
            </Can>
          </div>
        )}

        {TYPE_ORDER.map((type) => {
          const rows = grouped.get(type) ?? [];
          if (rows.length === 0) return null;
          return (
            <section key={type}>
              <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
                {TYPE_LABELS[type]}
              </h2>
              <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                {rows.map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono-num text-body-sm text-[var(--text-muted)] w-16">{a.code}</span>
                      <span className="text-body-sm text-[var(--text)]">{a.name}</span>
                      {!a.is_active && (
                        <span className="text-xs text-[var(--text-muted)] border border-[var(--border)] rounded px-1.5">inactive</span>
                      )}
                      {a.is_system && (
                        <span className="text-xs text-[var(--text-muted)] border border-[var(--border)] rounded px-1.5">system</span>
                      )}
                    </div>
                    <Can permission="accounts.chart.manage">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>Edit</Button>
                        {!a.is_system && a.is_active && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deactivateMutation.mutate(a.id)}
                            disabled={deactivateMutation.isPending}
                          >
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </Can>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={createOpen || editing !== null} onOpenChange={(o) => { if (!o) { setCreateOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? 'Edit account' : 'New account'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Code *</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={editing !== null} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Type *</label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as AccountType)} disabled={editing !== null}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Parent</label>
              <Select value={parentId || 'none'} onValueChange={(v) => setParentId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {accounts
                    .filter((a) => a.account_type === accountType && a.id !== editing?.id)
                    .map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!code || !name || createMutation.isPending || updateMutation.isPending}
                onClick={() => (editing ? updateMutation.mutate() : createMutation.mutate())}
              >
                {editing ? (updateMutation.isPending ? 'Saving…' : 'Save') : (createMutation.isPending ? 'Creating…' : 'Create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
