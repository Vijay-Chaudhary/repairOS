"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import type { CartItem } from "@/types/pos";

// ── Product search ─────────────────────────────────────────────────────────

interface ProductVariant {
  id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  selling_price: string;
  gst_rate: string;
  hsn_code: string | null;
  stock_qty: number;
}

async function searchProducts(q: string): Promise<ProductVariant[]> {
  if (q.length < 2) return [];
  const res = await api.get(`/inventory/variants/?search=${encodeURIComponent(q)}&page_size=10`);
  return res.data.data?.results ?? [];
}

// ── POS Page ───────────────────────────────────────────────────────────────

export default function POSPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi" | "card">("cash");
  const [amountTendered, setAmountTendered] = useState("");
  const [showPayment, setShowPayment] = useState(false);

  const { data: products, isLoading: searching } = useQuery({
    queryKey: ["product-search", search],
    queryFn: () => searchProducts(search),
    enabled: search.length >= 2,
  });

  const addToCart = useCallback((variant: ProductVariant) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.variant_id === variant.id);
      if (idx >= 0) {
        return prev.map((item, i) =>
          i === idx ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          variant_id: variant.id,
          product_name: variant.product_name,
          variant_name: variant.variant_name,
          sku: variant.sku,
          quantity: 1,
          unit_price: parseFloat(variant.selling_price),
          tax_rate: parseFloat(variant.gst_rate),
          hsn_code: variant.hsn_code,
        },
      ];
    });
    setSearch("");
  }, []);

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item, i) => (i === idx ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const removeItem = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  };

  // Totals
  const subtotal = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const taxTotal = cart.reduce((s, i) => s + (i.unit_price * i.quantity * i.tax_rate) / 100, 0);
  const grandTotal = subtotal + taxTotal;
  const change = parseFloat(amountTendered || "0") - grandTotal;

  const saleMutation = useMutation({
    mutationFn: () =>
      api.post("/pos/sales/", {
        shop_id: user?.shop_ids?.[0],
        sale_type: "counter",
        items: cart.map((item) => ({
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_type: "none",
          discount_value: "0",
          tax_rate: item.tax_rate,
        })),
        payments: [{ method: paymentMethod, amount: grandTotal.toFixed(2) }],
      }),
    onSuccess: () => {
      setCart([]);
      setAmountTendered("");
      setShowPayment(false);
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-6rem)]">
      {/* ── Left: Product search ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-gray-900">POS Sale</h1>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search product or scan barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        </div>

        {/* Search results */}
        {search.length >= 2 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {searching ? (
              <p className="text-sm text-gray-500 p-4 text-center">Searching…</p>
            ) : products?.length === 0 ? (
              <p className="text-sm text-gray-500 p-4 text-center">No products found</p>
            ) : (
              products?.map((v) => (
                <button
                  key={v.id}
                  onClick={() => addToCart(v)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0 text-left transition"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{v.product_name}</p>
                    <p className="text-xs text-gray-500">{v.variant_name} · {v.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(parseFloat(v.selling_price))}
                    </p>
                    <p className="text-xs text-gray-400">Qty: {v.stock_qty}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Recent sales quick-access */}
        {cart.length === 0 && search.length < 2 && (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Search for products to add to cart</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Cart ──────────────────────────────────────────────── */}
      <div className="w-full md:w-80 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Cart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-900">
              Cart ({cart.length} items)
            </span>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Clear
            </button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {cart.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              Cart is empty
            </div>
          ) : (
            cart.map((item, idx) => (
              <div key={item.variant_id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.product_name}</p>
                    <p className="text-xs text-gray-500 truncate">{item.variant_name}</p>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-gray-400 hover:text-red-500 transition flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateQty(idx, -1)}
                      className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateQty(idx, 1)}
                      className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrency(item.unit_price * item.quantity)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totals */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>GST</span>
              <span>{formatCurrency(taxTotal)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-gray-100">
              <span>Total</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        )}

        {/* Payment section */}
        {cart.length > 0 && !showPayment && (
          <div className="p-3 border-t border-gray-100">
            <button
              onClick={() => setShowPayment(true)}
              className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2 min-h-[44px]"
            >
              <CreditCard className="w-4 h-4" />
              Charge {formatCurrency(grandTotal)}
            </button>
          </div>
        )}

        {showPayment && (
          <div className="p-3 border-t border-gray-100 space-y-3">
            {/* Method selector */}
            <div className="grid grid-cols-3 gap-1">
              {(["cash", "upi", "card"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    "py-2 rounded-lg text-xs font-medium border transition",
                    paymentMethod === m
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  )}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>

            {paymentMethod === "cash" && (
              <div>
                <input
                  type="number"
                  placeholder="Amount tendered"
                  value={amountTendered}
                  onChange={(e) => setAmountTendered(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                {parseFloat(amountTendered) >= grandTotal && (
                  <p className="text-xs text-green-600 mt-1">
                    Change: {formatCurrency(change)}
                  </p>
                )}
              </div>
            )}

            {saleMutation.isError && (
              <p className="text-xs text-red-500">Failed to complete sale. Try again.</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowPayment(false)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                Back
              </button>
              <button
                onClick={() => saleMutation.mutate()}
                disabled={saleMutation.isPending}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {saleMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
