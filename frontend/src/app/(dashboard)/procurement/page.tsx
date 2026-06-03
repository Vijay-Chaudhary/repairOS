"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, TruckIcon, Package } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDate, cn } from "@/lib/utils";
import type { CursorPage } from "@/types/api";

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_name: string;
  status: "draft" | "sent" | "partially_received" | "received" | "cancelled";
  expected_delivery_date: string | null;
  notes: string | null;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gstin: string | null;
  city: string | null;
  outstanding_balance: string;
  created_at: string;
}

const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-gray-100 text-gray-700" },
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-700" },
  partially_received: { label: "Partial", cls: "bg-yellow-100 text-yellow-700" },
  received: { label: "Received", cls: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-700" },
};

type Tab = "orders" | "suppliers";

export default function ProcurementPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [search, setSearch] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Procurement</h1>
        <Link
          href={tab === "orders" ? "/procurement/orders/new" : "/procurement/suppliers/new"}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          {tab === "orders" ? "New PO" : "Add Supplier"}
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {(["orders", "suppliers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-sm font-medium rounded-md transition",
              tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            {t === "orders" ? "Purchase Orders" : "Suppliers"}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder={tab === "orders" ? "Search POs…" : "Search suppliers…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {tab === "orders" ? (
        <POList search={search} />
      ) : (
        <SupplierList search={search} />
      )}
    </div>
  );
}

function POList({ search }: { search: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["purchase-orders", search],
    queryFn: async (): Promise<CursorPage<PurchaseOrder>> => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await api.get(`/procurement/purchase-orders/?${params}`);
      return { data: res.data.data, meta: res.data.meta };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data?.data?.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <TruckIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No purchase orders found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.data.map((po) => {
        const status = PO_STATUS[po.status] ?? { label: po.status, cls: "bg-gray-100 text-gray-700" };
        return (
          <Link
            key={po.id}
            href={`/procurement/orders/${po.id}`}
            className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-gray-400">{po.po_number}</span>
                <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", status.cls)}>
                  {status.label}
                </span>
              </div>
              <p className="text-sm font-medium text-gray-900 truncate">{po.supplier_name}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-400">{formatDate(po.created_at)}</p>
              {po.expected_delivery_date && (
                <p className="text-xs text-gray-500">ETA: {formatDate(po.expected_delivery_date)}</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function SupplierList({ search }: { search: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", search],
    queryFn: async (): Promise<CursorPage<Supplier>> => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await api.get(`/procurement/suppliers/?${params}`);
      return { data: res.data.data, meta: res.data.meta };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data?.data?.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No suppliers found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.data.map((supplier) => {
        const outstanding = parseFloat(supplier.outstanding_balance);
        return (
          <Link
            key={supplier.id}
            href={`/procurement/suppliers/${supplier.id}`}
            className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{supplier.name}</p>
              <p className="text-xs text-gray-500">{supplier.phone} {supplier.city ? `· ${supplier.city}` : ""}</p>
            </div>
            {outstanding > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 bg-red-100 text-red-700 rounded-full flex-shrink-0">
                ₹{outstanding.toLocaleString("en-IN")} due
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
