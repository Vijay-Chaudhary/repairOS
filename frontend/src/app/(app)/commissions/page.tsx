'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TrendingUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { commissionsApi, type PayoutStatus } from '@/lib/api/commissions';
import { qk } from '@/lib/query/keys';
import { useAuthStore } from '@/lib/stores/authStore';
import { ApiError } from '@/lib/api/client';
import { formatDate, MONTHS_SHORT as MONTHS, monthStart, monthEnd } from '@/lib/format/date';
import { money } from '@/lib/format/money';
import { cn } from '@/lib/utils';

export default function CommissionsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [payoutTechId, setPayoutTechId] = useState('');
  const [payoutStatus, setPayoutStatus] = useState<PayoutStatus | 'all'>('all');

  const periodStart = monthStart(selectedYear, selectedMonth);
  const periodEnd = monthEnd(selectedYear, selectedMonth);

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: qk.commissions({ techId: user?.id, period_start: periodStart, period_end: periodEnd }),
    queryFn: () => commissionsApi.getTechnicianLedger(user?.id ?? '', { period_start: periodStart, period_end: periodEnd }),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const { data: payoutsData, isLoading: payoutsLoading } = useQuery({
    queryKey: qk.commissions({ status: payoutStatus }),
    queryFn: () => commissionsApi.listPayouts({
      status: payoutStatus === 'all' ? undefined : payoutStatus,
    }),
    staleTime: 30_000,
  });

  const payoutMutation = useMutation({
    mutationFn: () => commissionsApi.createPayout({
      technician_id: payoutTechId,
      period_start: periodStart,
      period_end: periodEnd,
    }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: qk.commissions() });
      toast.success(`Payout ₹${money(p.total_commission).replace('₹','')} created`);
      setPayoutTechId('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Commissions</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <Tabs defaultValue="ledger" className="h-full flex flex-col">
          <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4">
            <TabsList className="h-10 bg-transparent gap-0 -mb-px">
              <TabsTrigger value="ledger" className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-4 py-2 text-body-sm">
                My ledger
              </TabsTrigger>
              <Can anyOf={['hr.salary.generate', 'hr.salary.view']}>
                <TabsTrigger value="payouts" className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-4 py-2 text-body-sm">
                  Payouts
                </TabsTrigger>
              </Can>
            </TabsList>
          </div>

          {/* My ledger tab */}
          <TabsContent value="ledger" className="flex-1 overflow-auto p-4 md:p-6 mt-0 space-y-5">
            {/* Period picker */}
            <div className="flex gap-2 flex-wrap">
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i+1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {ledgerLoading ? (
              <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : !ledger ? (
              <EmptyState icon={TrendingUp} title="No commissions" description="No commission accrued for this period." />
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-[var(--border)] px-3 py-3 text-center">
                    <p className="text-xs text-[var(--text-muted)]">Earned</p>
                    <Money amount={ledger.total_earned} className="text-h2 font-semibold" />
                  </div>
                  <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-3 text-center">
                    <p className="text-xs text-[var(--text-muted)]">Paid</p>
                    <Money amount={ledger.total_paid} className="text-h2 font-semibold text-[var(--success)]" />
                  </div>
                  <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-3 text-center">
                    <p className="text-xs text-[var(--text-muted)]">Unpaid</p>
                    <Money amount={ledger.total_unpaid} className="text-h2 font-semibold text-[var(--warning)]" />
                  </div>
                </div>

                {/* Per-job breakdown */}
                <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                        <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Job</th>
                        <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">S/C</th>
                        <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Rate</th>
                        <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Commission</th>
                        <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.commissions.map((c) => (
                        <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs text-[var(--text)]">{c.job_number}</p>
                            {c.is_lead && <span className="text-[10px] bg-[var(--accent)]/15 text-[var(--accent)] rounded px-1 py-0.5">Lead</span>}
                            {c.sc_amount === 0 && <span className="text-[10px] text-[var(--text-muted)] ml-1">Warranty</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums"><Money amount={c.sc_amount} /></td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)]">{c.rate}%</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">
                            <Money amount={c.commission_amount} />
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
              </>
            )}
          </TabsContent>

          {/* Payouts tab */}
          <TabsContent value="payouts" className="flex-1 overflow-auto p-4 md:p-6 mt-0 space-y-5">
            <Can permission="hr.salary.generate">
              <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                <h2 className="text-body-sm font-semibold text-[var(--text)]">Generate payout batch</h2>
                <div className="flex gap-3 flex-wrap">
                  <Input
                    placeholder="Technician user ID"
                    className="flex-1 min-w-[200px]"
                    value={payoutTechId}
                    onChange={(e) => setPayoutTechId(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                      <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={i} value={String(i+1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                      <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => payoutMutation.mutate()}
                    disabled={!payoutTechId.trim() || payoutMutation.isPending}
                  >
                    {payoutMutation.isPending ? 'Generating…' : 'Generate'}
                  </Button>
                </div>
              </div>
            </Can>

            {/* Payout list */}
            <div className="flex gap-2">
              <Select value={payoutStatus} onValueChange={(v) => setPayoutStatus(v as PayoutStatus | 'all')}>
                <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {payoutsLoading ? (
              <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : (payoutsData?.items ?? []).length === 0 ? (
              <EmptyState icon={TrendingUp} title="No payouts" description="No commission payouts generated yet." />
            ) : (
              <div className="space-y-2">
                {(payoutsData?.items ?? []).map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)]">
                    <div>
                      <p className="text-body-sm font-medium text-[var(--text)]">{p.technician_name ?? p.technician_id}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {formatDate(p.period_start)} – {formatDate(p.period_end)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money amount={p.total_commission} className="font-semibold tabular-nums" />
                      <StatusBadge status={p.status} />
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
