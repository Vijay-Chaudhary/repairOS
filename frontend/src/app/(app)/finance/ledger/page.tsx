'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Money } from '@/components/shared/Money';
import { accountsApi } from '@/lib/api/accounts';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { cn } from '@/lib/utils';

type View = 'ledger' | 'trial-balance';

export default function LedgerPage() {
  const { activeShopId } = useActiveShopStore();
  const [view, setView] = useState<View>('ledger');
  const [accountId, setAccountId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: acctData } = useQuery({
    queryKey: qk.accounts({ shop_id: activeShopId ?? undefined }),
    queryFn: () => accountsApi.listAccounts({ shop_id: activeShopId ?? undefined }),
    staleTime: 300_000,
  });
  const accounts = acctData?.items ?? [];

  const ledgerParams = { date_from: dateFrom || undefined, date_to: dateTo || undefined };
  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: qk.ledger(accountId, ledgerParams),
    queryFn: () => accountsApi.getLedger(accountId, ledgerParams),
    enabled: view === 'ledger' && !!accountId,
    staleTime: 30_000,
  });

  const tbParams = { shop_id: activeShopId ?? undefined };
  const { data: trialBalance, isLoading: tbLoading } = useQuery({
    queryKey: qk.trialBalance(tbParams),
    queryFn: () => accountsApi.getTrialBalance(tbParams),
    enabled: view === 'trial-balance',
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2">
        <button
          onClick={() => setView('ledger')}
          className={cn('px-3 py-1.5 rounded-md text-body-sm font-medium', view === 'ledger' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]')}
        >
          Ledger
        </button>
        <button
          onClick={() => setView('trial-balance')}
          className={cn('px-3 py-1.5 rounded-md text-body-sm font-medium', view === 'trial-balance' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]')}
        >
          Trial Balance
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {view === 'ledger' && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem]">
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Account</label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">From</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">To</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            {!accountId && <p className="text-body-sm text-[var(--text-muted)]">Pick an account to view its ledger.</p>}
            {accountId && ledgerLoading && <p className="text-body-sm text-[var(--text-muted)]">Loading…</p>}
            {ledger && (
              <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                <div className="flex justify-between px-3 py-2 bg-[var(--surface-2)] text-body-sm">
                  <span>Opening balance</span>
                  <Money amount={ledger.opening_balance} className="font-semibold" />
                </div>
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-left">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Entry #</th>
                      <th className="px-3 py-2 font-medium text-right">Debit</th>
                      <th className="px-3 py-2 font-medium text-right">Credit</th>
                      <th className="px-3 py-2 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((r) => (
                      <tr key={r.line_id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 text-[var(--text-muted)]">{r.date}</td>
                        <td className="px-3 py-2 font-mono-num">{r.entry_number}</td>
                        <td className="px-3 py-2 text-right"><Money amount={r.debit} /></td>
                        <td className="px-3 py-2 text-right"><Money amount={r.credit} /></td>
                        <td className="px-3 py-2 text-right"><Money amount={r.running_balance} className="font-semibold" /></td>
                      </tr>
                    ))}
                    {ledger.rows.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-[var(--text-muted)]">No postings in range.</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="flex justify-between px-3 py-2 bg-[var(--surface-2)] text-body-sm border-t border-[var(--border)]">
                  <span>Closing balance</span>
                  <Money amount={ledger.closing_balance} className="font-semibold" />
                </div>
              </div>
            )}
          </>
        )}

        {view === 'trial-balance' && (
          <>
            {tbLoading && <p className="text-body-sm text-[var(--text-muted)]">Loading…</p>}
            {trialBalance && (
              <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-left">
                      <th className="px-3 py-2 font-medium">Code</th>
                      <th className="px-3 py-2 font-medium">Account</th>
                      <th className="px-3 py-2 font-medium text-right">Debit</th>
                      <th className="px-3 py-2 font-medium text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.rows.map((r) => (
                      <tr key={r.account_id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 font-mono-num text-[var(--text-muted)]">{r.code}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2 text-right"><Money amount={r.debit} /></td>
                        <td className="px-3 py-2 text-right"><Money amount={r.credit} /></td>
                      </tr>
                    ))}
                    {trialBalance.rows.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-[var(--text-muted)]">No posted entries.</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--border)] font-semibold bg-[var(--surface-2)]">
                      <td className="px-3 py-2" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right"><Money amount={trialBalance.total_debit} /></td>
                      <td className="px-3 py-2 text-right"><Money amount={trialBalance.total_credit} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
