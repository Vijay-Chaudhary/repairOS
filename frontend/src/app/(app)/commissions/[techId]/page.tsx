'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, TrendingUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { commissionsApi } from '@/lib/api/commissions';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate, MONTHS_SHORT as MONTHS, monthStart, monthEnd } from '@/lib/format/date';
import { money } from '@/lib/format/money';
import { cn } from '@/lib/utils';

export default function TechnicianLedgerPage() {
  const params = useParams();
  const techId = params.techId as string;
  const queryClient = useQueryClient();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  const periodStart = monthStart(year, month);
  const periodEnd = monthEnd(year, month);

  const { data: ledger, isLoading } = useQuery({
    queryKey: qk.commissions({ techId, period_start: periodStart, period_end: periodEnd }),
    queryFn: () => commissionsApi.getTechnicianLedger(techId, { period_start: periodStart, period_end: periodEnd }),
    enabled: !!techId,
    staleTime: 60_000,
  });

  const { data: payoutsData, isLoading: payoutsLoading } = useQuery({
    queryKey: qk.commissions({ techId, payouts: true }),
    queryFn: () => commissionsApi.listPayouts({ technician_id: techId }),
    enabled: !!techId,
    staleTime: 30_000,
  });

  const payoutMutation = useMutation({
    mutationFn: () => commissionsApi.createPayout({
      technician_id: techId,
      period_start: periodStart,
      period_end: periodEnd,
    }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: qk.commissions() });
      toast.success(`Payout ₹${money(p.total_commission).replace('₹', '')} created`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const advanceMutation = useMutation({
    mutationFn: (payoutId: string) => commissionsApi.advancePayout(payoutId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.commissions() });
      toast.success('Payout status updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const techName = ledger?.technician_name ?? techId;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/commissions" className="text-[var(--text-muted)] hover:text-[var(--text)] shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-h1 text-[var(--text)] truncate">{techName}</h1>
            <p className="text-xs text-[var(--text-muted)]">Commission ledger</p>
          </div>
        </div>
        <Can permission="hr.salary.generate">
          <Button
            size="sm"
            onClick={() => payoutMutation.mutate()}
            disabled={!ledger || (ledger.total_unpaid === 0) || payoutMutation.isPending}
          >
            {payoutMutation.isPending ? 'Generating…' : 'Generate payout'}
          </Button>
        </Can>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Period picker */}
        <div className="flex gap-2 flex-wrap">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i+1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
            <Skeleton className="h-48" />
          </div>
        ) : !ledger ? (
          <EmptyState icon={TrendingUp} title="No commissions" description="No commission accrued for this period." />
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--border)] px-4 py-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">Earned</p>
                <Money amount={ledger.total_earned} className="text-h2 font-semibold" />
              </div>
              <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 px-4 py-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">Paid</p>
                <Money amount={ledger.total_paid} className="text-h2 font-semibold text-[var(--success)]" />
              </div>
              <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-4 py-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">Unpaid</p>
                <Money amount={ledger.total_unpaid} className="text-h2 font-semibold text-[var(--warning)]" />
              </div>
            </div>

            {/* Per-job breakdown */}
            {ledger.commissions.length > 0 ? (
              <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                      <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Job</th>
                      <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">S/C</th>
                      <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Rate</th>
                      <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Commission</th>
                      <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Closed</th>
                      <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.commissions.map((c) => (
                      <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-[var(--text)]">{c.job_number}</p>
                          {c.is_lead && (
                            <span className="text-[10px] bg-[var(--accent)]/15 text-[var(--accent)] rounded px-1 py-0.5">Lead</span>
                          )}
                          {c.sc_amount === 0 && (
                            <span className="text-[10px] text-[var(--text-muted)] ml-1">Warranty</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <Money amount={c.sc_amount} />
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text-muted)]">{c.rate}%</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          <Money amount={c.commission_amount} />
                        </td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">
                          {formatDate(c.job_closed_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs font-medium', c.is_paid ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
                            {c.is_paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">No jobs closed in this period.</p>
            )}
          </>
        )}

        {/* Payout history */}
        <div>
          <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
            Payout history
          </h2>
          {payoutsLoading ? (
            <div className="space-y-2">{[1,2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (payoutsData?.items ?? []).length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)]">No payouts yet.</p>
          ) : (
            <div className="space-y-2">
              {(payoutsData?.items ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)]">
                  <div>
                    <p className="text-body-sm text-[var(--text-muted)]">
                      {formatDate(p.period_start)} – {formatDate(p.period_end)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money amount={p.total_commission} className="font-semibold tabular-nums" />
                    <StatusBadge status={p.status} />
                    <Can permission="hr.salary.generate">
                      {p.status !== 'paid' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={advanceMutation.isPending}
                          onClick={() => advanceMutation.mutate(p.id)}
                        >
                          {p.status === 'draft' ? 'Approve' : 'Mark paid'}
                        </Button>
                      )}
                    </Can>
                    {p.pdf_url && (
                      <a href={p.pdf_url} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
