'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { billingApi } from '@/lib/api/billing';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';

export function TallyExportPanel() {
  const { activeShopId, isAllShops } = useActiveShopStore();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + '01';

  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (!activeShopId || isAllShops) {
      toast.error('Select a shop', { description: 'Please select a specific shop before exporting.' });
      return;
    }
    if (!fromDate || !toDate) {
      toast.error('Select date range');
      return;
    }
    setLoading(true);
    try {
      await billingApi.tallyExport({ shop_id: activeShopId, from_date: fromDate, to_date: toDate });
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed', { description: 'Could not download Tally CSV.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
      <div>
        <h3 className="text-body-sm font-semibold text-[var(--text)]">Tally / GST Export</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Download invoice data as a Tally-compatible CSV for the selected period.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="tally-from" className="text-xs">From</Label>
          <Input
            id="tally-from"
            type="date"
            className="h-8 text-xs"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tally-to" className="text-xs">To</Label>
          <Input
            id="tally-to"
            type="date"
            className="h-8 text-xs"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      <Button
        size="sm"
        className="w-full h-8 text-xs"
        onClick={handleExport}
        disabled={loading || isAllShops || !activeShopId}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5 mr-1.5" />
        )}
        Download CSV
      </Button>
    </div>
  );
}
