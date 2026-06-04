'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ProductForm } from '@/components/inventory/ProductForm';
import { inventoryApi } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';

export default function ProductEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const { data: product, isLoading } = useQuery({
    queryKey: qk.product(id),
    queryFn: () => inventoryApi.getProduct(id),
    enabled: !isNew,
    staleTime: 60_000,
  });

  if (!isNew && isLoading) {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isNew && !product) {
    return (
      <EmptyState
        icon={Package}
        title="Product not found"
        action={{ label: 'Back to products', onClick: () => router.push('/products') }}
      />
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-h1 text-[var(--text)]">{isNew ? 'New product' : (product?.name ?? 'Edit product')}</h1>
      </div>

      <ProductForm
        product={isNew ? null : product}
        onSuccess={() => router.push('/products')}
      />
    </div>
  );
}
