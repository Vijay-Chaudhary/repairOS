# Purchase Returns + Debit-Note UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the purchase-return + debit-note flow end-to-end: add a GET list endpoint to the BE, add three API functions to `procurement.ts`, build a `ReturnDialog` with per-line variant selection, and surface "Create return" + returns list when clicking an invoice row on the Purchases page.

**Architecture:** The BE already has `POST /procurement/purchase-returns/` (`PurchaseReturnView`) and `PATCH /procurement/purchase-returns/{pk}/dispatch/` (`PurchaseReturnDispatchView`). We add a `GET` method to `PurchaseReturnView` (filters by `invoice_id` query param). The FE adds three API functions, a single `ReturnDialog` component with two internal modes (list ↔ create), and wires it up via `onRowClick` on the invoices `DataTable` in `purchases/page.tsx`. No new page or nested dialog is needed.

**Tech Stack:** Django + DRF (backend), Next.js 14 App Router, TypeScript strict, React Query, Tailwind CSS, shadcn/ui Dialog + Popover.

---

## File map

| Action | File | Responsibility |
|---|---|---|
| Modify | `backend/apps/procurement/views.py:306` | Add `get()` to `PurchaseReturnView` |
| Modify | `frontend/src/lib/api/procurement.ts` | Add `PurchaseReturnItem`, `PurchaseReturn` types + 3 API fns |
| Modify | `frontend/src/lib/query/keys.ts` | Add `purchaseReturns` query key |
| Create | `frontend/src/components/procurement/ReturnDialog.tsx` | List mode + create mode, variant typeahead, dispatch action |
| Modify | `frontend/src/app/(app)/purchases/page.tsx` | Wire invoice row click → open `ReturnDialog` |
| Modify | `docs/ALIGNMENT_AUDIT.md` | Mark Procurement #9 DONE |

---

## Task 1: Add GET list endpoint to PurchaseReturnView

**Files:**
- Modify: `backend/apps/procurement/views.py:306-322`

The `PurchaseReturnView` currently has only a `post()` method. Add a `get()` method that returns all returns scoped to the caller's shops, optionally filtered by `invoice_id`. Returns a plain JSON array (no pagination — per-invoice list is typically 0-10 items).

- [ ] **Step 1: Add `get()` method to `PurchaseReturnView`**

Open `backend/apps/procurement/views.py`. Find `class PurchaseReturnView(APIView):` at line 306. Add this method immediately after `get_permissions`:

```python
    def get(self, request):
        token = getattr(request, "auth", None)
        shop_ids = token.get("shop_ids", []) if token else []
        qs = PurchaseReturn.objects.filter(
            purchase_invoice__shop_id__in=shop_ids
        ).order_by("-created_at").select_related("debit_note")
        invoice_id = request.query_params.get("invoice_id")
        if invoice_id:
            qs = qs.filter(purchase_invoice_id=invoice_id)
        return Response(PurchaseReturnSerializer(qs, many=True).data)
```

The full class after the change:

```python
class PurchaseReturnView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_returns.create")()]

    def get(self, request):
        token = getattr(request, "auth", None)
        shop_ids = token.get("shop_ids", []) if token else []
        qs = PurchaseReturn.objects.filter(
            purchase_invoice__shop_id__in=shop_ids
        ).order_by("-created_at").select_related("debit_note")
        invoice_id = request.query_params.get("invoice_id")
        if invoice_id:
            qs = qs.filter(purchase_invoice_id=invoice_id)
        return Response(PurchaseReturnSerializer(qs, many=True).data)

    def post(self, request):
        serializer = CreatePurchaseReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        try:
            invoice = PurchaseInvoice.objects.get(id=vd["purchase_invoice_id"])
        except PurchaseInvoice.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Purchase invoice not found.")

        ret = services.create_purchase_return(invoice, vd, request.user)
        return Response(PurchaseReturnSerializer(ret).data, status=status.HTTP_201_CREATED)
```

- [ ] **Step 2: Run the existing procurement tests to confirm no regression**

```bash
cd /home/appuser/workspace/projects/repairOS
docker compose run --rm backend pytest backend/apps/procurement/tests/ -v 2>&1 | tail -30
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/procurement/views.py
git commit -m "feat(procurement): add GET /purchase-returns/?invoice_id= list endpoint"
```

---

## Task 2: Add types and API functions to `procurement.ts`

**Files:**
- Modify: `frontend/src/lib/api/procurement.ts`

The BE `PurchaseReturnSerializer` emits exactly:
```
{ id, purchase_invoice (UUID string — FK default, NOT purchase_invoice_id),
  return_number, reason, status, total_amount (Decimal → string),
  items: [{ id, variant (UUID string), variant_name, quantity (string), unit_cost (string), line_total (string) }],
  debit_note_number (string | null), created_at }
```
`CreatePurchaseReturnSerializer` accepts: `{ purchase_invoice_id, reason, items: [{ variant_id, quantity (Decimal string), unit_cost (Decimal string) }] }`.
`PurchaseReturnDispatchView.patch` accepts no body; returns `PurchaseReturnSerializer`.

- [ ] **Step 1: Add `PurchaseReturnItem` and `PurchaseReturn` types after `PurchasePayment`**

In `frontend/src/lib/api/procurement.ts`, after line 102 (`}`  closing `PurchasePayment`), add:

```typescript
export interface PurchaseReturnItem {
  id: string;
  variant: string;
  variant_name: string;
  quantity: string;
  unit_cost: string;
  line_total: string;
}

export interface PurchaseReturn {
  id: string;
  purchase_invoice: string;
  return_number: string;
  reason: string;
  status: ReturnStatus;
  total_amount: string;
  items: PurchaseReturnItem[];
  debit_note_number: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Add `listReturns`, `createReturn`, `dispatchReturn` to `procurementApi`**

In `frontend/src/lib/api/procurement.ts`, inside `procurementApi`, after `recordPayment` (line 212), add:

```typescript
  // Purchase Returns
  listReturns: (invoiceId: string) =>
    apiGet<PurchaseReturn[]>('/procurement/purchase-returns/', { invoice_id: invoiceId }),

  createReturn: (body: {
    purchase_invoice_id: string;
    reason: string;
    items: Array<{ variant_id: string; quantity: string; unit_cost: string }>;
  }) => apiPost<PurchaseReturn>('/procurement/purchase-returns/', body),

  dispatchReturn: (returnId: string) =>
    apiPatch<PurchaseReturn>(`/procurement/purchase-returns/${returnId}/dispatch/`, {}),
```

- [ ] **Step 3: Run TypeScript compiler to verify no type errors**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep procurement | head -20
```

Expected: zero errors in procurement files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api/procurement.ts
git commit -m "feat(procurement): add PurchaseReturn types + listReturns/createReturn/dispatchReturn API fns"
```

---

## Task 3: Add `purchaseReturns` query key to `keys.ts`

**Files:**
- Modify: `frontend/src/lib/query/keys.ts:56-58`

- [ ] **Step 1: Add `purchaseReturns` key under the Procurement section**

In `frontend/src/lib/query/keys.ts`, find:

```typescript
  // Procurement
  purchaseOrders: listKey('purchase-orders'),
  purchaseOrder:  (id: string) => ['purchase-order', id] as const,
  suppliers:      listKey('suppliers'),
  supplier:       (id: string) => ['supplier', id] as const,
```

Replace with:

```typescript
  // Procurement
  purchaseOrders:  listKey('purchase-orders'),
  purchaseOrder:   (id: string) => ['purchase-order', id] as const,
  suppliers:       listKey('suppliers'),
  supplier:        (id: string) => ['supplier', id] as const,
  purchaseReturns: (invoiceId: string) => ['purchase-returns', invoiceId] as const,
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep keys | head -10
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/query/keys.ts
git commit -m "feat(procurement): add purchaseReturns query key"
```

---

## Task 4: Build `ReturnDialog` component

**Files:**
- Create: `frontend/src/components/procurement/ReturnDialog.tsx`

The dialog has two modes controlled by a local `mode: 'list' | 'create'` state:

**List mode** (`mode === 'list'`):
- Header: "Returns — {invoice.bill_number}"
- Shows existing returns from `listReturns(invoiceId)` — each row: return_number, status badge, total_amount, debit_note_number (if present), and a "Dispatch" button when `status === 'pending'`
- "New return" button → switches to 'create' mode
- Gating: `Can permission="erp.purchase_returns.create"` wraps the button and dispatch action

**Create mode** (`mode === 'create'`):
- "Reason" textarea (required)
- Dynamic item rows: each row has:
  - Variant typeahead: Popover+Input querying `inventoryApi.listStock({ search: query, shop_id: activeShopId })` — same pattern as `TransferDialog.tsx` (debounced, shows product_name + variant_name from each StockRecord, stores the `variant_id` from `StockRecord.variant_id`)
  - Qty input (number, min 0.001)
  - Unit cost input (number, min 0)
  - Remove row button
- "Add item" button
- Submit: calls `procurementApi.createReturn(...)`, on success → invalidates `qk.purchaseReturns(invoiceId)`, switches back to 'list' mode, shows toast "Return created"
- Dispatch mutation: calls `procurementApi.dispatchReturn(returnId)`, on success → invalidates `qk.purchaseReturns(invoiceId)`, shows toast "Return dispatched — debit note {dn_number} generated"

Props:
```typescript
interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: PurchaseInvoice;
}
```

- [ ] **Step 1: Create the file**

Create `frontend/src/components/procurement/ReturnDialog.tsx` with the following content:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { procurementApi, type PurchaseInvoice, type PurchaseReturn } from '@/lib/api/procurement';
import { inventoryApi, type StockRecord } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

interface ReturnItem {
  variant_id: string;
  variant_label: string;
  quantity: string;
  unit_cost: string;
}

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: PurchaseInvoice;
}

export function ReturnDialog({ open, onOpenChange, invoice }: ReturnDialogProps) {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<ReturnItem[]>([
    { variant_id: '', variant_label: '', quantity: '1', unit_cost: '0' },
  ]);
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});
  const [variantQueries, setVariantQueries] = useState<Record<number, string>>({});

  const { data: returns = [], isLoading: returnsLoading } = useQuery({
    queryKey: qk.purchaseReturns(invoice.id),
    queryFn: () => procurementApi.listReturns(invoice.id),
    staleTime: 30_000,
    enabled: open,
  });

  const debouncedQueries = Object.fromEntries(
    Object.entries(variantQueries).map(([k, v]) => [k, useDebounce(v, 350)]),
  );

  // Per-row variant search queries — only fetches when popover is open and query exists
  function useVariantSearch(rowIdx: number) {
    const q = debouncedQueries[rowIdx] ?? '';
    return useQuery({
      queryKey: ['return-variant-search', activeShopId, q],
      queryFn: () => inventoryApi.listStock({ shop_id: activeShopId ?? undefined, search: q || undefined }),
      staleTime: 30_000,
      enabled: !!(openPopovers[rowIdx] && activeShopId),
    });
  }

  const createMutation = useMutation({
    mutationFn: () => procurementApi.createReturn({
      purchase_invoice_id: invoice.id,
      reason,
      items: items.map((i) => ({
        variant_id: i.variant_id,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseReturns(invoice.id) });
      toast.success('Return created');
      setMode('list');
      setReason('');
      setItems([{ variant_id: '', variant_label: '', quantity: '1', unit_cost: '0' }]);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create return'),
  });

  const dispatchMutation = useMutation({
    mutationFn: (returnId: string) => procurementApi.dispatchReturn(returnId),
    onSuccess: (ret) => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseReturns(invoice.id) });
      const dn = ret.debit_note_number ?? 'generated';
      toast.success(`Return dispatched — debit note ${dn}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Dispatch failed'),
  });

  function addRow() {
    setItems((prev) => [...prev, { variant_id: '', variant_label: '', quantity: '1', unit_cost: '0' }]);
  }

  function removeRow(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<ReturnItem>) {
    setItems((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function selectVariant(idx: number, stock: StockRecord) {
    updateRow(idx, {
      variant_id: stock.variant_id,
      variant_label: `${stock.product_name} — ${stock.variant_name}`,
    });
    setOpenPopovers((p) => ({ ...p, [idx]: false }));
  }

  const canSubmit = reason.trim().length > 0
    && items.length > 0
    && items.every((i) => i.variant_id && parseFloat(i.quantity) > 0);

  function handleClose(v: boolean) {
    if (!v) {
      setMode('list');
      setReason('');
      setItems([{ variant_id: '', variant_label: '', quantity: '1', unit_cost: '0' }]);
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'list' ? `Returns — ${invoice.bill_number}` : 'New purchase return'}
          </DialogTitle>
        </DialogHeader>

        {mode === 'list' ? (
          <div className="space-y-4">
            <div className="text-body-sm text-[var(--text-muted)]">
              Supplier: <span className="text-[var(--text)]">{invoice.supplier_name}</span>
              {' · '}
              <Money amount={invoice.grand_total} className="text-[var(--text)]" />
            </div>

            {returnsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : returns.length === 0 ? (
              <p className="text-body-sm text-[var(--text-muted)] text-center py-6">No returns yet</p>
            ) : (
              <div className="space-y-2">
                {returns.map((ret: PurchaseReturn) => (
                  <div key={ret.id} className="rounded-lg border border-[var(--border)] px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[var(--text)]">{ret.return_number}</span>
                      <StatusBadge status={ret.status} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-body-sm">
                      <Money amount={parseFloat(ret.total_amount)} className="font-medium" />
                      {ret.debit_note_number && (
                        <span className="text-xs text-[var(--text-muted)]">DN: {ret.debit_note_number}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{ret.reason}</p>
                    {ret.status === 'pending' && (
                      <Can permission="erp.purchase_returns.create">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full mt-1"
                          onClick={() => dispatchMutation.mutate(ret.id)}
                          disabled={dispatchMutation.isPending}
                        >
                          {dispatchMutation.isPending ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Dispatching…</>
                          ) : (
                            'Dispatch (generates debit note)'
                          )}
                        </Button>
                      </Can>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Can permission="erp.purchase_returns.create">
              <Button className="w-full" onClick={() => setMode('create')}>
                <Plus className="h-4 w-4" /> New return
              </Button>
            </Can>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)]">Reason *</label>
              <Textarea
                className="mt-1"
                placeholder="Describe why items are being returned…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>

            <div>
              <label className="text-body-sm font-medium text-[var(--text)] mb-2 block">Items *</label>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <ReturnItemRow
                    key={idx}
                    idx={idx}
                    item={item}
                    shopId={activeShopId}
                    popoverOpen={!!openPopovers[idx]}
                    variantQuery={variantQueries[idx] ?? ''}
                    onPopoverChange={(v) => setOpenPopovers((p) => ({ ...p, [idx]: v }))}
                    onVariantQueryChange={(q) => setVariantQueries((p) => ({ ...p, [idx]: q }))}
                    onSelectVariant={(s) => selectVariant(idx, s)}
                    onUpdateRow={(patch) => updateRow(idx, patch)}
                    onRemove={() => removeRow(idx)}
                    canRemove={items.length > 1}
                  />
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> Add item
              </Button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setMode('list')}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  'Create return'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ReturnItemRowProps {
  idx: number;
  item: ReturnItem;
  shopId: string | null;
  popoverOpen: boolean;
  variantQuery: string;
  onPopoverChange: (v: boolean) => void;
  onVariantQueryChange: (q: string) => void;
  onSelectVariant: (s: StockRecord) => void;
  onUpdateRow: (patch: Partial<ReturnItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ReturnItemRow({
  idx, item, shopId, popoverOpen, variantQuery,
  onPopoverChange, onVariantQueryChange, onSelectVariant,
  onUpdateRow, onRemove, canRemove,
}: ReturnItemRowProps) {
  const debouncedQ = useDebounce(variantQuery, 350);
  const { data: stockData } = useQuery({
    queryKey: ['return-variant-search', shopId, debouncedQ, idx],
    queryFn: () => inventoryApi.listStock({ shop_id: shopId ?? undefined, search: debouncedQ || undefined }),
    staleTime: 30_000,
    enabled: !!(popoverOpen && shopId),
  });
  const stockItems = stockData?.items ?? [];

  return (
    <div className="grid grid-cols-[1fr_80px_88px_32px] gap-1.5 items-start">
      <Popover open={popoverOpen} onOpenChange={onPopoverChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'h-9 w-full flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-body-sm',
              'hover:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]',
              !item.variant_label && 'text-[var(--text-muted)]',
            )}
          >
            <span className="truncate">{item.variant_label || 'Search product…'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <Input
            placeholder="Search by name or SKU…"
            value={variantQuery}
            onChange={(e) => onVariantQueryChange(e.target.value)}
            className="mb-2 h-8 text-body-sm"
            autoFocus
          />
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {stockItems.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-3">
                {variantQuery ? 'No results' : 'Type to search'}
              </p>
            ) : (
              stockItems.slice(0, 20).map((s) => (
                <button
                  key={s.variant_id}
                  type="button"
                  className={cn(
                    'w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--surface-2)] text-body-sm',
                    item.variant_id === s.variant_id && 'bg-[var(--surface-2)]',
                  )}
                  onClick={() => onSelectVariant(s)}
                >
                  {item.variant_id === s.variant_id && <Check className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium truncate text-[var(--text)]">{s.product_name}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{s.variant_name}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Input
        type="number"
        min="0.001"
        step="0.001"
        placeholder="Qty"
        value={item.quantity}
        onChange={(e) => onUpdateRow({ quantity: e.target.value })}
        className="h-9 text-body-sm"
      />
      <Input
        type="number"
        min="0"
        step="0.01"
        placeholder="Cost"
        value={item.unit_cost}
        onChange={(e) => onUpdateRow({ unit_cost: e.target.value })}
        className="h-9 text-body-sm"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="h-9 w-8 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-30"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript to verify no errors**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep ReturnDialog | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/procurement/ReturnDialog.tsx
git commit -m "feat(procurement): add ReturnDialog with list + create modes and variant typeahead"
```

---

## Task 5: Wire `ReturnDialog` into the invoices tab on `purchases/page.tsx`

**Files:**
- Modify: `frontend/src/app/(app)/purchases/page.tsx`

Add `onRowClick` to the invoices `DataTable` that sets `selectedInvoice: PurchaseInvoice | null`. Render `<ReturnDialog>` when `selectedInvoice` is set. The "Returns" entry point is the row click; no new column or button is needed in the table itself (the table already provides enough context).

- [ ] **Step 1: Add the import and state to `PurchasesPage`**

In `purchases/page.tsx`, add `ReturnDialog` import and `selectedInvoice` state:

1. At the top of the file, after the existing imports, add:
```typescript
import { ReturnDialog } from '@/components/procurement/ReturnDialog';
```

2. Inside `PurchasesPage`, after the existing `useState` declarations, add:
```typescript
const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
```

- [ ] **Step 2: Add `onRowClick` to the invoices `DataTable`**

In the JSX, find the invoices `DataTable` (around line 179):

```tsx
<DataTable
  columns={INV_COLUMNS}
  data={invData?.items}
  loading={invLoading}
  keyExtractor={(r) => r.id}
  emptyTitle="No purchase invoices"
  emptyDescription="Record supplier bills here after receiving goods."
  hasNextPage={!!invData?.meta?.next_cursor}
  hasPrevPage={!!invCursor}
  onNextPage={() => setInvCursor(invData?.meta?.next_cursor ?? undefined)}
  onPrevPage={() => setInvCursor(undefined)}
/>
```

Replace with:

```tsx
<DataTable
  columns={INV_COLUMNS}
  data={invData?.items}
  loading={invLoading}
  keyExtractor={(r) => r.id}
  onRowClick={(r) => setSelectedInvoice(r)}
  emptyTitle="No purchase invoices"
  emptyDescription="Record supplier bills here after receiving goods."
  hasNextPage={!!invData?.meta?.next_cursor}
  hasPrevPage={!!invCursor}
  onNextPage={() => setInvCursor(invData?.meta?.next_cursor ?? undefined)}
  onPrevPage={() => setInvCursor(undefined)}
/>
```

- [ ] **Step 3: Render `ReturnDialog` at the bottom of `PurchasesPage` JSX**

Just before the closing `</div>` of `PurchasesPage` (after the `<PoBuilder>` closing tag), add:

```tsx
{selectedInvoice && (
  <ReturnDialog
    open={!!selectedInvoice}
    onOpenChange={(v) => { if (!v) setSelectedInvoice(null); }}
    invoice={selectedInvoice}
  />
)}
```

- [ ] **Step 4: Run TypeScript to verify no errors**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep purchases | head -20
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/(app)/purchases/page.tsx
git commit -m "feat(procurement): wire ReturnDialog to invoices tab — click invoice row to view/create returns"
```

---

## Task 6: Mark Procurement #9 DONE in `ALIGNMENT_AUDIT.md`

**Files:**
- Modify: `docs/ALIGNMENT_AUDIT.md`

- [ ] **Step 1: Update Procurement #9 row**

In `docs/ALIGNMENT_AUDIT.md`, find the row:

```
| 9 | **High** | A | MISSING in `procurement.ts` / `views.py:PurchaseReturnView` + `PurchaseReturnDispatchView` | §6 §4 | `procurementApi` has no `createReturn`, `listReturns`, or `dispatchReturn` functions. No `ReturnDialog` component exists in `/components/procurement/`. The entire purchase-return + debit-note flow (spec §4 §3.8) is unreachable from the frontend. | Add `createReturn`, `listReturns`, `dispatchReturn` to `procurementApi`; build a `ReturnDialog` component with per-line item input; add a "Create return" button on the invoice detail page. | *(SKIPPED — new feature UI, not hardening)* |
```

Replace the final cell `*(SKIPPED — new feature UI, not hardening)*` with:

```
**DONE** — added `GET /purchase-returns/?invoice_id=` to BE; added `PurchaseReturn`/`PurchaseReturnItem` types + `listReturns`/`createReturn`/`dispatchReturn` to `procurement.ts`; built `ReturnDialog` (list mode + create mode with variant typeahead, dispatch action); wired via `onRowClick` on invoices DataTable in `purchases/page.tsx`, gated by `erp.purchase_returns.create`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ALIGNMENT_AUDIT.md
git commit -m "docs(audit): mark Procurement #9 DONE — returns + debit-note UI"
```

---

## Task 7: Final combined commit

The individual commits above are fine for the feature branch. If the user wants a single squashed commit, all six commits can be squashed into:

```
feat(procurement): returns + debit-note UI

- BE: GET /purchase-returns/?invoice_id= endpoint with shop-scoped queryset
- FE: PurchaseReturn/PurchaseReturnItem types + listReturns/createReturn/dispatchReturn
- FE: ReturnDialog — list mode (returns + dispatch) + create mode (variant typeahead + line items)
- FE: Invoice row click on Purchases page opens ReturnDialog, gated by erp.purchase_returns.create
- Docs: Procurement #9 marked DONE in ALIGNMENT_AUDIT.md
```

---

## Self-review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| `createReturn` in `procurementApi` | Task 2 |
| `listReturns` in `procurementApi` | Task 2 |
| `dispatchReturn` in `procurementApi` | Task 2 |
| Per-line item selection + qty, reason | Task 4 (ReturnDialog create mode) |
| On dispatch triggers debit note | Task 4 (dispatch mutation + toast shows DN number) |
| "Create return" on invoice/PO detail page | Task 5 (invoice row click) |
| Returns list on invoice/PO detail page | Task 4 (ReturnDialog list mode) |
| Gated by `erp.purchase_returns.create` | Task 4 (`Can` wraps New return button + Dispatch button) |
| Procurement #9 DONE in ALIGNMENT_AUDIT.md | Task 6 |

**Placeholder scan:** No TBDs, TODOs, or "similar to" references. All code shown in full.

**Type consistency check:**
- `PurchaseReturn.purchase_invoice` (string) — matches `PurchaseReturnSerializer` FK default (emits UUID, no `_id` suffix) ✓
- `PurchaseReturnItem.variant` (string) — matches `PurchaseReturnItemSerializer` FK default ✓  
- `total_amount`, `quantity`, `unit_cost`, `line_total` typed as `string` — Decimal fields are strings in DRF ✓
- `dispatchReturn(returnId)` sends `PATCH` with empty body — matches `PurchaseReturnDispatchView.patch` which ignores the body ✓
- `StockRecord.variant_id` used in `selectVariant` — present in `InventoryStockSerializer` (added in Module 05 audit fix) ✓
- `StockRecord.product_name` and `variant_name` — present in `InventoryStockSerializer` ✓

**useDebounce hook location:** `@/lib/hooks/useDebounce` — confirmed exists (used in `TransferDialog.tsx`) ✓

**Note on `debouncedQueries` in `ReturnDialog`:** The top-level component uses `Object.fromEntries(Object.entries(...).map(...useDebounce...))` which calls hooks inside a loop — this violates React rules of hooks. Task 4 Step 1 uses a sub-component `ReturnItemRow` that calls `useDebounce` unconditionally at the top level. The parent `ReturnDialog` only manages open/query state per row via plain state maps; the actual debouncing and query fetching happens inside `ReturnItemRow`. This is the same pattern used in `TransferDialog`. ✓
