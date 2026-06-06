import { apiGet, apiPost, apiPatch, type PageMeta } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export type SaleType = 'counter' | 'job_linked' | 'wholesale';
export type SaleStatus = 'draft' | 'completed' | 'partially_paid' | 'cancelled' | 'returned';
export type SalePaymentMethod = 'cash' | 'upi' | 'card' | 'cheque' | 'neft' | 'credit' | 'other';
export type ReturnStatus = 'pending' | 'approved' | 'rejected';
export type RefundMethod = 'cash' | 'original_payment' | 'store_credit' | 'exchange';
export type DiscountType = 'none' | 'flat' | 'percentage';

export interface ProductVariant {
  id: string;
  product_name: string;
  variant_name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  hsn_code?: string | null;
  selling_price: number;
  wholesale_price: number;
  cost_price: number;
  tax_rate: number;
  stock_quantity: number;
}

export interface SaleItem {
  id: string;
  variant_id: string;
  product_name_snapshot: string;
  variant_name_snapshot?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_price: number;
  discount_per_unit: number;
  tax_rate: number;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
}

export interface SalePayment {
  id: string;
  amount: number;
  method: SalePaymentMethod;
  reference_id?: string | null;
  razorpay_payment_id?: string | null;
  paid_at: string;
  recorded_by: string;
}

export interface SaleReturn {
  id: string;
  sale_id: string;
  return_number: string;
  reason: string;
  status: ReturnStatus;
  total_refund_amount: number;
  refund_method: RefundMethod;
  approved_by?: string | null;
  credit_note_number?: string | null;
  credit_note_pdf_url?: string | null;
}

export interface Sale {
  id: string;
  shop_id: string;
  sale_type: SaleType;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  job_id?: string | null;
  job_number?: string | null;
  sale_number: string;
  status: SaleStatus;
  subtotal: number;
  discount_type: DiscountType;
  discount_value: number;
  discount_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  amount_paid: number;
  amount_outstanding: number;
  sale_date: string;
  created_by: string;
  items?: SaleItem[];
  payments?: SalePayment[];
  returns?: SaleReturn[];
}

// ── Cart types (local, not sent to API) ──────────────────────────────────────

export interface CartItem {
  localId: string;
  variant_id: string;
  product_name: string;
  variant_name?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_price: number;
  discount_per_unit: number;
  tax_rate: number;
  cost_price: number;
  stock_quantity: number;
}

export interface CartPayment {
  localId: string;
  method: SalePaymentMethod;
  amount: number;
  reference_id: string;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
}

// ── Local compute ─────────────────────────────────────────────────────────────

export function computeCartTotals(
  items: CartItem[],
  discountType: DiscountType,
  discountValue: number,
  isInterState = false,
): CartTotals {
  const subtotal = items.reduce(
    (s, i) => s + i.quantity * Math.max(0, i.unit_price - i.discount_per_unit),
    0,
  );

  const discountAmount =
    discountType === 'flat'
      ? Math.min(discountValue, subtotal)
      : discountType === 'percentage'
      ? (subtotal * Math.min(discountValue, 100)) / 100
      : 0;

  const taxableBase = subtotal - discountAmount;

  const totalTax = items.reduce((s, item) => {
    const lineBase = item.quantity * Math.max(0, item.unit_price - item.discount_per_unit);
    const lineShare = subtotal > 0 ? lineBase / subtotal : 0;
    const lineTaxable = lineBase - lineShare * discountAmount;
    return s + (lineTaxable * item.tax_rate) / 100;
  }, 0);

  const cgst = isInterState ? 0 : totalTax / 2;
  const sgst = isInterState ? 0 : totalTax / 2;
  const igst = isInterState ? totalTax : 0;

  return { subtotal, discountAmount, taxableBase, cgst, sgst, igst, totalTax, grandTotal: taxableBase + totalTax };
}

// ── API ───────────────────────────────────────────────────────────────────────

export interface SaleFilters {
  shop_id?: string;
  sale_type?: SaleType;
  status?: SaleStatus;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
  cursor?: string;
}

export const posApi = {
  lookupBarcode: (barcode: string, shopId: string) =>
    apiGet<ProductVariant>(`/pos/products/barcode/${encodeURIComponent(barcode)}/`, { shop_id: shopId }),

  searchProducts: (query: string, shopId: string) =>
    apiGet<{ items: ProductVariant[] }>('/inventory/products/', { search: query, shop_id: shopId, page_size: '12' }),

  createSale: (
    body: {
      shop_id: string;
      sale_type: SaleType;
      customer_id?: string | null;
      job_id?: string | null;
      items: Array<{
        variant_id: string;
        product_name_snapshot: string;
        variant_name_snapshot?: string | null;
        hsn_code?: string | null;
        tax_rate: number;
        quantity: number;
        unit_price: number;
        discount_per_unit: number;
      }>;
      discount_type: DiscountType;
      discount_value: number;
      payments: Array<{
        method: SalePaymentMethod;
        amount: number;
        reference_id?: string;
      }>;
    },
    idempotencyKey: string,
  ) => apiPost<Sale>('/pos/sales/', body, idempotencyKey),

  getSale: (id: string) =>
    apiGet<Sale>(`/pos/sales/${id}/`),

  listSales: (filters: SaleFilters = {}) =>
    apiGet<{ items: Sale[]; meta: PageMeta }>('/pos/sales/', filters as Record<string, string | undefined>),

  createReturn: (
    saleId: string,
    body: {
      items: Array<{ sale_item_id: string; quantity: number }>;
      reason: string;
      refund_method: RefundMethod;
    },
  ) => apiPost<SaleReturn>(`/pos/sales/${saleId}/return/`, body),

  reviewReturn: (returnId: string, status: 'approved' | 'rejected') =>
    apiPatch<SaleReturn>(`/pos/sales/returns/${returnId}/`, { action: status === 'approved' ? 'approve' : 'reject' }),
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  counter: 'Counter',
  wholesale: 'Wholesale',
  job_linked: 'Job-linked',
};

export const SALE_PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card',
  cheque: 'Cheque', neft: 'NEFT', credit: 'Credit', other: 'Other',
};

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  cash: 'Cash refund',
  original_payment: 'Original payment method',
  store_credit: 'Store credit',
  exchange: 'Exchange',
};
