export interface SaleItem {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  quantity: number;
  unit_price: string;
  discount_type: "flat" | "percentage" | "none";
  discount_value: string;
  tax_rate: string;
  line_total: string;
  hsn_code: string | null;
}

export interface SalePayment {
  id: string;
  amount: string;
  method: "cash" | "upi" | "card" | "cheque" | "neft" | "credit" | "other";
  reference_id: string | null;
  razorpay_payment_id: string | null;
  paid_at: string;
}

export interface Sale {
  id: string;
  sale_number: string;
  shop_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  sale_type: "counter" | "job_linked" | "wholesale";
  status: "draft" | "completed" | "partially_paid" | "cancelled" | "returned";
  items: SaleItem[];
  payments: SalePayment[];
  subtotal: string;
  discount_value: string;
  discount_type: "flat" | "percentage" | "none";
  tax_total: string;
  grand_total: string;
  amount_paid: string;
  balance_due: string;
  notes: string | null;
  sale_date: string;
  created_at: string;
}

export interface CartItem {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  hsn_code: string | null;
}
