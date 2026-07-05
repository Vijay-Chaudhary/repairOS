'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/shared/Money';
import { StatementSectionTable } from '@/components/finance/StatementSectionTable';
import { accountsApi } from '@/lib/api/accounts';
import { qk } from '@/lib/query/keys';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';

export default function ProfitLossPage() {
  const { activeShopId } = useActiveShopStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const params = {
    shop_id: activeShopId ?? undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: qk.profitLoss(params),
    queryFn: () => accountsApi.getProfitLoss(params),
    staleTime: 30_000,
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await accountsApi.downloadStatementCsv('pnl', params);
    } catch {
      toast.error('Export failed', { description: 'Could not download the P&L CSV.' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-body-sm font-medium text-[var(--text)] block mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-body-sm font-medium text-[var(--text)] block mb-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {hasPermission('accounts.reports.export') && (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export CSV
          </Button>
        )}
      </div>

      {isLoading && <p className="text-body-sm text-[var(--text-muted)]">Loading…</p>}
      {data && (
        <>
          <StatementSectionTable title="Income" section={data.income} />
          <StatementSectionTable title="Expenses" section={data.expense} />
          <div className="rounded-lg border border-[var(--border)] flex justify-between items-center px-3 py-3 bg-[var(--surface-2)]">
            <span className="text-body-sm font-semibold">Net Profit</span>
            <Money
              amount={data.net_profit}
              className={
                parseFloat(data.net_profit) >= 0
                  ? 'font-semibold text-[var(--success,#16a34a)]'
                  : 'font-semibold text-[var(--danger,#dc2626)]'
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
