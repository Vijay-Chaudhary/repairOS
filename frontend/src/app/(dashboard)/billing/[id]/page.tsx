"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Download, CreditCard, CheckCircle,
  Loader2, Receipt, Wrench, Package
} from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime, cn } from "@/lib/utils";
import type { RepairInvoiceDetail, InvoicePayment } from "@/types/billing";

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchInvoice(id: string): Promise<RepairInvoiceDetail> {
  const res = await api.get(`/billing/repair-invoices/${id}/`);
  return res.data.data;
}

// ── Payment form schema ───────────────────────────────────────────────────────

const paySchema = z.object({
  amount: z.string().min(1, "Amount is required").refine(
    (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
    "Enter a valid positive amount"
  ),
  method: z.enum(["cash", "upi", "card", "cheque", "neft", "other"]),
  reference_id: z.string().optional(),
  notes: z.string().optional(),
});
type PayForm = z.infer<typeof paySchema>;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  draft:          { label: "Draft",         cls: "bg-gray-100 text-gray-700" },
  issued:         { label: "Issued",         cls: "bg-blue-100 text-blue-700" },
  partially_paid: { label: "Partially Paid", cls: "bg-yellow-100 text-yellow-700" },
  paid:           { label: "Paid",           cls: "bg-green-100 text-green-700" },
  cancelled:      { label: "Cancelled",      cls: "bg-red-100 text-red-700" },
} as const;

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", card: "Card",
  cheque: "Cheque", neft: "NEFT", other: "Other",
};

const ITEM_TYPE_ICON = {
  labor:     <Wrench className="w-3.5 h-3.5 text-blue-500" />,
  component: <Package className="w-3.5 h-3.5 text-purple-500" />,
  custom:    <Receipt className="w-3.5 h-3.5 text-gray-500" />,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const [showPayForm, setShowPayForm] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", params.id],
    queryFn: () => fetchInvoice(params.id),
  });

  const form = useForm<PayForm>({
    resolver: zodResolver(paySchema),
    defaultValues: { method: "cash" },
  });

  const payMutation = useMutation({
    mutationFn: (data: PayForm) =>
      api.post("/billing/payments/", {
        invoice_id: params.id,
        amount: parseFloat(data.amount),
        method: data.method,
        reference_id: data.reference_id ?? "",
        notes: data.notes ?? "",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", params.id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      form.reset();
      setShowPayForm(false);
    },
  });

  // Pre-fill amount with outstanding balance
  const prefillAmount = () => {
    if (invoice) {
      form.setValue("amount", parseFloat(invoice.amount_outstanding).toFixed(2));
      setShowPayForm(true);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl">
        <div className="h-6 w-32 bg-gray-200 rounded" />
        <div className="h-40 bg-gray-100 rounded-xl" />
        <div className="h-32 bg-gray-100 rounded-xl" />
      </div>
    );
  }
  if (!invoice) return <p className="text-gray-500">Invoice not found.</p>;

  const status = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.issued;
  const outstanding = parseFloat(invoice.amount_outstanding);
  const canPay = ["issued", "partially_paid"].includes(invoice.status) && outstanding > 0;
  return (
    <div className="space-y-4 max-w-2xl">
      {/* Back */}
      <Link href="/billing" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> Billing
      </Link>

      {/* Invoice header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-gray-900">{invoice.invoice_number}</h1>
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", status.cls)}>
                {status.label}
              </span>
            </div>
            <p className="text-sm font-medium text-gray-700">{invoice.customer_name}</p>
            <p className="text-xs text-gray-500">{invoice.customer_phone}</p>
            {invoice.customer_gstin && (
              <p className="text-xs text-gray-400 font-mono mt-0.5">{invoice.customer_gstin}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-500">{invoice.shop_name}</p>
            <p className="text-xs text-gray-400">Job: {invoice.job_number}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(invoice.created_at)}</p>
            {invoice.due_date && (
              <p className="text-xs text-gray-500 mt-0.5">Due: {formatDate(invoice.due_date)}</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {invoice.pdf_url && (
            <a
              href={invoice.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition min-h-[44px]"
            >
              <Download className="w-4 h-4" />
              PDF
            </a>
          )}
          {canPay && (
            <button
              onClick={prefillAmount}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
            >
              <CreditCard className="w-4 h-4" />
              Record Payment
            </button>
          )}
          {invoice.status === "paid" && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
              <CheckCircle className="w-4 h-4" />
              Fully Paid
            </div>
          )}
        </div>
      </div>

      {/* Inline payment form */}
      {showPayForm && (
        <div className="bg-white rounded-xl border border-blue-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Record Payment</h2>
          <form onSubmit={form.handleSubmit((d) => payMutation.mutate(d))} className="space-y-4">
            {/* Amount + method row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Amount (₹) *
                </label>
                <input
                  {...form.register("amount")}
                  type="number"
                  step="0.01"
                  className={cn(
                    "w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500",
                    form.formState.errors.amount ? "border-red-300 bg-red-50" : "border-gray-300"
                  )}
                />
                {form.formState.errors.amount && (
                  <p className="text-red-500 text-xs mt-1">{form.formState.errors.amount.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Method *</label>
                <select
                  {...form.register("method")}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {Object.entries(METHOD_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Reference ID (shown for UPI/card/cheque/NEFT) */}
            {["upi", "card", "cheque", "neft"].includes(form.watch("method")) && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Reference / Transaction ID
                </label>
                <input
                  {...form.register("reference_id")}
                  type="text"
                  placeholder="UTR / cheque no. / txn ID"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes</label>
              <input
                {...form.register("notes")}
                type="text"
                placeholder="Optional"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {payMutation.isError && (
              <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
                Failed to record payment. Check the amount and try again.
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowPayForm(false); form.reset(); }}
                className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={payMutation.isPending}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {payMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Totals summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Summary</h2>
        <div className="space-y-1.5">
          <SummaryRow label="Subtotal" value={formatCurrency(parseFloat(invoice.subtotal))} />
          {parseFloat(invoice.discount_amount) > 0 && (
            <SummaryRow
              label="Discount"
              value={`- ${formatCurrency(parseFloat(invoice.discount_amount))}`}
              valueClass="text-red-600"
            />
          )}
          {parseFloat(invoice.cgst) > 0 && <SummaryRow label="CGST" value={formatCurrency(parseFloat(invoice.cgst))} />}
          {parseFloat(invoice.sgst) > 0 && <SummaryRow label="SGST" value={formatCurrency(parseFloat(invoice.sgst))} />}
          {parseFloat(invoice.igst) > 0 && <SummaryRow label="IGST" value={formatCurrency(parseFloat(invoice.igst))} />}
          <div className="border-t border-gray-100 pt-1.5">
            <SummaryRow label="Grand Total" value={formatCurrency(parseFloat(invoice.grand_total))} bold />
          </div>
          <SummaryRow label="Amount Paid" value={formatCurrency(parseFloat(invoice.amount_paid))} valueClass="text-green-600" />
          {outstanding > 0 && (
            <SummaryRow label="Outstanding" value={formatCurrency(outstanding)} valueClass="text-red-600" bold />
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {invoice.items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5">{ITEM_TYPE_ICON[item.item_type]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{item.description}</p>
                <p className="text-xs text-gray-500">
                  {parseFloat(item.quantity)} × {formatCurrency(parseFloat(item.unit_price))}
                  {parseFloat(item.tax_rate) > 0 && ` + ${item.tax_rate}% GST`}
                  {item.sac_code && ` · SAC ${item.sac_code}`}
                  {item.hsn_code && ` · HSN ${item.hsn_code}`}
                </p>
              </div>
              <p className="text-sm font-semibold text-gray-900 flex-shrink-0">
                {formatCurrency(parseFloat(item.line_total))}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Payment history */}
      {invoice.payments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Payment History</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {invoice.payments.map((pmt) => (
              <PaymentRow key={pmt.id} payment={pmt} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function SummaryRow({
  label, value, valueClass, bold,
}: {
  label: string; value: string; valueClass?: string; bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className={cn("text-xs", bold ? "font-semibold text-gray-900" : "text-gray-500")}>{label}</span>
      <span className={cn("text-sm", bold ? "font-bold text-gray-900" : "text-gray-700", valueClass)}>
        {value}
      </span>
    </div>
  );
}

function PaymentRow({ payment }: { payment: InvoicePayment }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          <p className="text-sm text-gray-900 font-medium">{METHOD_LABELS[payment.method] ?? payment.method}</p>
          {payment.reference_id && (
            <span className="text-xs text-gray-400 font-mono">#{payment.reference_id}</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(payment.paid_at)}</p>
        {payment.notes && <p className="text-xs text-gray-500 mt-0.5">{payment.notes}</p>}
      </div>
      <p className="text-sm font-semibold text-green-700">{formatCurrency(parseFloat(payment.amount))}</p>
    </div>
  );
}
