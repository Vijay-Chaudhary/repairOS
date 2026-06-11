# Inter-Shop Stock TransferDialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `TransferDialog.tsx` — the missing UI for `POST /inventory/transfer/` — and wire its "Transfer" button into the inventory page header, covering source/dest shop selection, variant typeahead, qty + note, client-side validation, INSUFFICIENT_STOCK handling, and dual-shop cache invalidation.

**Architecture:** Pure frontend feature — the backend `POST /inventory/transfer/` endpoint is already fully implemented and returns `{ transactions: InventoryTransaction[] }`. The dialog follows the exact same pattern as `AdjustmentDialog.tsx` (zod + RHF, useMutation, preview card, token CSS vars). The variant picker is an inline Popover+Input combobox that queries `inventoryApi.listStock({ shop_id: sourceShopId, search })` — identical mechanics to the `StaffPicker` introduced in the previous sprint. Shops come from the already-loaded `useActiveShopStore().shops` — no extra network call.

**Tech Stack:** React 18, Next.js 14, TanStack Query v5, React Hook Form + Zod, Radix Popover (already in project), Tailwind CSS + token CSS vars, `useDebounce` hook (`src/lib/hooks/useDebounce.ts`).

---

## Confirmed Contracts

**`POST /inventory/transfer/`** (already live):
- Request body: `{ source_shop_id: string, dest_shop_id: string, variant_id: string, quantity: number, note?: string }`
- 201 response: `{ transactions: InventoryTransaction[] }` — always returns 2 records: `transfer_out` (source) + `transfer_in` (dest)
- 400 response: `{ code: "INSUFFICIENT_STOCK", detail: "..." }` when source stock < quantity

**`inventoryApi.transferStock(body)`** — already typed in `frontend/src/lib/api/inventory.ts:120-127`.

**`useActiveShopStore().shops`** — `Shop[]` with `{ id, name }` — already populated at app boot, no fetch needed.

**`inventoryApi.listStock({ shop_id, search })`** — returns `{ items: StockRecord[] }`. `StockRecord` has: `variant_id`, `product_name`, `variant_name`, `sku`, `quantity_in_stock`.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Create** | `frontend/src/components/inventory/TransferDialog.tsx` | The new dialog component |
| **Modify** | `frontend/src/app/(app)/inventory/page.tsx` | Add state + Transfer button + render dialog |
| **Modify** | `docs/ALIGNMENT_AUDIT.md` | Mark Inventory #8 DONE |

---

## Task 1: Build `TransferDialog.tsx`

**Files:**
- Create: `frontend/src/components/inventory/TransferDialog.tsx`

The dialog has four sections:
1. **Source shop select** — `Select` over `shops`, defaults to `activeShopId`
2. **Variant picker** — inline Popover+Input combobox querying stock of source shop
3. **Destination shop select** — same `shops` list; zod `.refine` blocks source === dest
4. **Quantity + note** — number input (min 1) + optional text input

State held inside the dialog (not controlled by parent):
- `selectedVariant: StockRecord | null` — used to show the current-stock preview
- `variantQuery: string` — the live search input
- `variantOpen: boolean` — Popover state

When `source_shop_id` changes, reset `variant_id`, `variantQuery`, `selectedVariant`.

**Preview card** (below quantity): shows "Source stock: N → N − qty" in red if result < 0. The submit button is disabled when the preview would go negative (mirrors AdjustmentDialog).

**Success toast**: `"Transferred {qty} × {product_name} {variant_name} → {destShopName}"`  
After success, invalidate `qk.stock()` and `qk.stockMovements()` (covers both shops since these keys are top-level).

- [ ] **Step 1: Create the component file**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightLeft, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { inventoryApi, type StockRecord } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

const schema = z.object({
  source_shop_id: z.string().min(1, 'Select source shop'),
  dest_shop_id: z.string().min(1, 'Select destination shop'),
  variant_id: z.string().min(1, 'Select a product variant'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  note: z.string().optional(),
}).refine((d) => d.source_shop_id !== d.dest_shop_id, {
  message: 'Source and destination must be different shops',
  path: ['dest_shop_id'],
});

type FormValues = z.infer<typeof schema>;

export interface TransferDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TransferDialog({ open, onOpenChange }: TransferDialogProps) {
  const queryClient = useQueryClient();
  const { activeShopId, shops } = useActiveShopStore();

  const [selectedVariant, setSelectedVariant] = useState<StockRecord | null>(null);
  const [variantQuery, setVariantQuery] = useState('');
  const [variantOpen, setVariantOpen] = useState(false);

  const debouncedVariantQuery = useDebounce(variantQuery, 350);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      source_shop_id: activeShopId ?? '',
      dest_shop_id: '',
      variant_id: '',
      quantity: 1,
      note: '',
    },
  });

  const sourceShopId = form.watch('source_shop_id');
  const quantity = form.watch('quantity') ?? 1;
  const sourceQty = selectedVariant?.quantity_in_stock ?? 0;
  const resultingStock = sourceQty - quantity;
  const wouldGoNegative = resultingStock < 0;

  // Reset variant when source shop changes
  useEffect(() => {
    setSelectedVariant(null);
    setVariantQuery('');
    form.setValue('variant_id', '');
  }, [sourceShopId, form]);

  const stockQuery = useQuery({
    queryKey: ['transfer-variant-search', sourceShopId, debouncedVariantQuery],
    queryFn: () => inventoryApi.listStock({
      shop_id: sourceShopId || undefined,
      search: debouncedVariantQuery || undefined,
    }),
    enabled: variantOpen && !!sourceShopId,
    staleTime: 30_000,
  });

  const stockItems = stockQuery.data?.items ?? [];

  function handleVariantSelect(record: StockRecord) {
    setSelectedVariant(record);
    form.setValue('variant_id', record.variant_id, { shouldValidate: true });
    setVariantOpen(false);
    setVariantQuery('');
  }

  const destShopName = shops.find((s) => s.id === form.watch('dest_shop_id'))?.name ?? '';

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      inventoryApi.transferStock({
        source_shop_id: values.source_shop_id,
        dest_shop_id: values.dest_shop_id,
        variant_id: values.variant_id,
        quantity: values.quantity,
        note: values.note || undefined,
      }),
    onSuccess: (_, values) => {
      queryClient.invalidateQueries({ queryKey: qk.stock() });
      queryClient.invalidateQueries({ queryKey: qk.stockMovements() });
      const label = selectedVariant
        ? `${selectedVariant.product_name}${selectedVariant.variant_name ? ` ${selectedVariant.variant_name}` : ''}`
        : 'item';
      toast.success(`Transferred ${values.quantity} × ${label} → ${destShopName}`);
      handleClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        toast.error('Insufficient stock at source shop');
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Transfer failed');
      }
    },
  });

  function handleClose() {
    form.reset({
      source_shop_id: activeShopId ?? '',
      dest_shop_id: '',
      variant_id: '',
      quantity: 1,
      note: '',
    });
    setSelectedVariant(null);
    setVariantQuery('');
    onOpenChange(false);
  }

  if (shops.length < 2) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Transfer stock</DialogTitle></DialogHeader>
          <p className="text-body-sm text-[var(--text-muted)] text-center py-6">
            Inter-shop transfers require at least two shops.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Transfer stock
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">

            {/* Source shop */}
            <FormField control={form.control} name="source_shop_id" render={({ field }) => (
              <FormItem>
                <FormLabel>From shop *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select source…" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {shops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Variant picker */}
            <FormField control={form.control} name="variant_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Product / variant *</FormLabel>
                <Popover open={variantOpen} onOpenChange={(v) => { setVariantOpen(v); if (!v) setVariantQuery(''); }}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        disabled={!sourceShopId}
                        className={cn(
                          'w-full justify-between min-h-[44px] font-normal text-left',
                          !selectedVariant && 'text-[var(--text-muted)]',
                        )}
                      >
                        <span className="truncate">
                          {selectedVariant
                            ? `${selectedVariant.product_name}${selectedVariant.variant_name ? ` — ${selectedVariant.variant_name}` : ''}`
                            : 'Search product…'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <div className="p-2 border-b border-[var(--border)]">
                      <Input
                        placeholder="Search by name, SKU…"
                        value={variantQuery}
                        onChange={(e) => setVariantQuery(e.target.value)}
                        autoFocus
                        className="h-8"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {stockQuery.isLoading && (
                        <div className="flex items-center justify-center py-6 gap-2 text-[var(--text-muted)]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-body-sm">Searching…</span>
                        </div>
                      )}
                      {!stockQuery.isLoading && stockItems.length === 0 && (
                        <p className="py-6 text-center text-body-sm text-[var(--text-muted)]">
                          {debouncedVariantQuery ? 'No results.' : 'Type to search.'}
                        </p>
                      )}
                      {!stockQuery.isLoading && stockItems.map((item) => (
                        <button
                          key={item.variant_id}
                          type="button"
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[44px]',
                            'hover:bg-[var(--surface-muted)] transition-colors',
                            field.value === item.variant_id && 'bg-[var(--accent)]/10',
                          )}
                          onClick={() => handleVariantSelect(item)}
                        >
                          <Check className={cn(
                            'h-4 w-4 shrink-0 text-[var(--accent)]',
                            field.value !== item.variant_id && 'invisible',
                          )} />
                          <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-medium text-[var(--text)] truncate">
                              {item.product_name}
                              {item.variant_name && <span className="font-normal text-[var(--text-muted)]"> — {item.variant_name}</span>}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              <span className="font-mono">{item.sku}</span> · {item.quantity_in_stock} in stock
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )} />

            {/* Destination shop */}
            <FormField control={form.control} name="dest_shop_id" render={({ field }) => (
              <FormItem>
                <FormLabel>To shop *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select destination…" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {shops
                      .filter((s) => s.id !== sourceShopId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Quantity */}
            <FormField control={form.control} name="quantity" render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Preview — only when a variant is selected */}
            {selectedVariant && (
              <div className={cn(
                'rounded-lg px-3 py-2.5 space-y-1 text-body-sm',
                wouldGoNegative
                  ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
                  : 'bg-[var(--surface-2)] text-[var(--text)]',
              )}>
                <div className="flex justify-between">
                  <span>Source stock after transfer</span>
                  <span className="font-mono font-semibold">{resultingStock}</span>
                </div>
                {wouldGoNegative && (
                  <p className="text-xs">Insufficient stock — reduce quantity or choose another shop</p>
                )}
              </div>
            )}

            {/* Note */}
            <FormField control={form.control} name="note" render={({ field }) => (
              <FormItem>
                <FormLabel>Note <span className="text-[var(--text-muted)] font-normal">(optional)</span></FormLabel>
                <FormControl>
                  <Input placeholder="Restock branch, seasonal rotation, etc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={mutation.isPending || wouldGoNegative}
              >
                {mutation.isPending ? 'Transferring…' : 'Transfer'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "TransferDialog" | head -10
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/inventory/TransferDialog.tsx
git commit -m "feat(inventory): add TransferDialog component"
```

---

## Task 2: Wire TransferDialog into the inventory page

**Files:**
- Modify: `frontend/src/app/(app)/inventory/page.tsx`

Changes needed:
1. Import `TransferDialog`
2. Add `transferOpen` state
3. Add Transfer button in the header, inside `<Can permission="erp.inventory.adjust">`, disabled when offline
4. Render `<TransferDialog>` alongside `<AdjustmentDialog>`

- [ ] **Step 1: Add import + state + button + dialog**

The full updated `inventory/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Can } from '@/components/shared/Can';
import { StockTable } from '@/components/inventory/StockTable';
import { AdjustmentDialog } from '@/components/inventory/AdjustmentDialog';
import { TransferDialog } from '@/components/inventory/TransferDialog';
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
  const [transferOpen, setTransferOpen] = useState(false);

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
        <Can permission="erp.inventory.adjust">
          <Button
            size="sm"
            variant="outline"
            disabled={!isOnline}
            onClick={() => setTransferOpen(true)}
          >
            <ArrowRightLeft className="h-4 w-4 mr-1.5" />
            Transfer
          </Button>
        </Can>
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

      {/* Transfer dialog */}
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
      />
    </div>
  );
}
```

Note: `SlidersHorizontal` was imported but never rendered in the original — it has been removed in this version along with the no-longer-needed import.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "inventory" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(app)/inventory/page.tsx"
git commit -m "feat(inventory): add Transfer button + wire TransferDialog into inventory page"
```

---

## Task 3: Mark Inventory #8 DONE in ALIGNMENT_AUDIT.md

**Files:**
- Modify: `docs/ALIGNMENT_AUDIT.md`

Find the existing Inventory #8 row (currently ends with `*(SKIPPED — new feature, not hardening)*`) and replace the status cell.

- [ ] **Step 1: Update the audit row**

Find the line:
```
| 8 | **High** | B | MISSING `TransferDialog` / `inventory/page.tsx` | §6 UI §3 | The `ArrowRightLeft` icon is imported in `inventory/page.tsx` but no `TransferDialog` exists in `/components/inventory/`. The inter-shop transfer button is never rendered and there is no UI entrypoint for `POST /inventory/transfer/`. Spec UI §3 lists `TransferDialog` as a required component. | Build `TransferDialog` (source/dest shop selects, variant picker, qty + note fields); add the "Transfer" button to the inventory page header behind `Can permission="erp.inventory.adjust"`. | *(SKIPPED — new feature, not hardening)* |
```

Replace the status cell `*(SKIPPED — new feature, not hardening)*` with:

```
**DONE** — `TransferDialog.tsx` built (`components/inventory/TransferDialog.tsx`): source/dest shop selects, variant typeahead (queries `/inventory/stock/?search=`), qty + note, stock-preview card, `INSUFFICIENT_STOCK` handling. Transfer button added to inventory page header behind `Can permission="erp.inventory.adjust"`. On success invalidates `qk.stock()` + `qk.stockMovements()`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ALIGNMENT_AUDIT.md
git commit -m "docs: mark Inventory #8 TransferDialog DONE in ALIGNMENT_AUDIT"
```

---

## Task 4: Full build verification + final squash commit

- [ ] **Step 1: Run `next build`**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npm run build 2>&1 | grep -E "✓ Compiled|error TS|Module not found" | head -10
```

Expected: `✓ Compiled successfully` with no errors.

- [ ] **Step 2: Squash into final commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git log --oneline -3
# Should show: docs commit, wire commit, component commit
git reset --soft HEAD~3
git commit -m "$(cat <<'EOF'
feat(inventory): inter-shop TransferDialog

- New TransferDialog at components/inventory/TransferDialog.tsx:
  source/dest shop selects (from activeShopStore), variant typeahead
  (Popover+Input querying /inventory/stock/?search=), qty (min 1),
  optional note, stock-preview card (red if would go negative).
- Client validates qty > 0 and source ≠ dest via zod .refine.
- Handles INSUFFICIENT_STOCK 400 with specific toast.
- On success: invalidates qk.stock() + qk.stockMovements() for both shops.
- Transfer button added to inventory page header behind
  Can permission="erp.inventory.adjust"; disabled offline.
- ALIGNMENT_AUDIT Inventory #8 marked DONE.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

- [x] **Source/dest shop select** — from `useActiveShopStore().shops`, defaults to `activeShopId`. ✓ Task 1
- [x] **Variant picker reuse** — Popover+Input querying `inventoryApi.listStock`. ✓ Task 1 (inline, consistent with StaffPicker pattern)
- [x] **qty > 0** — `z.number().int().min(1)` in schema. ✓ Task 1
- [x] **source ≠ dest** — `z.refine()` on schema. ✓ Task 1
- [x] **Note field** — optional text input. ✓ Task 1
- [x] **Resulting movement shown** — preview card shows source stock after transfer. ✓ Task 1
- [x] **INSUFFICIENT_STOCK handling** — `e.code === 'INSUFFICIENT_STOCK'` branch in `onError`. ✓ Task 1
- [x] **Invalidate stock for both shops** — `qk.stock()` is the top-level key; one invalidation covers all shop-filtered entries. ✓ Task 1
- [x] **Transfer button in header behind Can** — `Can permission="erp.inventory.adjust"`. ✓ Task 2
- [x] **Offline guard** — button disabled when `!isOnline`. ✓ Task 2
- [x] **ALIGNMENT_AUDIT #8 marked DONE** — ✓ Task 3
- [x] **No placeholders** — all code is complete.
- [x] **Type consistency** — `TransferDialogProps.open/onOpenChange` ↔ how it's called in page.tsx ✓. `inventoryApi.transferStock` body fields match form field names ✓. `StockRecord.variant_id` used (not `.id`) for the transfer body ✓ (confirmed in `inventory.ts:48-49`).
- [x] **`SlidersHorizontal` cleanup** — removed unused import in page.tsx rewrite. ✓
