export interface InvoiceItem {
  id: string;
  item_type: "labor" | "component" | "custom";
  description: string;
  sac_code: string;
  hsn_code: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  line_total: string;
}

export interface InvoicePayment {
  id: string;
  invoice: string;
  amount: string;
  method: "cash" | "upi" | "card" | "cheque" | "neft" | "other";
  reference_id: string;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  paid_at: string;
  notes: string;
}

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";

export interface RepairInvoiceSummary {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  customer_name: string;
  customer_phone: string;
  job_number: string;
  grand_total: string;
  amount_paid: string;
  amount_outstanding: string;
  due_date: string | null;
  pdf_url: string;
  created_at: string;
}

export interface RepairInvoiceDetail extends RepairInvoiceSummary {
  customer_gstin: string | null;
  shop_name: string;
  subtotal: string;
  discount_amount: string;
  cgst: string;
  sgst: string;
  igst: string;
  items: InvoiceItem[];
  payments: InvoicePayment[];
}

export interface SaleSummary {
  id: string;
  sale_number: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  sale_type: string;
  grand_total: string;
  amount_paid: string;
  balance_due: string;
  sale_date: string;
  created_at: string;
}
