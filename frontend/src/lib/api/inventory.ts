import { apiGet, apiPost, apiPatch, type PageMeta } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export type TxType =
  | 'purchase_in' | 'sale_out' | 'repair_out' | 'return_in' | 'return_out'
  | 'transfer_in' | 'transfer_out' | 'adjustment' | 'opening_stock';

export interface ProductCategory {
  id: string;
  name: string;
  parent_id?: string | null;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  variant_name: string;
  attributes?: Record<string, string>;
  barcode?: string | null;
  cost_price: number;
  selling_price: number;
  wholesale_price?: number | null;
  minimum_order_qty: number;
  is_active: boolean;
  stock_quantity?: number;
}

export interface Product {
  id: string;
  category_id?: string | null;
  category_name?: string | null;
  name: string;
  sku: string;
  brand?: string | null;
  description?: string | null;
  hsn_code?: string | null;
  default_tax_rate: number;
  is_for_sale: boolean;
  is_for_repair_use: boolean;
  is_active: boolean;
  variants?: ProductVariant[];
  variant_count?: number;
}

export interface StockRecord {
  id: string;
  shop_id: string;
  variant_id: string;
  variant_name: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity_in_stock: number;
  reorder_level: number;
  is_low_stock: boolean;
  cost_price: number;
  selling_price: number;
}

export interface InventoryTransaction {
  id: string;
  shop_id: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  type: TxType;
  quantity: number;
  reference_type?: string | null;
  reference_id?: string | null;
  note?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface StockFilters {
  shop_id?: string;
  search?: string;
  low_stock_only?: boolean;
  category_id?: string;
  cursor?: string;
}

export interface TransactionFilters {
  shop_id?: string;
  variant_id?: string;
  type?: TxType;
  date_from?: string;
  date_to?: string;
  cursor?: string;
}

export interface ProductFilters {
  search?: string;
  category_id?: string;
  is_for_sale?: boolean;
  is_for_repair_use?: boolean;
  is_active?: boolean;
  cursor?: string;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const inventoryApi = {
  listStock: (filters: StockFilters = {}) =>
    apiGet<{ items: StockRecord[]; meta: PageMeta }>(
      '/inventory/stock/',
      filters as Record<string, string | boolean | undefined>,
    ),

  adjustStock: (body: {
    shop_id: string;
    variant_id: string;
    quantity: number;
    note: string;
  }) => apiPost<{ transaction: InventoryTransaction; new_qty: number }>('/inventory/adjustment/', body),

  transferStock: (body: {
    source_shop_id: string;
    dest_shop_id: string;
    variant_id: string;
    quantity: number;
    note?: string;
  }) => apiPost<{ transactions: InventoryTransaction[] }>('/inventory/transfer/', body),

  listTransactions: (filters: TransactionFilters = {}) =>
    apiGet<{ items: InventoryTransaction[]; meta: PageMeta }>(
      '/inventory/transactions/',
      filters as Record<string, string | undefined>,
    ),

  listProducts: (filters: ProductFilters = {}) =>
    apiGet<{ items: Product[]; meta: PageMeta }>(
      '/inventory/products/',
      filters as Record<string, string | boolean | undefined>,
    ),

  getProduct: (id: string) =>
    apiGet<Product>(`/inventory/products/${id}/`),

  createProduct: (body: {
    name: string;
    sku: string;
    brand?: string;
    description?: string;
    category_id?: string;
    hsn_code?: string;
    default_tax_rate?: number;
    is_for_sale?: boolean;
    is_for_repair_use?: boolean;
  }) => apiPost<Product>('/inventory/products/', body),

  updateProduct: (id: string, body: Partial<{
    name: string;
    sku: string;
    brand: string;
    description: string;
    category_id: string;
    hsn_code: string;
    default_tax_rate: number;
    is_for_sale: boolean;
    is_for_repair_use: boolean;
    is_active: boolean;
  }>) => apiPatch<Product>(`/inventory/products/${id}/`, body),

  createVariant: (productId: string, body: {
    variant_name: string;
    attributes?: Record<string, string>;
    barcode?: string;
    cost_price: number;
    selling_price: number;
    wholesale_price?: number;
    minimum_order_qty?: number;
  }) => apiPost<ProductVariant>(`/inventory/products/${productId}/variants/`, body),

  updateVariant: (variantId: string, body: Partial<{
    variant_name: string;
    barcode: string;
    cost_price: number;
    selling_price: number;
    wholesale_price: number;
    minimum_order_qty: number;
    is_active: boolean;
  }>) => apiPatch<ProductVariant>(`/inventory/variants/${variantId}/`, body),

  listCategories: () =>
    apiGet<{ items: ProductCategory[] }>('/inventory/categories/'),
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const TX_TYPE_LABELS: Record<TxType, string> = {
  purchase_in:   'Purchase in',
  sale_out:      'Sale out',
  repair_out:    'Repair use',
  return_in:     'Return in',
  return_out:    'Return out',
  transfer_in:   'Transfer in',
  transfer_out:  'Transfer out',
  adjustment:    'Adjustment',
  opening_stock: 'Opening stock',
};

export const TX_TYPE_COLORS: Record<TxType, string> = {
  purchase_in:   'text-[var(--success)]',
  return_in:     'text-[var(--success)]',
  transfer_in:   'text-[var(--success)]',
  opening_stock: 'text-[var(--info)]',
  sale_out:      'text-[var(--danger)]',
  repair_out:    'text-[var(--danger)]',
  return_out:    'text-[var(--danger)]',
  transfer_out:  'text-[var(--danger)]',
  adjustment:    'text-[var(--warning)]',
};

export const TAX_RATES = [0, 5, 12, 18, 28];
