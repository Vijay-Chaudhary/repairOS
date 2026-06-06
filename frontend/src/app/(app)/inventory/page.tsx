'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, SlidersHorizontal, ArrowRightLeft, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Can } from '@/components/shared/Can';
import { StockTable } from '@/components/inventory/StockTable';
import { AdjustmentDialog } from '@/components/inventory/AdjustmentDialog';
import { inventoryApi, type StockRecord } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { useDebounce } from '@/lib/hooks/useDebounce';

export default function InventoryPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [adjustRecord, setAdjustRecord] = useState<StockRecord | null>(null);

  const debouncedSearch = useDebounce(search, 350);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    low_stock_only: lowStockOnly || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: qk.stock(filters),
    queryFn: () => inventoryApi.listStock(filters),
    staleTime: 30_000,
  });

  const records = data?.items ?? [];
  const lowCount = records.filter((r) => r.is_low_stock).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Inventory</h1>
          {lowCount > 0 && (
            <p className="flex items-center gap-1 text-xs text-[var(--warning)] mt-0.5">
              <AlertTriangle className="h-3 w-3" />
              {lowCount} item{lowCount !== 1 ? 's' : ''} below reorder level
            </p>
          )}
        </div>
      </div>

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--warning)]/10 border-b border-[var(--warning)]/30 text-[var(--warning)] text-body-sm">
          <WifiOff className="h-4 w-4 shrink-0" />
          Offline — adjustments unavailable
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] flex-wrap">
        <Input
          placeholder="Search product, variant, SKU…"
          className="h-9 max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-body-sm text-[var(--text)] cursor-pointer">
          <Switch checked={lowStockOnly} onCheckedChange={setLowStockOnly} />
          Low stock only
        </label>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <StockTable
          records={records}
          loading={isLoading}
          onAdjust={isOnline ? (r) => setAdjustRecord(r) : undefined}
        />
      </div>

      {/* Adjustment dialog */}
      <AdjustmentDialog
        open={!!adjustRecord}
        onOpenChange={(v) => !v && setAdjustRecord(null)}
        record={adjustRecord}
      />
    </div>
  );
}
