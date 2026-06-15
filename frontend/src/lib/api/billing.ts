import { apiGet, apiPost, type PageMeta } from './client';
import { useAuthStore } from '@/lib/stores/authStore';

// ── Types ────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled';
export type InvoiceItemType = 'labor' | 'component' | 'custom';
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'cheque' | 'neft' | 'other';

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  item_type: InvoiceItemType;
  description: string;
  sac_code?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  shop_id: string;
  job_id: string;
  job_number?: string | null;
  customer_id: string;
  customer_name: string;
  customer_phone?: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  subtotal: number;
  discount_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  amount_paid: number;
  amount_outstanding: number;
  due_date?: string | null;
  pdf_url?: string | null;
  created_at: string;
  items?: InvoiceItem[];
  payments?: Payment[];
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  reference_id?: string | null;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
  paid_at: string;
  recorded_by: string;
  recorded_by_name?: string | null;
  notes?: string | null;
}

export interface RazorpayLinkResponse {
  payment_link: string;
  razorpay_order_id: string;
  qr_code_url?: string | null;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface InvoiceFilters {
  shop_id?: string;
  status?: InvoiceStatus;
  customer_id?: string;
  job_id?: string;
  date_from?: string;
  date_to?: string;
  outstanding_only?: boolean;
  page?: number;
}

export interface PaymentFilters {
  invoice_id?: string;
  method?: PaymentMethod;
  date_from?: string;
  date_to?: string;
  page?: number;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const billingApi = {
  listInvoices: (filters: InvoiceFilters = {}) =>
    apiGet<{ items: Invoice[]; meta: PageMeta }>(
      '/billing/repair-invoices/',
      filters as Record<string, string | boolean | undefined>,
    ),

  getInvoice: (id: string) =>
    apiGet<Invoice>(`/billing/repair-invoices/${id}/`),

  createInvoice: (body: { job_id: string; discount_amount?: number; due_date?: string }) =>
    apiPost<Invoice>('/billing/repair-invoices/', body),

  getPdfUrl: (id: string) =>
    apiGet<{ pdf_url: string }>(`/billing/repair-invoices/${id}/pdf/`),

  sendWhatsapp: (id: string) =>
    apiPost<{ queued: boolean }>(`/billing/repair-invoices/${id}/send-whatsapp/`, {}),

  listPayments: (filters: PaymentFilters = {}) =>
    apiGet<{ items: Payment[]; meta: PageMeta }>(
      '/billing/payments/',
      filters as Record<string, string | undefined>,
    ),

  recordPayment: (
    body: {
      invoice_id: string;
      amount: number;
      method: PaymentMethod;
      reference_id?: string;
      notes?: string;
      paid_at?: string;
    },
    idempotencyKey: string,
  ) => apiPost<Payment>('/billing/payments/', body, idempotencyKey),

  createRazorpayLink: (body: { invoice_id: string; amount: number }) =>
    apiPost<RazorpayLinkResponse>('/billing/payments/razorpay/create-link/', body),

  /**
   * Download Tally-compatible CSV export. Returns the CSV text so the caller
   * can trigger a browser download; not JSON — bypasses apiFetch.
   */
  tallyExport: async (params: { shop_id: string; from_date: string; to_date: string }): Promise<void> => {
    const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    const DEV_TENANT_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG ?? '';
    const qs = new URLSearchParams(params).toString();
    const token = useAuthStore.getState().accessToken;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (DEV_TENANT_SLUG) headers['X-Tenant-Slug'] = DEV_TENANT_SLUG;

    const res = await fetch(`${BASE_URL}/api/v1/billing/tally-export/?${qs}`, { headers });
    if (!res.ok) throw new Error(`Tally export failed (${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tally-export-${params.from_date}-${params.to_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  cheque: 'Cheque',
  neft: 'NEFT',
  other: 'Other',
};

export const PAYMENT_METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: 'bg-[var(--success)]/15 text-[var(--success)]',
  upi: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  card: 'bg-[var(--info)]/15 text-[var(--info)]',
  cheque: 'bg-[var(--warning)]/15 text-[var(--warning)]',
  neft: 'bg-[var(--info)]/15 text-[var(--info)]',
  other: 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]',
};

export const INVOICE_ITEM_TYPE_LABELS: Record<InvoiceItemType, string> = {
  labor: 'Labour',
  component: 'Parts',
  custom: 'Custom',
};

/** Days since due_date (positive = overdue). */
export function daysOverdue(invoice: Invoice): number {
  const ref = invoice.due_date ?? invoice.created_at;
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000);
}

/** Aging bucket label. */
export function agingBucket(days: number): string {
  if (days <= 7)  return 'Current';
  if (days <= 30) return '8–30 days';
  if (days <= 60) return '31–60 days';
  return '60+ days';
}
