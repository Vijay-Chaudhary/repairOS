export interface PettyCashAccount {
  id: string;
  shop: string;
  name: string;
  current_balance: string;
  low_balance_threshold: string;
}

export interface PettyCashTransaction {
  id: string;
  account: string;
  txn_type: "credit" | "debit";
  amount: string;
  category: string;
  description: string;
  date: string;
  balance_after: string;
}

export interface BudgetHead {
  id: string;
  shop: string;
  name: string;
  category: "fixed" | "variable" | "capital";
}

export interface BudgetAllocation {
  id: string;
  head: string;
  month: number;
  year: number;
  budgeted_amount: string;
  actual_amount: string;
  variance: string;
}

export interface Expense {
  id: string;
  shop: string;
  budget_head: string | null;
  category: string;
  amount: string;
  description: string;
  date: string;
}

export type AssetCondition = "good" | "fair" | "poor" | "under_repair";

export interface ShopAsset {
  id: string;
  shop: string;
  name: string;
  category: string;
  asset_code: string;
  purchase_date: string;
  purchase_cost: string;
  warranty_expiry: string | null;
  condition: AssetCondition;
  location_description: string;
  notes: string;
  is_active: boolean;
}
