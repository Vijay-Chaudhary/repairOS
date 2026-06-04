import { apiGet, apiPost, apiPatch, type PageMeta } from './client';

export type PettyCashType = 'credit' | 'debit';
export type AssetCondition = 'good' | 'fair' | 'poor' | 'under_repair' | 'disposed';
export type BudgetCategory = 'fixed' | 'variable' | 'capital';

export interface PettyCashAccount {
  id: string;
  shop_id: string;
  name: string;
  current_balance: number;
  low_balance_threshold: number;
}

export interface PettyCashTransaction {
  id: string;
  account_id: string;
  type: PettyCashType;
  amount: number;
  category: string;
  description: string;
  receipt_url?: string | null;
  date: string;
  recorded_by_name?: string | null;
  balance_after: number;
}

export interface Expense {
  id: string;
  shop_id: string;
  budget_head_id?: string | null;
  budget_head_name?: string | null;
  category: string;
  amount: number;
  description: string;
  receipt_url?: string | null;
  date: string;
  recorded_by_name?: string | null;
}

export interface BudgetHead {
  id: string;
  shop_id: string;
  name: string;
  category: BudgetCategory;
}

export interface BudgetAllocation {
  id: string;
  head_id: string;
  head_name: string;
  category: BudgetCategory;
  month: number;
  year: number;
  budgeted_amount: number;
  actual_amount: number;
  variance: number;
}

export interface ShopAsset {
  id: string;
  shop_id: string;
  name: string;
  category: string;
  asset_code: string;
  purchase_date?: string | null;
  purchase_cost: number;
  supplier_id?: string | null;
  supplier_name?: string | null;
  warranty_expiry?: string | null;
  condition: AssetCondition;
  location_description?: string | null;
  notes?: string | null;
  is_active: boolean;
}

export const financeApi = {
  getPettyCashAccount: (shopId: string) =>
    apiGet<PettyCashAccount>(`/finance/petty-cash/${shopId}/`),

  listPettyCashTransactions: (filters: {
    account_id?: string;
    date_from?: string;
    date_to?: string;
    cursor?: string;
  } = {}) =>
    apiGet<{ items: PettyCashTransaction[]; meta: PageMeta }>(
      '/finance/petty-cash/transactions/',
      filters as Record<string, string | undefined>,
    ),

  addPettyCashEntry: (body: {
    account_id: string;
    type: PettyCashType;
    amount: number;
    category: string;
    description: string;
    receipt_url?: string;
    date: string;
  }) => apiPost<PettyCashTransaction>('/finance/petty-cash/transactions/', body),

  listExpenses: (filters: {
    shop_id?: string;
    budget_head_id?: string;
    date_from?: string;
    date_to?: string;
    cursor?: string;
  } = {}) =>
    apiGet<{ items: Expense[]; meta: PageMeta }>(
      '/finance/expenses/',
      filters as Record<string, string | undefined>,
    ),

  createExpense: (body: {
    shop_id: string;
    budget_head_id?: string;
    category: string;
    amount: number;
    description: string;
    receipt_url?: string;
    date: string;
  }) => apiPost<Expense>('/finance/expenses/', body),

  listBudgetHeads: (shopId: string) =>
    apiGet<{ items: BudgetHead[] }>('/finance/budget/', { shop_id: shopId }),

  createBudgetHead: (body: { shop_id: string; name: string; category: BudgetCategory }) =>
    apiPost<BudgetHead>('/finance/budget/', body),

  listBudgetAllocations: (filters: {
    shop_id?: string;
    month?: number;
    year?: number;
  }) =>
    apiGet<{ items: BudgetAllocation[] }>(
      '/finance/budget/allocations/',
      filters as Record<string, string | number | undefined>,
    ),

  setBudgetAllocation: (body: {
    head_id: string;
    month: number;
    year: number;
    budgeted_amount: number;
  }) => apiPost<BudgetAllocation>('/finance/budget/allocations/', body),

  listAssets: (filters: {
    shop_id?: string;
    condition?: AssetCondition;
    is_active?: boolean;
    cursor?: string;
  } = {}) =>
    apiGet<{ items: ShopAsset[]; meta: PageMeta }>(
      '/finance/assets/',
      filters as Record<string, string | boolean | undefined>,
    ),

  createAsset: (body: {
    shop_id: string;
    name: string;
    category: string;
    asset_code: string;
    purchase_date?: string;
    purchase_cost: number;
    supplier_id?: string;
    warranty_expiry?: string;
    condition?: AssetCondition;
    location_description?: string;
    notes?: string;
  }) => apiPost<ShopAsset>('/finance/assets/', body),

  updateAsset: (id: string, body: Partial<{
    condition: AssetCondition;
    location_description: string;
    notes: string;
    warranty_expiry: string;
    is_active: boolean;
  }>) => apiPatch<ShopAsset>(`/finance/assets/${id}/`, body),
};

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  good: 'Good', fair: 'Fair', poor: 'Poor',
  under_repair: 'Under repair', disposed: 'Disposed',
};

export const ASSET_CONDITION_COLORS: Record<AssetCondition, string> = {
  good:         'text-[var(--success)]',
  fair:         'text-[var(--warning)]',
  poor:         'text-[var(--danger)]',
  under_repair: 'text-[var(--info)]',
  disposed:     'text-[var(--text-muted)]',
};

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  fixed: 'Fixed', variable: 'Variable', capital: 'Capital',
};

// Re-export so existing imports from this module continue to work.
export { MONTHS_FULL as MONTHS } from '@/lib/format/date';
