'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { accountsApi, type JournalEntry } from '@/lib/api/accounts';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

interface DraftLine {
  account_id: string;
  debit: string;
  credit: string;
}

const emptyLine = (): DraftLine => ({ account_id: '', debit: '', credit: '' });

function entryTotal(e: JournalEntry): number {
  return e.lines.reduce((sum, l) => sum + Number(l.debit), 0);
}

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', posted: 'Posted' };

export default function JournalPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [listPage, setListPage] = useState(1);

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const filters = { shop_id: isAllShops ? undefined : activeShopId ?? undefined, page: listPage };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.journal(filters),
    queryFn: () => accountsApi.listJournal(filters),
    staleTime: 30_000,
  });

  const { data: acctData } = useQuery({
    queryKey: qk.accounts({ shop_id: activeShopId ?? undefined }),
    queryFn: () => accountsApi.listAccounts({ shop_id: activeShopId ?? undefined, is_active: true }),
    staleTime: 300_000,
  });
  const accounts = acctData?.items ?? [];

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: debit > 0 && Math.abs(debit - credit) < 0.005 };
  }, [lines]);

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setNarration('');
    setLines([emptyLine(), emptyLine()]);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      accountsApi.createJournal({
        date,
        narration,
        shop_id: activeShopId ?? undefined,
        lines: lines
          .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({ account_id: l.account_id, debit: l.debit || '0', credit: l.credit || '0' })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.journal() });
      toast.success('Journal entry created');
      resetForm();
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => accountsApi.postJournal(id),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: qk.journal() });
      setSelected(entry);
      toast.success('Entry posted');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) => setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  const COLUMNS: Column<JournalEntry>[] = [
    { key: 'number', header: 'Entry #', cell: (r) => <span className="font-mono-num text-body-sm">{r.entry_number}</span> },
    { key: 'date', header: 'Date', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.date)}</span> },
    { key: 'narration', header: 'Narration', cell: (r) => <span className="text-body-sm">{r.narration || '—'}</span> },
    { key: 'total', header: 'Total', cell: (r) => <Money amount={entryTotal(r)} className="text-body-sm font-semibold" /> },
    { key: 'status', header: 'Status', cell: (r) => (
      <span className={r.status === 'posted' ? 'text-[var(--success)] text-body-sm' : 'text-[var(--text-muted)] text-body-sm'}>
        {STATUS_LABELS[r.status]}
      </span>
    )},
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Journal</h1>
        <Can permission="accounts.journal.create">
          <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New entry</span>
          </Button>
        </Can>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => setSelected(r)}
          emptyTitle="No journal entries"
          emptyDescription="Record a balanced double-entry transaction."
          page={listPage}
          totalPages={data?.meta?.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta?.count}
        />
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New journal entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Date *</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Narration</label>
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={l.account_id} onValueChange={(v) => setLine(i, { account_id: v })}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Account…" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min="0" step="0.01" placeholder="Debit" className="w-28"
                    value={l.debit}
                    onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                  />
                  <Input
                    type="number" min="0" step="0.01" placeholder="Credit" className="w-28"
                    value={l.credit}
                    onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </div>

            <div className={`flex items-center justify-between rounded-md px-3 py-2 text-body-sm ${totals.balanced ? 'bg-[var(--success-bg,transparent)] text-[var(--success)]' : 'text-[var(--danger)]'}`}>
              <span>Debit {totals.debit.toFixed(2)} · Credit {totals.credit.toFixed(2)}</span>
              <span>{totals.balanced ? 'Balanced' : 'Unbalanced'}</span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!totals.balanced || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Saving…' : 'Save draft'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selected?.entry_number} · {selected ? STATUS_LABELS[selected.status] : ''}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <p className="text-body-sm text-[var(--text-muted)]">
                {formatDate(selected.date)}{selected.narration ? ` · ${selected.narration}` : ''}
              </p>
              <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                {selected.lines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-3 py-2 text-body-sm">
                    <span>{l.account_code} {l.account_name}</span>
                    <span className="flex gap-6 font-mono-num">
                      <Money amount={l.debit} className="w-24 text-right" />
                      <Money amount={l.credit} className="w-24 text-right" />
                    </span>
                  </div>
                ))}
              </div>
              {selected.status === 'draft' && (
                <Can permission="accounts.journal.post">
                  <Button
                    className="w-full"
                    onClick={() => postMutation.mutate(selected.id)}
                    disabled={postMutation.isPending}
                  >
                    {postMutation.isPending ? 'Posting…' : 'Post entry'}
                  </Button>
                </Can>
              )}
              {selected.status === 'posted' && (
                <p className="text-xs text-[var(--text-muted)] text-center">Posted entries are read-only.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
