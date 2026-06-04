'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { inventoryApi, TAX_RATES, type Product, type ProductVariant } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const productSchema = z.object({
  name: z.string().min(2, 'Name required'),
  sku: z.string().min(1, 'SKU required'),
  brand: z.string().optional(),
  hsn_code: z.string().optional(),
  default_tax_rate: z.number(),
  is_for_sale: z.boolean(),
  is_for_repair_use: z.boolean(),
  description: z.string().optional(),
  category_id: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface VariantRow {
  localId: string;
  id?: string;
  variant_name: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  wholesale_price: number;
  is_active: boolean;
  isDirty: boolean;
}

interface ProductFormProps {
  product?: Product | null;
  onSuccess?: (p: Product) => void;
}

export function ProductForm({ product, onSuccess }: ProductFormProps) {
  const queryClient = useQueryClient();

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => inventoryApi.listCategories(),
    staleTime: 300_000,
  });
  const categories = categoriesData?.items ?? [];

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? {
          name: product.name,
          sku: product.sku,
          brand: product.brand ?? '',
          hsn_code: product.hsn_code ?? '',
          default_tax_rate: product.default_tax_rate,
          is_for_sale: product.is_for_sale,
          is_for_repair_use: product.is_for_repair_use,
          description: product.description ?? '',
          category_id: product.category_id ?? '',
        }
      : {
          name: '', sku: '', brand: '', hsn_code: '',
          default_tax_rate: 18, is_for_sale: true, is_for_repair_use: false,
          description: '', category_id: '',
        },
  });

  const [variants, setVariants] = useState<VariantRow[]>(
    (product?.variants ?? []).map((v) => ({
      localId: v.id,
      id: v.id,
      variant_name: v.variant_name,
      barcode: v.barcode ?? '',
      cost_price: v.cost_price,
      selling_price: v.selling_price,
      wholesale_price: v.wholesale_price ?? 0,
      is_active: v.is_active,
      isDirty: false,
    })),
  );

  const productMutation = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const body = {
        name: values.name,
        sku: values.sku,
        brand: values.brand || undefined,
        hsn_code: values.hsn_code || undefined,
        default_tax_rate: values.default_tax_rate,
        is_for_sale: values.is_for_sale,
        is_for_repair_use: values.is_for_repair_use,
        description: values.description || undefined,
        category_id: values.category_id || undefined,
      };
      return product
        ? inventoryApi.updateProduct(product.id, body)
        : inventoryApi.createProduct(body);
    },
    onSuccess: async (savedProduct) => {
      // Save dirty variants
      const dirtyRows = variants.filter((v) => v.isDirty);
      await Promise.all(dirtyRows.map(async (row) => {
        const varBody = {
          variant_name: row.variant_name,
          barcode: row.barcode || undefined,
          cost_price: row.cost_price,
          selling_price: row.selling_price,
          wholesale_price: row.wholesale_price || undefined,
          is_active: row.is_active,
        };
        if (row.id) {
          await inventoryApi.updateVariant(row.id, varBody);
        } else {
          await inventoryApi.createVariant(savedProduct.id, varBody);
        }
      }));

      queryClient.invalidateQueries({ queryKey: qk.products() });
      toast.success(product ? 'Product updated' : 'Product created');
      onSuccess?.(savedProduct);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed'),
  });

  function addVariant() {
    setVariants((prev) => [...prev, {
      localId: `new-${Date.now()}`,
      variant_name: '',
      barcode: '',
      cost_price: 0,
      selling_price: 0,
      wholesale_price: 0,
      is_active: true,
      isDirty: true,
    }]);
  }

  function updateVariant(localId: string, field: keyof VariantRow, value: string | number | boolean) {
    setVariants((prev) => prev.map((v) =>
      v.localId === localId ? { ...v, [field]: value, isDirty: true } : v,
    ));
  }

  function removeVariant(localId: string) {
    setVariants((prev) => prev.filter((v) => v.localId !== localId));
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => productMutation.mutate(v))} className="space-y-6">
        {/* Product fields */}
        <div className="space-y-4">
          <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">Product details</h2>

          <div className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Product name *</FormLabel>
                <FormControl><Input placeholder="iPhone Battery" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="sku" render={({ field }) => (
              <FormItem>
                <FormLabel>SKU *</FormLabel>
                <FormControl><Input placeholder="IPH-BAT-15" className="font-mono" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="brand" render={({ field }) => (
              <FormItem>
                <FormLabel>Brand</FormLabel>
                <FormControl><Input placeholder="Apple, Samsung…" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="hsn_code" render={({ field }) => (
              <FormItem>
                <FormLabel>HSN code</FormLabel>
                <FormControl><Input placeholder="85177090" className="font-mono" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="default_tax_rate" render={({ field }) => (
              <FormItem>
                <FormLabel>Tax rate</FormLabel>
                <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {TAX_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}% GST</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="is_for_sale" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
                <FormLabel className="font-medium">For sale (POS)</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="is_for_repair_use" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
                <FormLabel className="font-medium">For repair use</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </div>
        </div>

        <Separator />

        {/* Variants */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">Variants</h2>
            <Button type="button" size="sm" variant="outline" onClick={addVariant}>
              <Plus className="h-3.5 w-3.5" /> Add variant
            </Button>
          </div>

          {variants.length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)] py-4 text-center">
              No variants — add at least one to set pricing.
            </p>
          ) : (
            <div className="space-y-3">
              {variants.map((row) => (
                <div key={row.localId} className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      placeholder="Variant name (e.g. Black 256GB)"
                      value={row.variant_name}
                      onChange={(e) => updateVariant(row.localId, 'variant_name', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Barcode"
                      value={row.barcode}
                      onChange={(e) => updateVariant(row.localId, 'barcode', e.target.value)}
                      className="w-36 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeVariant(row.localId)}
                      className="text-[var(--text-muted)] hover:text-[var(--danger)] p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1">Cost price</p>
                      <MoneyInput value={row.cost_price} onChange={(v) => updateVariant(row.localId, 'cost_price', v)} />
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1">Selling price</p>
                      <MoneyInput value={row.selling_price} onChange={(v) => updateVariant(row.localId, 'selling_price', v)} />
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1">Wholesale</p>
                      <MoneyInput value={row.wholesale_price} onChange={(v) => updateVariant(row.localId, 'wholesale_price', v)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={productMutation.isPending}>
          <Save className="h-4 w-4" />
          {productMutation.isPending ? 'Saving…' : product ? 'Save changes' : 'Create product'}
        </Button>
      </form>
    </Form>
  );
}
