export interface ProductVariant {
  id: string;
  product: string;
  variant_name: string;
  sku: string;
  buying_price: string;
  selling_price: string;
  gst_rate: string;
  hsn_code: string | null;
  reorder_level: number;
  stock_qty: number;
  created_at: string;
}

export interface Product {
  id: string;
  category: string | null;
  name: string;
  sku: string;
  brand: string | null;
  description: string | null;
  hsn_code: string | null;
  default_tax_rate: string;
  is_for_sale: boolean;
  is_for_repair_use: boolean;
  is_active: boolean;
  variants: ProductVariant[];
  created_at: string;
}

export interface StockMovement {
  id: string;
  variant: string;
  variant_name: string;
  product_name: string;
  movement_type: "in" | "out" | "adjustment" | "transfer";
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  performed_by: string;
  performed_by_name: string;
  created_at: string;
}
