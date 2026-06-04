'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Camera, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BarcodeScanner } from '@/components/shared/BarcodeScanner';
import { posApi, type ProductVariant, type SaleType } from '@/lib/api/pos';
import { money } from '@/lib/format/money';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

interface ProductSearchProps {
  shopId: string;
  saleType: SaleType;
  onAddToCart: (variant: ProductVariant) => void;
}

export function ProductSearch({ shopId, saleType, onAddToCart }: ProductSearchProps) {
  const [query, setQuery] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['product-search', debouncedQuery, shopId],
    queryFn: () => posApi.searchProducts(debouncedQuery, shopId),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const handleBarcode = useCallback(async (code: string) => {
    setScannerOpen(false);
    try {
      const variant = await posApi.lookupBarcode(code, shopId);
      onAddToCart(variant);
      toast.success(`Added: ${variant.product_name}`);
    } catch {
      toast.error(`No product found for barcode ${code}`);
    }
  }, [shopId, onAddToCart]);

  const variants = data?.items ?? [];
  const showResults = debouncedQuery.length >= 2;
  const price = (v: ProductVariant) => saleType === 'wholesale' ? v.wholesale_price : v.selling_price;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search product name, SKU…"
            className="pl-9 h-11"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => setScannerOpen(true)}
          title="Scan barcode"
        >
          <Camera className="h-5 w-5" />
        </Button>
      </div>

      {showResults && (
        <div className="absolute z-30 w-full mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : variants.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Package className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="text-body-sm text-[var(--text-muted)]">No products found</p>
            </div>
          ) : (
            <ul>
              {variants.map((v) => {
                const isOutOfStock = v.stock_quantity <= 0;
                const belowCost = price(v) < v.cost_price;
                return (
                  <li key={v.id}>
                    <button
                      className={cn(
                        'w-full text-left px-4 py-3 hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between gap-3 min-h-[56px]',
                        isOutOfStock && 'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => {
                        if (isOutOfStock) { toast.error('Out of stock'); return; }
                        onAddToCart(v);
                        setQuery('');
                      }}
                      disabled={isOutOfStock}
                    >
                      <div className="min-w-0">
                        <p className="text-body-sm font-medium text-[var(--text)] truncate">{v.product_name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {v.variant_name && `${v.variant_name} · `}
                          {v.sku && <span className="font-mono">{v.sku} · </span>}
                          {isOutOfStock ? (
                            <span className="text-[var(--danger)]">Out of stock</span>
                          ) : (
                            <span>{v.stock_quantity} in stock</span>
                          )}
                        </p>
                        {belowCost && !isOutOfStock && (
                          <p className="text-xs text-[var(--warning)]">⚠ Below cost price</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-body-sm font-semibold tabular-nums text-[var(--text)]">{money(price(v))}</p>
                        {v.tax_rate > 0 && (
                          <p className="text-xs text-[var(--text-muted)]">+{v.tax_rate}% GST</p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner onDetect={handleBarcode} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  );
}
