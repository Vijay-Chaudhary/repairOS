'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Money } from '@/components/shared/Money';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Can } from '@/components/shared/Can';
import { financeApi, ASSET_CONDITION_LABELS, ASSET_CONDITION_COLORS, type ShopAsset, type AssetCondition } from '@/lib/api/finance';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const COLUMNS: Column<ShopAsset>[] = [
  { key: 'code', header: 'Asset', cell: (r) => (
    <div>
      <p className="text-body-sm font-medium text-[var(--text)]">{r.name}</p>
      <p className="font-mono text-xs text-[var(--text-muted)]">{r.asset_code}</p>
    </div>
  )},
  { key: 'cat', header: 'Category', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.category}</span> },
  { key: 'cost', header: 'Purchase cost', cell: (r) => <Money amount={r.purchase_cost} className="text-body-sm tabular-nums" /> },
  { key: 'date', header: 'Purchased', cell: (r) => r.purchase_date ? <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.purchase_date)}</span> : <span className="text-[var(--text-muted)]">—</span> },
  { key: 'condition', header: 'Condition', cell: (r) => (
    <span className={cn('text-body-sm font-medium', ASSET_CONDITION_COLORS[r.condition])}>
      {ASSET_CONDITION_LABELS[r.condition]}
    </span>
  )},
  { key: 'location', header: 'Location', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.location_description ?? '—'}</span> },
];

export default function AssetsPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [showDisposed, setShowDisposed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<ShopAsset | null>(null);

  // Form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchaseCost, setPurchaseCost] = useState(0);
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [condition, setCondition] = useState<AssetCondition>('good');
  const [location, setLocation] = useState('');

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    is_active: showDisposed ? undefined : true,
    cursor,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.assets(filters),
    queryFn: () => financeApi.listAssets(filters),
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const body = {
        shop_id: activeShopId ?? '',
        name, category, asset_code: assetCode,
        purchase_date: purchaseDate || undefined,
        purchase_cost: purchaseCost,
        warranty_expiry: warrantyExpiry || undefined,
        condition,
        location_description: location || undefined,
      };
      return editing
        ? financeApi.updateAsset(editing.id, { condition, location_description: location || undefined })
        : financeApi.createAsset(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.assets() });
      toast.success(editing ? 'Asset updated' : 'Asset created');
      setName(''); setCategory(''); setAssetCode(''); setPurchaseDate('');
      setPurchaseCost(0); setWarrantyExpiry(''); setCondition('good'); setLocation('');
      setEditing(null);
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  function openEdit(asset: ShopAsset) {
    setEditing(asset);
    setCondition(asset.condition);
    setLocation(asset.location_description ?? '');
    setCreateOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Assets</h1>
        <Can permission="erp.assets.manage">
          <Button size="sm" onClick={() => { setEditing(null); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add asset</span>
          </Button>
        </Can>
      </div>
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)]">
        <label className="flex items-center gap-2 text-body-sm cursor-pointer">
          <Switch checked={showDisposed} onCheckedChange={setShowDisposed} />
          Include disposed
        </label>
      </div>
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={openEdit}
          emptyTitle="No assets"
          emptyDescription="Track shop equipment, tools, and other fixed assets."
          emptyAction={{ label: 'Add asset', onClick: () => setCreateOpen(true) }}
          hasNextPage={!!data?.meta?.next_cursor}
          hasPrevPage={!!cursor}
          onNextPage={() => setCursor(data?.meta?.next_cursor ?? undefined)}
          onPrevPage={() => setCursor(undefined)}
        />
      </div>

      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit asset' : 'Add asset'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Name *</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Asset code *</label>
                    <Input className="font-mono" value={assetCode} onChange={(e) => setAssetCode(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Category *</label>
                    <Input placeholder="Equipment, Vehicle…" value={category} onChange={(e) => setCategory(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Purchase cost</label>
                    <MoneyInput value={purchaseCost} onChange={setPurchaseCost} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Purchase date</label>
                    <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Warranty expiry</label>
                    <Input type="date" value={warrantyExpiry} onChange={(e) => setWarrantyExpiry(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Condition</label>
              <Select value={condition} onValueChange={(v) => setCondition(v as AssetCondition)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ASSET_CONDITION_LABELS) as AssetCondition[]).map((c) => (
                    <SelectItem key={c} value={c}>{ASSET_CONDITION_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Location</label>
              <Input placeholder="Workshop floor, storeroom…" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={(!editing && (!name || !assetCode || !category)) || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
