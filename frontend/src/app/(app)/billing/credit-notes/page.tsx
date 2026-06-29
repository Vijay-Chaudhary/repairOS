'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import { billingApi, type CreditNote } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

const schema = z.object({
  invoice_id: z.string().min(1, 'Invoice required'),
  amount: z.number().min(0.01, 'Amount required'),
  reason: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function CreditNotesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.creditNotes(),
    queryFn: () => billingApi.listCreditNotes(),
    staleTime: 30_000,
  });
  const outstandingQuery = useQuery({
    queryKey: qk.outstanding(),
    queryFn: () => billingApi.getOutstanding(),
    staleTime: 60_000,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { invoice_id: '', amount: 0, reason: '' },
  });

  const createMutation = useMutation({
    mutationFn: (v: FormValues) => billingApi.createCreditNote(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.creditNotes() });
      setOpen(false);
      form.reset();
      toast.success('Credit note created');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create credit note'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => billingApi.approveCreditNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.creditNotes() });
      queryClient.invalidateQueries({ queryKey: qk.outstanding() });
      toast.success('Credit note approved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Approval failed'),
  });

  const rows: CreditNote[] = data ?? [];
  const invoices = outstandingQuery.data?.results ?? [];

  return (
    <Can permission="billing.credit_notes.view">
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1 text-[var(--text)]">Credit Notes</h1>
            <p className="text-body-sm text-[var(--text-muted)] mt-1">Credits against outstanding invoices.</p>
          </div>
          <Can permission="billing.credit_notes.create">
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New credit note</Button>
          </Can>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState title="No credit notes" description="Create a credit note against an invoice." />
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Number</th>
                  <th className="text-left px-4 py-2 font-medium">Invoice</th>
                  <th className="text-left px-4 py-2 font-medium">Customer</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.id} className="bg-[var(--surface)]">
                    <td className="px-4 py-2 font-medium text-[var(--text)]">{r.credit_note_number}</td>
                    <td className="px-4 py-2">{r.invoice_number}</td>
                    <td className="px-4 py-2">{r.customer_name}</td>
                    <td className="px-4 py-2 text-right">{inr(r.amount)}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      {r.status === 'pending' && (
                        <Can permission="billing.credit_notes.approve">
                          <Button size="sm" variant="outline" disabled={approveMutation.isPending}
                            onClick={() => approveMutation.mutate(r.id)}>Approve</Button>
                        </Can>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New credit note</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="invoice_id" render={({ field }) => (
                  <FormItem><FormLabel>Invoice (with balance)</FormLabel><FormControl>
                    <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                      <option value="">Select invoice…</option>
                      {invoices.map((i) => (
                        <option key={i.id} value={i.id}>{i.invoice_number} — {i.customer_name} ({inr(i.amount_outstanding)})</option>
                      ))}
                    </select>
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem><FormLabel>Amount (₹)</FormLabel><FormControl>
                    <Input type="number" step="0.01" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="reason" render={({ field }) => (
                  <FormItem><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>Create</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </Can>
  );
}
