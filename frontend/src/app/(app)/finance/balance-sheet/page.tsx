'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Download, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/shared/Money';
import { StatementSectionTable } from '@/components/finance/StatementSectionTable';
import { accountsApi } from '@/lib/api/accounts';
import { qk } from '@/lib/query/keys';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { cn } from '@/lib/utils';

export default function BalanceSheetPage() {
  const { activeShopId } = useActiveShopStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [asOf, setAsOf] = useState('');
  const [exporting, setExporting] = useState(false);

  const params = { shop_id: activeShopId ?? undefined, as_of: asOf || undefined };
  const { data, isLoading } = useQuery({
    queryKey: qk.balanceSheet(params),
    queryFn: () => accountsApi.getBalanceSheet(params),
    staleTime: 30_000,
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await accountsApi.downloadStatementCsv('balance-sheet', params);
    } catch {
      toast.error('Export failed', { description: 'Could not download the Balance Sheet CSV.' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-body-sm font-medium text-[var(--text)] block mb-1">As of</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
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
          <StatementSectionTable title="Assets" section={data.assets} />
          <StatementSectionTable title="Liabilities" section={data.liabilities} />
          <StatementSectionTable title="Equity" section={data.equity} />

          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="flex justify-between px-3 py-2 text-body-sm">
              <span>Total Assets</span>
              <Money amount={data.total_assets} className="font-semibold" />
            </div>
            <div className="flex justify-between px-3 py-2 text-body-sm border-t border-[var(--border)]">
              <span>Total Liabilities</span>
              <Money amount={data.total_liabilities} className="font-semibold" />
            </div>
            <div className="flex justify-between px-3 py-2 text-body-sm border-t border-[var(--border)]">
              <span>Total Equity</span>
              <Money amount={data.total_equity} className="font-semibold" />
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-body-sm font-semibold border-t border-[var(--border)]',
                data.is_balanced
                  ? 'text-[var(--success,#16a34a)] bg-[var(--surface-2)]'
                  : 'text-[var(--danger,#dc2626)] bg-[var(--surface-2)]',
              )}
            >
              {data.is_balanced ? <Check className="size-4" /> : <X className="size-4" />}
              {data.is_balanced ? 'In balance' : 'Out of balance'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
