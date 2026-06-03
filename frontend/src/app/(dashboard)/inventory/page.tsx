"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Package, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, cn } from "@/lib/utils";
import type { Product } from "@/types/inventory";
import type { CursorPage } from "@/types/api";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";

async function fetchProducts(search: string, cursor: string): Promise<CursorPage<Product>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (cursor) params.set("cursor", cursor);
  const res = await api.get(`/inventory/products/?${params}`);
  return { data: res.data.data, meta: res.data.meta };
}

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-products", search, cursor],
    queryFn: () => fetchProducts(search, cursor),
    placeholderData: (prev) => prev,
  });

  const goNext = () => { if (!data?.meta?.next_cursor) return; setCursorStack(s => [...s, cursor]); setCursor(data.meta.next_cursor!); };
  const goPrev = () => { const p = cursorStack[cursorStack.length - 1] ?? ""; setCursorStack(s => s.slice(0, -1)); setCursor(p); };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">{data?.data?.length ?? 0} shown</p>
        </div>
        <PermissionGate perm={PERMISSIONS.ERP_INVENTORY_ADJUST}>
          <div className="flex gap-2">
            <Link
              href="/inventory/import"
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition min-h-[44px] flex items-center"
            >
              Import
            </Link>
            <Link
              href="/inventory/new"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </Link>
          </div>
        </PermissionGate>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, SKU, brand…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setCursor(""); setCursorStack([]); }}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Product list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : data?.data?.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No products found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.data?.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              expanded={expandedId === product.id}
              onToggle={() => setExpandedId(expandedId === product.id ? null : product.id)}
            />
          ))}
        </div>
      )}

      {(cursorStack.length > 0 || data?.meta?.next_cursor) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={goPrev} disabled={cursorStack.length === 0} className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">Previous</button>
          <button onClick={goNext} disabled={!data?.meta?.next_cursor} className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">Next</button>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  expanded,
  onToggle,
}: {
  product: Product;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lowStock = product.variants.some((v) => v.stock_qty <= v.reorder_level);
  const totalStock = product.variants.reduce((s, v) => s + v.stock_qty, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Package className="w-4 h-4 text-gray-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
              {lowStock && (
                <AlertTriangle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
              )}
            </div>
            <p className="text-xs text-gray-500">
              {product.brand ? `${product.brand} · ` : ""}{product.sku} · {product.variants.length} variant{product.variants.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-gray-900">{totalStock} units</p>
            <p className="text-xs text-gray-400">in stock</p>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {product.variants.map((variant) => (
            <div key={variant.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm text-gray-800">{variant.variant_name}</p>
                <p className="text-xs text-gray-500">{variant.sku}</p>
              </div>
              <div className="flex items-center gap-6 text-right">
                <div>
                  <p className="text-xs text-gray-500">Cost</p>
                  <p className="text-sm text-gray-700">{formatCurrency(parseFloat(variant.buying_price))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Price</p>
                  <p className="text-sm font-medium text-gray-900">{formatCurrency(parseFloat(variant.selling_price))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Stock</p>
                  <p className={cn(
                    "text-sm font-semibold",
                    variant.stock_qty <= variant.reorder_level ? "text-red-600" : "text-green-700"
                  )}>
                    {variant.stock_qty}
                  </p>
                </div>
              </div>
            </div>
          ))}
          <div className="px-4 py-2 flex justify-end">
            <Link
              href={`/inventory/${product.id}`}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Edit product →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
