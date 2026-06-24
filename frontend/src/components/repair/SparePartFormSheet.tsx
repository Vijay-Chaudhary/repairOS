'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { repairApi, type SparePartListItem } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { cn } from '@/lib/utils';

type RequestMode = 'job' | 'stock';

interface SparePartFormSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTarget: SparePartListItem | null;
}

export function SparePartFormSheet({ open, onOpenChange, editTarget }: SparePartFormSheetProps) {
  const queryClient = useQueryClient();
  const isEdit = editTarget !== null;

  const { shops, activeShopId, isAllShops } = useActiveShopStore();

  const [mode, setMode] = useState<RequestMode>('job');
  const [partName, setPartName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [isUrgent, setIsUrgent] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [stockShopId, setStockShopId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Reset/prefill on open
  useEffect(() => {
    if (!open) return;
    setError('');
    if (editTarget) {
      setPartName(editTarget.custom_part_name);
      setQuantity(String(editTarget.quantity));
      setIsUrgent(editTarget.is_urgent);
      setJobId(editTarget.job_id);
      setJobLabel(editTarget.job_id ? `${editTarget.job_number} · ${editTarget.customer_name}` : '');
    } else {
      setMode('job');
      setPartName(''); setQuantity('1'); setIsUrgent(false);
      setJobId(null); setJobLabel(''); setJobSearch('');
      // Default the stock-mode shop to the active shop (null under "All shops").
      setStockShopId(isAllShops ? null : activeShopId);
    }
  }, [open, editTarget, isAllShops, activeShopId]);

  const debouncedSearch = useDebounce(jobSearch, 300);
  const jobResults = useQuery({
    queryKey: qk.jobs({ search: debouncedSearch || undefined, page: 1, _picker: true }),
    queryFn: () => repairApi.listJobs({ search: debouncedSearch || undefined, page: 1 }),
    enabled: !isEdit && mode === 'job' && open && debouncedSearch.trim().length > 0,
    staleTime: 15_000,
  });

  const qtyNum = parseInt(quantity, 10);

  const createMutation = useMutation({
    mutationFn: () => repairApi.createSparePart(
      mode === 'job'
        ? { job_id: jobId!, custom_part_name: partName, quantity: qtyNum, is_urgent: isUrgent }
        : { shop_id: stockShopId!, custom_part_name: partName, quantity: qtyNum, is_urgent: isUrgent }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.spareParts() });
      toast.success('Request created');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Create failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () => repairApi.updateSparePart(editTarget!.id, { custom_part_name: partName, quantity: qtyNum, is_urgent: isUrgent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.spareParts() });
      toast.success('Request updated');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  });

  function handleSubmit() {
    setError('');
    if (partName.trim().length < 2) { setError('Part name is required.'); return; }
    if (!Number.isFinite(qtyNum) || qtyNum < 1) { setError('Quantity must be at least 1.'); return; }
    if (isEdit) { updateMutation.mutate(); return; }
    if (mode === 'job') {
      if (!jobId) { setError('Select a job for this request.'); return; }
    } else if (!stockShopId) {
      setError('Choose a shop before creating a stock request.'); return;
    }
    createMutation.mutate();
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit spare-part request' : 'New spare-part request'}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto space-y-4 py-4">
          {!isEdit && (
            <div role="radiogroup" aria-label="Request type" className="grid grid-cols-2 gap-2">
              {([['job', 'For a job'], ['stock', 'Stock (no job)']] as const).map(([value, label]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => { setMode(value); setError(''); }}
                  className={cn(
                    'min-h-[44px] rounded-md border px-3 text-body-sm font-medium transition-colors',
                    mode === value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-muted)]'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!isEdit && mode === 'stock' && (
            <div>
              <label htmlFor="sp-shop" className="text-body-sm font-medium text-[var(--text)] block mb-1">Shop</label>
              {isAllShops || shops.length > 1 ? (
                <select
                  id="sp-shop"
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-body-sm"
                  value={stockShopId ?? ''}
                  onChange={(e) => setStockShopId(e.target.value || null)}
                >
                  <option value="">Select a shop…</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <div className="rounded-md border border-[var(--border)] px-3 py-2 text-body-sm text-[var(--text-muted)]">
                  {shops.find((s) => s.id === stockShopId)?.name ?? 'Current shop'}
                </div>
              )}
            </div>
          )}

          {!isEdit && mode === 'job' && (
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Job</label>
              {jobId ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-body-sm">
                  <span className="truncate">{jobLabel}</span>
                  <button className="text-xs text-[var(--accent)]" onClick={() => { setJobId(null); setJobLabel(''); }}>Change</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                    <Input className="pl-9 h-9" placeholder="Search job # or customer…" value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} />
                  </div>
                  {(jobResults.data?.items ?? []).length > 0 && (
                    <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
                      {jobResults.data!.items.map((j) => (
                        <li key={j.id}>
                          <button
                            className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] min-h-[44px]"
                            onClick={() => { setJobId(j.id); setJobLabel(`${j.job_number} · ${j.customer_name}`); }}
                          >
                            <span className="block text-body-sm font-medium text-[var(--text)]">{j.customer_name}</span>
                            <span className="block text-xs font-mono text-[var(--text-muted)]">{j.job_number} · {j.device_type}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label htmlFor="sp-part" className="text-body-sm font-medium text-[var(--text)] block mb-1">Part name</label>
            <Input id="sp-part" className="h-9" value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="e.g. LCD Screen" />
          </div>

          <div>
            <label htmlFor="sp-qty" className="text-body-sm font-medium text-[var(--text)] block mb-1">Quantity</label>
            <Input id="sp-qty" type="number" min={1} className="h-9 w-28" value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))} />
          </div>

          <label className="flex items-center justify-between gap-2">
            <span className="text-body-sm font-medium text-[var(--text)]">Urgent</span>
            <Switch checked={isUrgent} onCheckedChange={setIsUrgent} />
          </label>

          {error && <p className="text-body-sm text-[var(--danger)]" role="alert">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-[var(--border)] pt-4">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button className={cn('flex-1')} onClick={handleSubmit} disabled={pending}>
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
