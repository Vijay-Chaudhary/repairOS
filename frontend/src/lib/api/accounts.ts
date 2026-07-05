import { apiGet, apiPost, apiPatch, apiDelete, type PageMeta } from './client';
import { useAuthStore } from '@/lib/stores/authStore';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type NormalBalance = 'debit' | 'credit';
export type JournalStatus = 'draft' | 'posted';

export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  normal_balance: NormalBalance;
}

export interface JournalLine {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  line_narration: string;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  narration: string;
  reference: string;
  status: JournalStatus;
  posted_by: string | null;
  posted_at: string | null;
  lines: JournalLine[];
}

export interface LedgerRow {
  line_id: string;
  entry_id: string;
  entry_number: string;
  date: string;
  narration: string;
  debit: string;
  credit: string;
  running_balance: string;
}

export interface AccountLedger {
  account: Account;
  opening_balance: string;
  closing_balance: string;
  rows: LedgerRow[];
}

export interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  debit: string;
  credit: string;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  total_debit: string;
  total_credit: string;
}

export interface StatementRow {
  // Null for synthetic rows (e.g. the Balance Sheet's "Current Period Earnings").
  account_id: string | null;
  code: string | null;
  name: string;
  amount: string;
}

export interface StatementSection {
  rows: StatementRow[];
  subtotal: string;
}

export interface ProfitLoss {
  income: StatementSection;
  expense: StatementSection;
  net_profit: string;
  date_from: string | null;
  date_to: string | null;
}

export interface BalanceSheet {
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  total_assets: string;
  total_liabilities: string;
  total_equity: string;
  is_balanced: boolean;
  as_of: string | null;
}

export interface CreateJournalLineInput {
  account_id: string;
  debit?: string | number;
  credit?: string | number;
  line_narration?: string;
}

export const accountsApi = {
  // Chart of Accounts
  listAccounts: (params?: { shop_id?: string; account_type?: AccountType; is_active?: boolean; page?: number }) =>
    apiGet<{ items: Account[]; meta: PageMeta }>('/accounts/chart/', params),

  createAccount: (body: {
    code: string;
    name: string;
    account_type: AccountType;
    parent_id?: string;
    shop_id?: string;
  }) => apiPost<Account>('/accounts/chart/', body),

  updateAccount: (id: string, body: { name?: string; parent_id?: string | null; is_active?: boolean }) =>
    apiPatch<Account>(`/accounts/chart/${id}/`, body),

  deactivateAccount: (id: string) => apiDelete<Account>(`/accounts/chart/${id}/`),

  seedChart: (shopId?: string) => apiPost<{ created: number }>('/accounts/chart/seed/', { shop_id: shopId }),

  // Journal
  listJournal: (params?: { shop_id?: string; status?: JournalStatus; date_from?: string; date_to?: string; page?: number }) =>
    apiGet<{ items: JournalEntry[]; meta: PageMeta }>('/accounts/journal/', params),

  getJournal: (id: string) => apiGet<JournalEntry>(`/accounts/journal/${id}/`),

  createJournal: (body: {
    date: string;
    narration?: string;
    reference?: string;
    shop_id?: string;
    lines: CreateJournalLineInput[];
  }) => apiPost<JournalEntry>('/accounts/journal/', body),

  postJournal: (id: string) => apiPost<JournalEntry>(`/accounts/journal/${id}/post/`, {}),

  // Ledger + Trial Balance
  getLedger: (accountId: string, params?: { date_from?: string; date_to?: string }) =>
    apiGet<AccountLedger>(`/accounts/ledger/${accountId}/`, params),

  getTrialBalance: (params?: { shop_id?: string; as_of?: string }) =>
    apiGet<TrialBalance>('/accounts/trial-balance/', params),

  // Financial statements
  getProfitLoss: (params?: { shop_id?: string; date_from?: string; date_to?: string }) =>
    apiGet<ProfitLoss>('/accounts/reports/pnl/', params),

  getBalanceSheet: (params?: { shop_id?: string; as_of?: string }) =>
    apiGet<BalanceSheet>('/accounts/reports/balance-sheet/', params),

  /**
   * Downloads a statement as CSV (?format=csv); not JSON — bypasses apiFetch,
   * same pattern as billingApi.tallyExport.
   */
  downloadStatementCsv: async (
    report: 'pnl' | 'balance-sheet',
    params: Record<string, string | undefined>,
  ): Promise<void> => {
    const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    const DEV_TENANT_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG ?? '';
    const qs = new URLSearchParams({ format: 'csv' });
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value);
    }
    const token = useAuthStore.getState().accessToken;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (DEV_TENANT_SLUG) headers['X-Tenant-Slug'] = DEV_TENANT_SLUG;

    const res = await fetch(`${BASE_URL}/api/v1/accounts/reports/${report}/?${qs}`, { headers });
    if (!res.ok) throw new Error(`Statement export failed (${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = report === 'pnl' ? 'profit_and_loss.csv' : 'balance_sheet.csv';
    a.click();
    URL.revokeObjectURL(url);
  },
};
