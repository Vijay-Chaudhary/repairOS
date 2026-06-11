'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { PoBuilder } from '@/components/procurement/PoBuilder';
import { ReturnDialog } from '@/components/procurement/ReturnDialog';
import {
  procurementApi, PO_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  type PurchaseOrder, type PurchaseInvoice, type PoStatus, type PurchasePaymentStatus,
} from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { formatDate } from '@/lib/format/date';

const PO_COLUMNS: Column<PurchaseOrder>[] = [
  {
    key: 'po',
    header: 'PO #',
    cell: (r) => (
      <div>
        <p className="font-mono text-xs font-medium text-[var(--text)]">{r.po_number}</p>
        <p className="text-xs text-[var(--text-muted)]">{r.supplier_name}</p>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'delivery',
    header: 'Expected',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.expected_delivery_date ? formatDate(r.expected_delivery_date) : '—'}</span>,
  },
  {
    key: 'total',
    header: 'Value',
    cell: (r) => r.grand_total != null ? <Money amount={r.grand_total} className="text-body-sm tabular-nums" /> : <span className="text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'date',
    header: 'Created',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.created_at)}</span>,
  },
];

const INV_COLUMNS: Column<PurchaseInvoice>[] = [
  {
    key: 'bill',
    header: 'Bill #',
    cell: (r) => (
      <div>
        <p className="font-mono text-xs font-medium text-[var(--text)]">{r.bill_number}</p>
        <p className="text-xs text-[var(--text-muted)]">{r.supplier_name}</p>
      </div>
    ),
  },
  {
    key: 'status',
    header: 'Payment',
    cell: (r) => (
      <span className="text-xs font-medium text-[var(--text-muted)]">{PAYMENT_STATUS_LABELS[r.payment_status]}</span>
    ),
  },
  { key: 'total', header: 'Total', cell: (r) => <Money amount={r.grand_total} className="text-body-sm tabular-nums" /> },
  {
    key: 'outstanding',
    header: 'Outstanding',
    cell: (r) => r.amount_outstanding > 0
      ? <Money amount={r.amount_outstanding} className="text-body-sm text-[var(--danger)] tabular-nums" />
      : <span className="text-[var(--success)] text-body-sm">Paid</span>,
  },
  {
    key: 'due',
    header: 'Due date',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.due_date ? formatDate(r.due_date) : '—'}</span>,
  },
];

export default function PurchasesPage() {
  const router = useRouter();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [poStatus, setPoStatus] = useState<PoStatus | 'all'>('all');
  const [poBuilderOpen, setPoBuilderOpen] = useState(false);
  const [poCursor, setPoCursor] = useState<string | undefined>(undefined);
  const [invCursor, setInvCursor] = useState<string | undefined>(undefined);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);

  const poFilters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    status: poStatus === 'all' ? undefined : poStatus,
    cursor: poCursor,
  };

  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: qk.purchaseOrders(poFilters),
    queryFn: () => procurementApi.listPOs(poFilters),
    staleTime: 30_000,
  });

  const invFilters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    cursor: invCursor,
  };

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['purchase-invoices', invFilters],
    queryFn: () => procurementApi.listInvoices(invFilters),
    staleTime: 30_000,
  });

  const { data: suppliersData } = useQuery({
    queryKey: qk.suppliers(),
    queryFn: () => procurementApi.listSuppliers(),
    staleTime: 300_000,
  });
  const suppliers = suppliersData?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Purchases</h1>
        <Can permission="erp.purchase_orders.create">
          <Button size="sm" onClick={() => setPoBuilderOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New PO</span>
          </Button>
        </Can>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="orders" className="h-full flex flex-col">
          <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4">
            <TabsList className="h-10 bg-transparent gap-0 -mb-px">
              <TabsTrigger value="orders" className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-4 py-2 text-body-sm">
                Orders
              </TabsTrigger>
              <TabsTrigger value="invoices" className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-4 py-2 text-body-sm">
                Invoices
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="orders" className="flex-1 overflow-auto p-4 md:p-6 mt-0 space-y-4">
            <div className="flex gap-3">
              <Select value={poStatus} onValueChange={(v) => setPoStatus(v as PoStatus | 'all')}>
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(Object.keys(PO_STATUS_LABELS) as PoStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{PO_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DataTable
              columns={PO_COLUMNS}
              data={poData?.items}
              loading={poLoading}
              keyExtractor={(r) => r.id}
              onRowClick={(r) => router.push(`/purchases/${r.id}`)}
              emptyTitle="No purchase orders"
              emptyDescription="Create your first PO to order from a supplier."
              emptyAction={{ label: 'New PO', onClick: () => setPoBuilderOpen(true) }}
              hasNextPage={!!poData?.meta?.next_cursor}
              hasPrevPage={!!poCursor}
              onNextPage={() => setPoCursor(poData?.meta?.next_cursor ?? undefined)}
              onPrevPage={() => setPoCursor(undefined)}
            />
          </TabsContent>

          <TabsContent value="invoices" className="flex-1 overflow-auto p-4 md:p-6 mt-0">
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
          </TabsContent>
        </Tabs>
      </div>

      <PoBuilder
        open={poBuilderOpen}
        onOpenChange={setPoBuilderOpen}
        suppliers={suppliers}
        onSuccess={() => {}}
      />

      {selectedInvoice && (
        <ReturnDialog
          open={!!selectedInvoice}
          onOpenChange={(v) => { if (!v) setSelectedInvoice(null); }}
          invoice={selectedInvoice}
        />
      )}
    </div>
  );
}
