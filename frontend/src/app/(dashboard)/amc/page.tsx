"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Shield, AlertTriangle, Calendar } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { AMCContractSummary, ContractStatus } from "@/types/amc";
import type { CursorPage } from "@/types/api";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ContractStatus, { label: string; cls: string }> = {
  active:           { label: "Active",          cls: "bg-green-100 text-green-700" },
  expired:          { label: "Expired",          cls: "bg-gray-100 text-gray-600" },
  cancelled:        { label: "Cancelled",        cls: "bg-red-100 text-red-700" },
  pending_renewal:  { label: "Renewal Due",      cls: "bg-yellow-100 text-yellow-700" },
};

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchContracts(
  search: string,
  statusFilter: string,
  cursor: string
): Promise<CursorPage<AMCContractSummary>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (statusFilter) params.set("status", statusFilter);
  if (cursor) params.set("cursor", cursor);
  const res = await api.get(`/amc/contracts/?${params}`);
  return { data: res.data.data, meta: res.data.meta };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AMCPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["amc-contracts", search, statusFilter, cursor],
    queryFn: () => fetchContracts(search, statusFilter, cursor),
    placeholderData: (prev) => prev,
  });

  const resetCursor = () => { setCursor(""); setCursorStack([]); };
  const goNext = () => {
    if (!data?.meta?.next_cursor) return;
    setCursorStack((s) => [...s, cursor]);
    setCursor(data.meta.next_cursor!);
  };
  const goPrev = () => {
    const prev = cursorStack[cursorStack.length - 1] ?? "";
    setCursorStack((s) => s.slice(0, -1));
    setCursor(prev);
  };

  // Contract stats from list
  const active    = data?.data?.filter((c) => c.status === "active").length ?? 0;
  const renewing  = data?.data?.filter((c) => c.status === "pending_renewal").length ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AMC</h1>
          <p className="text-sm text-gray-500">
            {active} active · {renewing > 0 ? (
              <span className="text-yellow-600 font-medium">{renewing} renewal due</span>
            ) : "all current"}
          </p>
        </div>
        <PermissionGate perm={PERMISSIONS.AMC_CONTRACTS_CREATE}>
          <Link
            href="/amc/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            New Contract
          </Link>
        </PermissionGate>
      </div>

      {/* Search + status filter */}
      <div className="flex gap-2 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by title, customer, contract#…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetCursor(); }}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); resetCursor(); }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([val, { label }]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Contract list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : data?.data?.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No AMC contracts found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.data?.map((contract) => (
            <ContractCard key={contract.id} contract={contract} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(cursorStack.length > 0 || data?.meta?.next_cursor) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={goPrev} disabled={cursorStack.length === 0}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">
            Previous
          </button>
          <button onClick={goNext} disabled={!data?.meta?.next_cursor}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ── Contract card ─────────────────────────────────────────────────────────────

function ContractCard({ contract }: { contract: AMCContractSummary }) {
  const cfg = STATUS_CONFIG[contract.status] ?? STATUS_CONFIG.active;
  const today = new Date();
  const endDate = new Date(contract.end_date);
  const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const expiringSoon = daysLeft > 0 && daysLeft <= 30;

  return (
    <Link
      href={`/amc/${contract.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono text-gray-400">{contract.contract_number}</span>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", cfg.cls)}>
              {cfg.label}
            </span>
            {expiringSoon && (
              <span className="flex items-center gap-1 text-xs text-yellow-600">
                <AlertTriangle className="w-3 h-3" />
                {daysLeft}d left
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900 truncate">{contract.title}</p>
          <p className="text-xs text-gray-500 truncate">{contract.customer_name}</p>
        </div>
        <div className="text-right flex-shrink-0 space-y-1">
          <p className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(contract.value))}</p>
          <div className="flex items-center gap-1 justify-end text-xs text-gray-400">
            <Calendar className="w-3 h-3" />
            <span>{contract.visits_per_year > 0 ? `${contract.visits_per_year} visits/yr` : "No visits"}</span>
          </div>
          <p className="text-xs text-gray-400">Ends {formatDate(contract.end_date)}</p>
        </div>
      </div>
    </Link>
  );
}
