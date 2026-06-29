'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import { ReturnDialog } from '@/components/procurement/ReturnDialog';
import { procurementApi, type PurchaseInvoice } from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { formatDate } from '@/lib/format/date';

const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

export default function PurchaseReturnsPage() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.allPurchaseReturns(),
    queryFn: () => procurementApi.listAllReturns(),
    staleTime: 30_000,
  });
  const invoicesQuery = useQuery({
    queryKey: ['procurement', 'invoices', 'for-return'],
    queryFn: () => procurementApi.listInvoices(),
    staleTime: 60_000,
    enabled: pickerOpen,
  });

  const rows = data ?? [];
  const invoices = invoicesQuery.data?.items ?? [];

  return (
    <Can permission="erp.purchase_returns.view">
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1 text-[var(--text)]">Purchase Returns</h1>
            <p className="text-body-sm text-[var(--text-muted)] mt-1">Goods returned to suppliers.</p>
          </div>
          <Can permission="erp.purchase_returns.create">
            <Button onClick={() => setPickerOpen(true)}><Plus className="h-4 w-4 mr-1" /> New return</Button>
          </Can>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState title="No purchase returns" description="Returns raised against supplier invoices appear here." />
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Return</th>
                  <th className="text-right px-4 py-2 font-medium">Total</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Debit note</th>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.id} className="bg-[var(--surface)]">
                    <td className="px-4 py-2 font-medium text-[var(--text)]">{r.return_number}</td>
                    <td className="px-4 py-2 text-right">{inr(r.total_amount)}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{r.debit_note_number ?? '—'}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Step 1: pick a purchase invoice */}
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Select a purchase invoice</DialogTitle></DialogHeader>
            <div className="max-h-80 overflow-auto divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {invoices.length === 0 ? (
                <p className="p-4 text-body-sm text-[var(--text-muted)]">No purchase invoices found.</p>
              ) : invoices.map((inv) => (
                <button
                  key={inv.id}
                  className="w-full text-left px-3 py-2 bg-[var(--surface)] hover:bg-[var(--surface-2)]"
                  onClick={() => { setSelectedInvoice(inv); setPickerOpen(false); }}
                >
                  <span className="block text-body-sm font-medium text-[var(--text)]">{inv.bill_number}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{inv.supplier_name} · {inr(String(inv.grand_total))}</span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Step 2: the existing return dialog for the chosen invoice */}
        {selectedInvoice && (
          <ReturnDialog
            open={!!selectedInvoice}
            onOpenChange={(v) => { if (!v) setSelectedInvoice(null); }}
            invoice={selectedInvoice}
          />
        )}
      </div>
    </Can>
  );
}
