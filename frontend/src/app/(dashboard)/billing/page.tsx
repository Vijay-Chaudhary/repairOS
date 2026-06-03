"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Receipt, ShoppingCart, FileText } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { RepairInvoiceSummary, SaleSummary, InvoiceStatus } from "@/types/billing";
import type { CursorPage } from "@/types/api";

// ── Status display helpers ────────────────────────────────────────────────────

const INV_STATUS: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft:           { label: "Draft",          cls: "bg-gray-100 text-gray-700" },
  issued:          { label: "Issued",          cls: "bg-blue-100 text-blue-700" },
  partially_paid:  { label: "Part Paid",       cls: "bg-yellow-100 text-yellow-700" },
  paid:            { label: "Paid",            cls: "bg-green-100 text-green-700" },
  cancelled:       { label: "Cancelled",       cls: "bg-red-100 text-red-700" },
};

const SALE_STATUS: Record<string, { label: string; cls: string }> = {
  draft:           { label: "Draft",          cls: "bg-gray-100 text-gray-700" },
  completed:       { label: "Completed",       cls: "bg-green-100 text-green-700" },
  partially_paid:  { label: "Part Paid",       cls: "bg-yellow-100 text-yellow-700" },
  cancelled:       { label: "Cancelled",       cls: "bg-red-100 text-red-700" },
  returned:        { label: "Returned",        cls: "bg-orange-100 text-orange-700" },
};

type Tab = "invoices" | "sales";

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchInvoices(
  search: string,
  status: string,
  cursor: string
): Promise<CursorPage<RepairInvoiceSummary>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const res = await api.get(`/billing/repair-invoices/?${params}`);
  return { data: res.data.data, meta: res.data.meta };
}

async function fetchSales(
  search: string,
  cursor: string
): Promise<CursorPage<SaleSummary>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (cursor) params.set("cursor", cursor);
  const res = await api.get(`/pos/sales/?${params}`);
  return { data: res.data.data, meta: res.data.meta };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [tab, setTab] = useState<Tab>("invoices");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const resetCursor = () => { setCursor(""); setCursorStack([]); };

  const invoicesQuery = useQuery({
    queryKey: ["invoices", search, statusFilter, cursor],
    queryFn: () => fetchInvoices(search, statusFilter, cursor),
    enabled: tab === "invoices",
    placeholderData: (prev) => prev,
  });

  const salesQuery = useQuery({
    queryKey: ["sales-list", search, cursor],
    queryFn: () => fetchSales(search, cursor),
    enabled: tab === "sales",
    placeholderData: (prev) => prev,
  });

  const activeQuery = tab === "invoices" ? invoicesQuery : salesQuery;
  const isLoading = activeQuery.isLoading;
  const meta = activeQuery.data?.meta;

  const goNext = () => {
    if (!meta?.next_cursor) return;
    setCursorStack((s) => [...s, cursor]);
    setCursor(meta.next_cursor!);
  };
  const goPrev = () => {
    const prev = cursorStack[cursorStack.length - 1] ?? "";
    setCursorStack((s) => s.slice(0, -1));
    setCursor(prev);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Billing</h1>
        <Link
          href="/billing/tally-export"
          className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition min-h-[44px]"
        >
          <FileText className="w-4 h-4" />
          Tally Export
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        <TabBtn active={tab === "invoices"} onClick={() => { setTab("invoices"); resetCursor(); setSearch(""); setStatusFilter(""); }}>
          <Receipt className="w-4 h-4" /> Repair Invoices
        </TabBtn>
        <TabBtn active={tab === "sales"} onClick={() => { setTab("sales"); resetCursor(); setSearch(""); }}>
          <ShoppingCart className="w-4 h-4" /> POS Sales
        </TabBtn>
      </div>

      {/* Search + filter row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={tab === "invoices" ? "Search invoice#, customer…" : "Search sale#, customer…"}
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetCursor(); }}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {tab === "invoices" && (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); resetCursor(); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All statuses</option>
            {Object.entries(INV_STATUS).map(([val, { label }]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : tab === "invoices" ? (
        <InvoiceList items={invoicesQuery.data?.data ?? []} />
      ) : (
        <SaleList items={salesQuery.data?.data ?? []} />
      )}

      {/* Cursor pagination */}
      {(cursorStack.length > 0 || meta?.next_cursor) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={goPrev} disabled={cursorStack.length === 0}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">
            Previous
          </button>
          <button onClick={goNext} disabled={!meta?.next_cursor}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition",
        active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
      )}
    >
      {children}
    </button>
  );
}

function InvoiceList({ items }: { items: RepairInvoiceSummary[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No invoices found</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((inv) => {
        const s = INV_STATUS[inv.status] ?? { label: inv.status, cls: "bg-gray-100 text-gray-700" };
        const outstanding = parseFloat(inv.amount_outstanding);
        return (
          <Link
            key={inv.id}
            href={`/billing/${inv.id}`}
            className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{inv.invoice_number}</span>
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s.cls)}>
                    {s.label}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{inv.customer_name}</p>
                <p className="text-xs text-gray-500">Job: {inv.job_number}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(inv.grand_total))}</p>
                {outstanding > 0 && (
                  <p className="text-xs text-red-500 font-medium">{formatCurrency(outstanding)} due</p>
                )}
                <p className="text-xs text-gray-400">{formatDate(inv.created_at)}</p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function SaleList({ items }: { items: SaleSummary[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No sales found</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((sale) => {
        const s = SALE_STATUS[sale.status] ?? { label: sale.status, cls: "bg-gray-100 text-gray-700" };
        const balance = parseFloat(sale.balance_due);
        return (
          <Link
            key={sale.id}
            href={`/pos/sales/${sale.id}`}
            className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{sale.sale_number}</span>
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s.cls)}>
                    {s.label}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">
                  {sale.customer_name ?? "Walk-in Customer"}
                </p>
                <p className="text-xs text-gray-500 capitalize">{sale.sale_type.replace("_", " ")}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(sale.grand_total))}</p>
                {balance > 0 && (
                  <p className="text-xs text-red-500 font-medium">{formatCurrency(balance)} due</p>
                )}
                <p className="text-xs text-gray-400">{formatDate(sale.sale_date)}</p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
