"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, TrendingDown, BarChart2, Package2,
  Plus, ArrowUpCircle, ArrowDownCircle, Loader2, AlertCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";
import type {
  PettyCashAccount, PettyCashTransaction,
  BudgetHead, BudgetAllocation,
  Expense, ShopAsset, AssetCondition,
} from "@/types/finance";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const CONDITION_CFG: Record<AssetCondition, { label: string; cls: string }> = {
  good:         { label: "Good",        cls: "bg-green-100 text-green-700" },
  fair:         { label: "Fair",        cls: "bg-yellow-100 text-yellow-700" },
  poor:         { label: "Poor",        cls: "bg-orange-100 text-orange-700" },
  under_repair: { label: "Under Repair",cls: "bg-red-100 text-red-700" },
};

type Tab = "petty-cash" | "expenses" | "budget" | "assets";

// ── Helpers ───────────────────────────────────────────────────────────────────

const inp = (err: boolean) => cn(
  "w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500",
  err ? "border-red-300 bg-red-50" : "border-gray-300 bg-white"
);

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("petty-cash");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Finance</h1>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 bg-gray-100 p-1 rounded-lg">
        {([
          { id: "petty-cash", icon: Wallet,      label: "Petty Cash" },
          { id: "expenses",   icon: TrendingDown, label: "Expenses" },
          { id: "budget",     icon: BarChart2,    label: "Budget" },
          { id: "assets",     icon: Package2,     label: "Assets" },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              "flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-md transition",
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}>
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === "petty-cash" && <PettyCashTab />}
      {tab === "expenses"   && <ExpensesTab />}
      {tab === "budget"     && <BudgetTab />}
      {tab === "assets"     && <AssetsTab />}
    </div>
  );
}

// ── Petty Cash Tab ────────────────────────────────────────────────────────────

const txnSchema = z.object({
  txn_type:    z.enum(["credit", "debit"]),
  amount:      z.string().min(1, "Amount required"),
  category:    z.string().optional(),
  description: z.string().optional(),
  date:        z.string().min(1, "Date required"),
});
type TxnForm = z.infer<typeof txnSchema>;

function PettyCashTab() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const shopId = user?.shop_ids?.[0];
  const [showForm, setShowForm] = useState(false);

  const { data: account, isLoading: accLoading } = useQuery<PettyCashAccount>({
    queryKey: ["petty-cash", shopId],
    queryFn: () => api.get(`/finance/petty-cash/${shopId}/`).then((r) => r.data.data),
    enabled: !!shopId,
  });

  const { data: transactions } = useQuery<PettyCashTransaction[]>({
    queryKey: ["petty-cash-txns", account?.id],
    queryFn: () => api.get(`/finance/petty-cash/transactions/?account_id=${account!.id}`).then((r) => Array.isArray(r.data.data) ? r.data.data : []),
    enabled: !!account?.id,
  });

  const form = useForm<TxnForm>({
    resolver: zodResolver(txnSchema),
    defaultValues: { txn_type: "debit", date: new Date().toISOString().split("T")[0] },
  });

  const createTxn = useMutation({
    mutationFn: (d: TxnForm) => api.post("/finance/petty-cash/transactions/", { ...d, account_id: account!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["petty-cash", shopId] });
      qc.invalidateQueries({ queryKey: ["petty-cash-txns"] });
      form.reset({ txn_type: "debit", date: new Date().toISOString().split("T")[0] });
      setShowForm(false);
    },
  });

  const balance = parseFloat(account?.current_balance ?? "0");
  const threshold = parseFloat(account?.low_balance_threshold ?? "0");
  const isLow = balance <= threshold;

  return (
    <div className="space-y-4">
      {/* Account balance card */}
      {accLoading ? (
        <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      ) : account ? (
        <div className={cn("rounded-xl p-5 border", isLow ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200")}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-600">{account.name}</p>
              <p className={cn("text-3xl font-bold mt-1", isLow ? "text-orange-700" : "text-green-700")}>
                {formatCurrency(balance)}
              </p>
              {isLow && (
                <div className="flex items-center gap-1 text-orange-600 text-xs mt-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Below low balance threshold
                </div>
              )}
            </div>
            <PermissionGate perm={PERMISSIONS.HR_PETTY_CASH}>
              <button onClick={() => setShowForm(!showForm)}
                className="flex items-center gap-2 px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition min-h-[40px]">
                <Plus className="w-4 h-4" /> Add Transaction
              </button>
            </PermissionGate>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 text-center py-8">No petty cash account found for this shop.</p>
      )}

      {/* Transaction form */}
      {showForm && account && (
        <form onSubmit={form.handleSubmit((d) => createTxn.mutate(d))}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">New Transaction</p>
          <div className="flex gap-2">
            {(["debit", "credit"] as const).map((t) => (
              <button key={t} type="button"
                onClick={() => form.setValue("txn_type", t)}
                className={cn(
                  "flex-1 py-2.5 rounded-lg text-sm font-medium border transition min-h-[44px] flex items-center justify-center gap-1.5",
                  form.watch("txn_type") === t
                    ? t === "debit" ? "bg-red-600 text-white border-red-600" : "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                )}>
                {t === "debit" ? <ArrowDownCircle className="w-4 h-4" /> : <ArrowUpCircle className="w-4 h-4" />}
                {t === "debit" ? "Expense" : "Top Up"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount *" error={form.formState.errors.amount?.message}>
              <input {...form.register("amount")} type="number" step="0.01" min="0.01" placeholder="500" className={inp(!!form.formState.errors.amount)} />
            </Field>
            <Field label="Date *" error={form.formState.errors.date?.message}>
              <input {...form.register("date")} type="date" className={inp(!!form.formState.errors.date)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" error={undefined}>
              <input {...form.register("category")} placeholder="e.g. Stationery" className={inp(false)} />
            </Field>
            <Field label="Description" error={undefined}>
              <input {...form.register("description")} placeholder="What for?" className={inp(false)} />
            </Field>
          </div>
          {createTxn.isError && <p className="text-red-500 text-xs">Failed to record transaction.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={createTxn.isPending}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {createTxn.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </div>
        </form>
      )}

      {/* Transactions list */}
      {transactions && transactions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Recent Transactions</p>
          </div>
          <div className="divide-y divide-gray-50">
            {transactions.slice(0, 20).map((txn) => (
              <div key={txn.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  {txn.txn_type === "credit"
                    ? <ArrowUpCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    : <ArrowDownCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  <div>
                    <p className="text-sm text-gray-900">{txn.description || txn.category || "—"}</p>
                    <p className="text-xs text-gray-400">{formatDate(txn.date)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-semibold", txn.txn_type === "credit" ? "text-green-600" : "text-red-600")}>
                    {txn.txn_type === "credit" ? "+" : "-"}{formatCurrency(parseFloat(txn.amount))}
                  </p>
                  <p className="text-xs text-gray-400">Bal: {formatCurrency(parseFloat(txn.balance_after))}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────

const expenseSchema = z.object({
  amount:      z.string().min(1, "Amount required"),
  category:    z.string().optional(),
  description: z.string().optional(),
  date:        z.string().min(1, "Date required"),
});
type ExpForm = z.infer<typeof expenseSchema>;

function ExpensesTab() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const shopId = user?.shop_ids?.[0];
  const [showForm, setShowForm] = useState(false);

  const { data: expenses, isLoading } = useQuery<Expense[]>({
    queryKey: ["expenses", shopId],
    queryFn: () => api.get(`/finance/expenses/?shop_id=${shopId}`).then((r) => Array.isArray(r.data.data) ? r.data.data : []),
    enabled: !!shopId,
  });


  const form = useForm<ExpForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: { date: new Date().toISOString().split("T")[0] },
  });

  const createExp = useMutation({
    mutationFn: (d: ExpForm) => api.post("/finance/expenses/", { ...d, shop_id: shopId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); form.reset({ date: new Date().toISOString().split("T")[0] }); setShowForm(false); },
  });

  const totalThisMonth = expenses
    ?.filter((e) => {
      const d = new Date(e.date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, e) => s + parseFloat(e.amount), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">This month: <span className="font-semibold text-gray-900">{formatCurrency(totalThisMonth)}</span></p>
        </div>
        <PermissionGate perm={PERMISSIONS.ERP_EXPENSES_MANAGE}>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </PermissionGate>
      </div>

      {showForm && (
        <form onSubmit={form.handleSubmit((d) => createExp.mutate(d))}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹) *" error={form.formState.errors.amount?.message}>
              <input {...form.register("amount")} type="number" step="0.01" min="0.01" placeholder="500" className={inp(!!form.formState.errors.amount)} />
            </Field>
            <Field label="Date *" error={form.formState.errors.date?.message}>
              <input {...form.register("date")} type="date" className={inp(!!form.formState.errors.date)} />
            </Field>
          </div>
          <Field label="Category" error={undefined}>
            <input {...form.register("category")} placeholder="Travel, Supplies, etc." className={inp(false)} />
          </Field>
          <Field label="Description" error={undefined}>
            <input {...form.register("description")} placeholder="Brief description" className={inp(false)} />
          </Field>
          {createExp.isError && <p className="text-red-500 text-xs">Failed to save expense.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={createExp.isPending}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {createExp.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !expenses?.length ? (
        <div className="text-center py-12 text-gray-400">
          <TrendingDown className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No expenses recorded</p>
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.slice(0, 30).map((exp) => (
            <div key={exp.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{exp.description || exp.category || "Expense"}</p>
                <p className="text-xs text-gray-400">{formatDate(exp.date)}{exp.category ? ` · ${exp.category}` : ""}</p>
              </div>
              <p className="text-sm font-bold text-red-600">{formatCurrency(parseFloat(exp.amount))}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Budget Tab ────────────────────────────────────────────────────────────────

function BudgetTab() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const shopId = user?.shop_ids?.[0];
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data: heads } = useQuery<BudgetHead[]>({
    queryKey: ["budget-heads", shopId],
    queryFn: () => api.get(`/finance/budget/?shop_id=${shopId}`).then((r) => Array.isArray(r.data.data) ? r.data.data : []),
    enabled: !!shopId,
  });

  const { data: allocations, isLoading } = useQuery<BudgetAllocation[]>({
    queryKey: ["budget-allocations", shopId, month, year],
    queryFn: () => api.get(`/finance/budget/allocations/?shop_id=${shopId}&month=${month}&year=${year}`).then((r) => Array.isArray(r.data.data) ? r.data.data : []),
    enabled: !!shopId,
  });

  const allocMutation = useMutation({
    mutationFn: ({ head_id, budgeted_amount }: { head_id: string; budgeted_amount: string }) =>
      api.post("/finance/budget/allocations/", { head_id, month, year, budgeted_amount }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-allocations"] }),
  });

  return (
    <div className="space-y-4">
      {/* Month/year picker */}
      <div className="flex items-center gap-2">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} min={2020} max={2100}
          className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !heads?.length ? (
        <p className="text-sm text-gray-400 text-center py-8">No budget heads found. Create them first.</p>
      ) : (
        <div className="space-y-3">
          {heads.map((head) => {
            const alloc = allocations?.find((a) => a.head === head.id);
            const budgeted = parseFloat(alloc?.budgeted_amount ?? "0");
            const actual = parseFloat(alloc?.actual_amount ?? "0");
            const pct = budgeted > 0 ? Math.min((actual / budgeted) * 100, 100) : 0;
            const over = actual > budgeted && budgeted > 0;
            return (
              <div key={head.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{head.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{head.category}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-sm font-bold", over ? "text-red-600" : "text-gray-900")}>
                      {formatCurrency(actual)} / {formatCurrency(budgeted)}
                    </p>
                    {over && <p className="text-xs text-red-500">Over budget!</p>}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={cn("h-1.5 rounded-full transition-all", over ? "bg-red-500" : pct > 80 ? "bg-orange-400" : "bg-green-500")}
                    style={{ width: `${pct}%` }} />
                </div>
                {/* Budget setter */}
                <PermissionGate perm={PERMISSIONS.ERP_BUDGETS_MANAGE}>
                  <div className="mt-3 flex items-center gap-2">
                    <input type="number" step="100" min="0" placeholder="Set budget"
                      defaultValue={budgeted || ""}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== String(budgeted)) {
                          allocMutation.mutate({ head_id: head.id, budgeted_amount: e.target.value });
                        }
                      }}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-400">Budget ₹</span>
                  </div>
                </PermissionGate>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Assets Tab ────────────────────────────────────────────────────────────────

const assetSchema = z.object({
  name:                 z.string().min(1, "Name required"),
  category:             z.string().min(1, "Category required"),
  asset_code:           z.string().min(1, "Asset code required"),
  purchase_date:        z.string().min(1, "Purchase date required"),
  purchase_cost:        z.string().min(1, "Cost required"),
  warranty_expiry:      z.string().optional(),
  condition:            z.enum(["good", "fair", "poor", "under_repair"]),
  location_description: z.string().optional(),
  notes:                z.string().optional(),
});
type AssetForm = z.infer<typeof assetSchema>;

function AssetsTab() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const shopId = user?.shop_ids?.[0];
  const [showForm, setShowForm] = useState(false);
  const [condFilter, setCondFilter] = useState("");

  const { data: assets, isLoading } = useQuery<ShopAsset[]>({
    queryKey: ["assets", shopId, condFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (shopId) params.set("shop_id", shopId);
      if (condFilter) params.set("condition", condFilter);
      return api.get(`/finance/assets/?${params}`).then((r) => Array.isArray(r.data.data) ? r.data.data : []);
    },
    enabled: !!shopId,
  });

  const form = useForm<AssetForm>({
    resolver: zodResolver(assetSchema),
    defaultValues: { condition: "good" },
  });

  const createAsset = useMutation({
    mutationFn: (d: AssetForm) => api.post("/finance/assets/", { ...d, shop_id: shopId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); form.reset({ condition: "good" }); setShowForm(false); },
  });

  const updateCondition = useMutation({
    mutationFn: ({ id, condition }: { id: string; condition: AssetCondition }) =>
      api.patch(`/finance/assets/${id}/`, { condition }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={condFilter} onChange={(e) => setCondFilter(e.target.value)}
          className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="">All conditions</option>
          {Object.entries(CONDITION_CFG).map(([val, { label }]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <PermissionGate perm={PERMISSIONS.ERP_ASSETS_MANAGE}>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]">
            <Plus className="w-4 h-4" /> Add Asset
          </button>
        </PermissionGate>
      </div>

      {showForm && (
        <form onSubmit={form.handleSubmit((d) => createAsset.mutate(d))}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">New Asset</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" error={form.formState.errors.name?.message}>
              <input {...form.register("name")} placeholder="Laptop" className={inp(!!form.formState.errors.name)} />
            </Field>
            <Field label="Asset Code *" error={form.formState.errors.asset_code?.message}>
              <input {...form.register("asset_code")} placeholder="ASSET-001" className={inp(!!form.formState.errors.asset_code)} />
            </Field>
            <Field label="Category *" error={form.formState.errors.category?.message}>
              <input {...form.register("category")} placeholder="Electronics" className={inp(!!form.formState.errors.category)} />
            </Field>
            <Field label="Condition" error={undefined}>
              <select {...form.register("condition")} className={inp(false)}>
                {Object.entries(CONDITION_CFG).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </Field>
            <Field label="Purchase Date *" error={form.formState.errors.purchase_date?.message}>
              <input {...form.register("purchase_date")} type="date" className={inp(!!form.formState.errors.purchase_date)} />
            </Field>
            <Field label="Purchase Cost (₹) *" error={form.formState.errors.purchase_cost?.message}>
              <input {...form.register("purchase_cost")} type="number" step="0.01" min="0" className={inp(!!form.formState.errors.purchase_cost)} />
            </Field>
            <Field label="Warranty Expiry" error={undefined}>
              <input {...form.register("warranty_expiry")} type="date" className={inp(false)} />
            </Field>
            <Field label="Location" error={undefined}>
              <input {...form.register("location_description")} placeholder="Main office" className={inp(false)} />
            </Field>
          </div>
          {createAsset.isError && <p className="text-red-500 text-xs">Failed to save asset.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={createAsset.isPending}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {createAsset.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !assets?.length ? (
        <div className="text-center py-12 text-gray-400">
          <Package2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No assets registered</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => {
            const cond = CONDITION_CFG[asset.condition];
            return (
              <div key={asset.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-gray-900 truncate">{asset.name}</p>
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0", cond.cls)}>{cond.label}</span>
                      {!asset.is_active && <span className="text-xs text-gray-400 flex-shrink-0">Disposed</span>}
                    </div>
                    <p className="text-xs text-gray-500">{asset.category} · <span className="font-mono">{asset.asset_code}</span></p>
                    <p className="text-xs text-gray-400">{formatDate(asset.purchase_date)} · {asset.location_description || "—"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(asset.purchase_cost))}</p>
                    {asset.warranty_expiry && (
                      <p className="text-xs text-gray-400">Warranty till {formatDate(asset.warranty_expiry)}</p>
                    )}
                  </div>
                </div>
                {/* Inline condition update */}
                <PermissionGate perm={PERMISSIONS.ERP_ASSETS_MANAGE}>
                  <div className="mt-3 flex gap-1.5 flex-wrap">
                    {Object.entries(CONDITION_CFG).map(([v, { label, cls }]) => (
                      <button key={v}
                        onClick={() => updateCondition.mutate({ id: asset.id, condition: v as AssetCondition })}
                        className={cn(
                          "px-2 py-1 rounded-lg text-xs font-medium border transition",
                          asset.condition === v ? cls + " border-transparent" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                        )}>
                        {label}
                      </button>
                    ))}
                  </div>
                </PermissionGate>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
