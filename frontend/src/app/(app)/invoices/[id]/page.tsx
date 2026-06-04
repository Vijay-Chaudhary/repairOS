'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Download, MessageSquare, CreditCard,
  FileText, ExternalLink,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { GstBreakdown } from '@/components/shared/GstBreakdown';
import { Can } from '@/components/shared/Can';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { InvoiceLineItems } from '@/components/billing/InvoiceLineItems';
import { PaymentHistory } from '@/components/billing/PaymentHistory';
import { AddPaymentDialog } from '@/components/billing/AddPaymentDialog';
import { billingApi } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { cn } from '@/lib/utils';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [whatsappConfirmOpen, setWhatsappConfirmOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: qk.invoice(id),
    queryFn: () => billingApi.getInvoice(id),
    staleTime: 30_000,
  });

  const whatsappMutation = useMutation({
    mutationFn: () => billingApi.sendWhatsapp(id),
    onSuccess: () => {
      toast.success('Invoice sent via WhatsApp');
      setWhatsappConfirmOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Send failed'),
  });

  async function handleDownloadPdf() {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const { pdf_url } = await billingApi.getPdfUrl(id);
      window.open(pdf_url, '_blank', 'noreferrer');
    } catch {
      toast.error('Could not fetch PDF — please try again');
    } finally {
      setPdfLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <EmptyState
        icon={FileText}
        title="Invoice not found"
        description="This invoice doesn't exist or you don't have access."
        action={{ label: 'Back to invoices', onClick: () => router.push('/invoices') }}
      />
    );
  }

  // Payment progress
  const paidPct = invoice.grand_total > 0
    ? Math.min(100, (invoice.amount_paid / invoice.grand_total) * 100)
    : 0;

  // Effective GST rate for display
  const totalGst = invoice.cgst + invoice.sgst + invoice.igst;
  const effectiveRate = invoice.subtotal > 0
    ? Math.round((totalGst / invoice.subtotal) * 100)
    : 18;
  const isInterState = invoice.igst > 0;

  const canAddPayment = invoice.amount_outstanding > 0 && invoice.status !== 'cancelled';
  const payments = invoice.payments ?? [];
  const items = invoice.items ?? [];

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="font-mono text-code text-[var(--text-muted)]">{invoice.invoice_number}</span>
          <StatusBadge status={invoice.status} />
        </div>

        <h1 className="text-h1 text-[var(--text)] leading-tight">{invoice.customer_name}</h1>
        {invoice.customer_phone && (
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">{formatPhone(invoice.customer_phone)}</p>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-md bg-[var(--surface-2)] px-3 py-2">
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Total</p>
            <Money amount={invoice.grand_total} className="text-body font-semibold" />
          </div>
          <div className="rounded-md bg-[var(--success)]/10 px-3 py-2">
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Paid</p>
            <Money amount={invoice.amount_paid} className="text-body font-semibold text-[var(--success)]" />
          </div>
          <div className={cn(
            'rounded-md px-3 py-2',
            invoice.amount_outstanding > 0 ? 'bg-[var(--danger)]/10' : 'bg-[var(--surface-2)]',
          )}>
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Outstanding</p>
            <Money
              amount={invoice.amount_outstanding}
              className={cn('text-body font-semibold', invoice.amount_outstanding > 0 ? 'text-[var(--danger)]' : '')}
            />
          </div>
        </div>

        {/* Payment progress bar */}
        {invoice.status === 'partially_paid' && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--success)] transition-all"
                style={{ width: `${paidPct}%` }}
              />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">{paidPct.toFixed(0)}% collected</p>
          </div>
        )}

        {/* Meta */}
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-[var(--text-muted)]">
          <span>Issued {formatDate(invoice.created_at)}</span>
          {invoice.due_date && <span>Due {formatDate(invoice.due_date)}</span>}
          {invoice.job_number && (
            <button
              className="text-[var(--accent)] hover:underline"
              onClick={() => router.push(`/jobs/${invoice.job_id}`)}
            >
              Job {invoice.job_number} →
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="details" className="flex-1 min-h-0">
        <div className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-10 px-4">
          <TabsList className="h-10 bg-transparent gap-0 -mb-px w-full justify-start overflow-x-auto">
            {['details', 'payments'].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-3 py-2 text-body-sm capitalize shrink-0"
              >
                {tab === 'payments' ? `Payments (${payments.length})` : 'Details'}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto pb-24">
          {/* Details */}
          <TabsContent value="details" className="p-4 md:p-6 mt-0 space-y-6">
            {/* Line items */}
            <section>
              <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Line items</h2>
              <InvoiceLineItems items={items} />
            </section>

            {/* GST breakdown */}
            <section className="max-w-xs">
              <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Summary</h2>
              <div className="rounded-lg border border-[var(--border)] p-4">
                {invoice.discount_amount > 0 && (
                  <div className="flex justify-between text-body-sm mb-2">
                    <span className="text-[var(--text-muted)]">Discount</span>
                    <span className="text-[var(--success)] tabular-nums">− <Money amount={invoice.discount_amount} className="text-inherit" /></span>
                  </div>
                )}
                <GstBreakdown
                  subtotal={invoice.subtotal}
                  gstRate={effectiveRate}
                  cgst={isInterState ? undefined : invoice.cgst}
                  sgst={isInterState ? undefined : invoice.sgst}
                  igst={isInterState ? invoice.igst : undefined}
                  total={invoice.grand_total}
                />
              </div>
            </section>
          </TabsContent>

          {/* Payments */}
          <TabsContent value="payments" className="p-4 md:p-6 mt-0">
            <PaymentHistory payments={payments} />
          </TabsContent>
        </div>
      </Tabs>

      {/* ── Sticky action bar ─────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex gap-2 flex-wrap">
        <Can permission="billing.payments.record">
          {canAddPayment && (
            <Button className="flex-1 min-w-[120px]" onClick={() => setPaymentDialogOpen(true)}>
              <CreditCard className="h-4 w-4" />
              Collect payment
            </Button>
          )}
        </Can>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadPdf}
          disabled={pdfLoading}
          title="Download PDF"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">{pdfLoading ? 'Loading…' : 'PDF'}</span>
        </Button>

        <Can permission="billing.repair_invoices.create">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWhatsappConfirmOpen(true)}
            disabled={invoice.status === 'cancelled'}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">WhatsApp</span>
          </Button>
        </Can>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/customers/${invoice.customer_id}`)}
          title="View customer profile"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">Customer</span>
        </Button>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────── */}
      {invoice && (
        <AddPaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          invoice={invoice}
        />
      )}

      <ConfirmDialog
        open={whatsappConfirmOpen}
        onOpenChange={setWhatsappConfirmOpen}
        title="Send invoice via WhatsApp?"
        description={`Send ${invoice.invoice_number} to ${invoice.customer_name} on WhatsApp.`}
        confirmLabel="Send"
        onConfirm={() => whatsappMutation.mutate()}
        loading={whatsappMutation.isPending}
      />
    </div>
  );
}
