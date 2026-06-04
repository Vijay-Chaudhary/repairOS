import { apiGet, apiPost, apiPatch, type PageMeta } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export type PoStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
export type PurchasePaymentStatus = 'unpaid' | 'partially_paid' | 'paid';
export type PurchasePaymentMethod = 'cash' | 'upi' | 'card' | 'cheque' | 'neft' | 'other';
export type ReturnStatus = 'pending' | 'approved' | 'dispatched';

export interface Supplier {
  id: string;
  name: string;
  contact_person?: string | null;
  phone: string;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  state_code?: string | null;
  gstin?: string | null;
  payment_terms_days: number;
  credit_limit: number;
  bank_ifsc?: string | null;
  bank_account_masked?: string | null;
  is_active: boolean;
}

export interface POItem {
  id: string;
  po_id: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  tax_rate: number;
  hsn_code?: string | null;
  line_total: number;
}

export interface PurchaseOrder {
  id: string;
  shop_id: string;
  supplier_id: string;
  supplier_name: string;
  po_number: string;
  status: PoStatus;
  expected_delivery_date?: string | null;
  notes?: string | null;
  grand_total?: number;
  created_at: string;
  items?: POItem[];
}

export interface GRNItem {
  id?: string;
  po_item_id: string;
  quantity_received: number;
  quantity_accepted: number;
  quantity_rejected: number;
  rejection_reason?: string | null;
}

export interface GRNNote {
  id: string;
  po_id: string;
  grn_number: string;
  received_date: string;
  received_by_name?: string | null;
  challan_number?: string | null;
  notes?: string | null;
  items?: GRNItem[];
}

export interface PurchaseInvoice {
  id: string;
  shop_id: string;
  supplier_id: string;
  supplier_name: string;
  grn_id?: string | null;
  bill_number: string;
  bill_date: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  payment_status: PurchasePaymentStatus;
  due_date?: string | null;
  amount_paid: number;
  amount_outstanding: number;
}

export interface PurchasePayment {
  id: string;
  purchase_invoice_id: string;
  amount: number;
  method: PurchasePaymentMethod;
  reference_id?: string | null;
  paid_at: string;
  recorded_by_name?: string | null;
}

export interface SupplierLedgerEntry {
  id: string;
  type: 'invoice' | 'payment';
  date: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  notes?: string | null;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const procurementApi = {
  // Suppliers
  listSuppliers: (filters: { search?: string; is_active?: boolean } = {}) =>
    apiGet<{ items: Supplier[]; meta: PageMeta }>(
      '/procurement/suppliers/',
      filters as Record<string, string | boolean | undefined>,
    ),

  getSupplier: (id: string) =>
    apiGet<Supplier>(`/procurement/suppliers/${id}/`),

  createSupplier: (body: {
    name: string;
    phone: string;
    contact_person?: string;
    email?: string;
    address?: string;
    state?: string;
    state_code?: string;
    gstin?: string;
    payment_terms_days?: number;
    credit_limit?: number;
    bank_account_number?: string;
    bank_ifsc?: string;
  }) => apiPost<Supplier>('/procurement/suppliers/', body),

  updateSupplier: (id: string, body: Partial<{
    name: string; phone: string; contact_person: string; email: string; address: string;
    state: string; state_code: string; gstin: string; payment_terms_days: number;
    credit_limit: number; bank_account_number: string; bank_ifsc: string;
  }>) => apiPatch<Supplier>(`/procurement/suppliers/${id}/`, body),

  getSupplierLedger: (id: string) =>
    apiGet<{ items: SupplierLedgerEntry[]; balance: number }>(`/procurement/suppliers/${id}/ledger/`),

  // Purchase Orders
  listPOs: (filters: { shop_id?: string; status?: PoStatus; supplier_id?: string; cursor?: string } = {}) =>
    apiGet<{ items: PurchaseOrder[]; meta: PageMeta }>(
      '/procurement/purchase-orders/',
      filters as Record<string, string | undefined>,
    ),

  getPO: (id: string) =>
    apiGet<PurchaseOrder>(`/procurement/purchase-orders/${id}/`),

  createPO: (body: {
    shop_id: string;
    supplier_id: string;
    expected_delivery_date?: string;
    notes?: string;
    items: Array<{
      variant_id: string;
      quantity_ordered: number;
      unit_cost: number;
      tax_rate: number;
      hsn_code?: string;
    }>;
  }) => apiPost<PurchaseOrder>('/procurement/purchase-orders/', body),

  updatePO: (id: string, body: Partial<{ status: PoStatus; notes: string; expected_delivery_date: string }>) =>
    apiPatch<PurchaseOrder>(`/procurement/purchase-orders/${id}/`, body),

  // GRN
  createGRN: (body: {
    po_id: string;
    received_date: string;
    challan_number?: string;
    notes?: string;
    items: GRNItem[];
  }) => apiPost<GRNNote>('/procurement/grn/', body),

  // Purchase Invoices
  listInvoices: (filters: { shop_id?: string; supplier_id?: string; payment_status?: PurchasePaymentStatus; cursor?: string } = {}) =>
    apiGet<{ items: PurchaseInvoice[]; meta: PageMeta }>(
      '/procurement/purchase-invoices/',
      filters as Record<string, string | undefined>,
    ),

  createInvoice: (body: {
    shop_id: string;
    supplier_id: string;
    grn_id?: string;
    bill_number: string;
    bill_date: string;
    subtotal: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    grand_total: number;
    due_date?: string;
  }) => apiPost<PurchaseInvoice>('/procurement/purchase-invoices/', body),

  recordPayment: (body: {
    purchase_invoice_id: string;
    amount: number;
    method: PurchasePaymentMethod;
    reference_id?: string;
    paid_at?: string;
  }) => apiPost<PurchasePayment>('/procurement/purchase-payments/', body),
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  sent: 'Sent to supplier',
  partially_received: 'Partial receipt',
  received: 'Fully received',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<PurchasePaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
};

export const PURCHASE_PAYMENT_METHOD_LABELS: Record<PurchasePaymentMethod, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', neft: 'NEFT', other: 'Other',
};
