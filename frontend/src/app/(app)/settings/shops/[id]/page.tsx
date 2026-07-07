'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Can } from '@/components/shared/Can';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import { settingsApi } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { INDIA_STATES } from '@/lib/constants/gstStates';

const shopSchema = z.object({
  name:       z.string().min(2, 'Required'),
  address:    z.string().min(3, 'Required'),
  city:       z.string().min(2, 'Required'),
  state:      z.string().min(2, 'Required'),
  state_code: z.string().min(2).max(2, 'Must be 2 digits'),
  phone:      z.string().regex(/^\+91[0-9]{10}$/, '+91XXXXXXXXXX'),
  email:      z.string().email('Invalid email').or(z.literal('')).optional(),
  gstin:      z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN').or(z.literal('')).optional(),
});
type ShopForm = z.infer<typeof shopSchema>;

export default function ShopDetailPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.shop.edit')) return <ForbiddenPage />;
  return <ShopDetailInner />;
}

function ShopDetailInner() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: shop, isLoading } = useQuery({
    queryKey: qk.shop(id),
    queryFn: () => settingsApi.getShop(id),
    staleTime: 60_000,
  });

  const form = useForm<ShopForm>({ resolver: zodResolver(shopSchema) });

  useEffect(() => {
    if (shop) form.reset({
      name:       shop.name,
      address:    shop.address,
      city:       shop.city,
      state:      shop.state,
      state_code: shop.state_code,
      phone:      shop.phone,
      email:      shop.email ?? '',
      gstin:      shop.gstin ?? '',
    });
  }, [shop]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (v: ShopForm) => settingsApi.updateShop(id, {
      ...v,
      email: v.email || undefined,
      gstin: v.gstin || undefined,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(qk.shop(id), updated);
      qc.invalidateQueries({ queryKey: qk.shops() });
      toast.success('Shop profile saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">{shop?.name ?? 'Shop'}</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          Affects job/invoice numbering, GST calculations, and customer-facing details.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Shop name *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>City *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem>
                  <FormLabel>State *</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="Select state…" /></SelectTrigger>
                      <SelectContent>
                        {INDIA_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="state_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>GST state code *</FormLabel>
                  <FormControl><Input maxLength={2} className="font-mono" placeholder="29" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="gstin" render={({ field }) => (
                <FormItem>
                  <FormLabel>GSTIN</FormLabel>
                  <FormControl><Input className="font-mono uppercase" placeholder="29AAAAA0000A1Z5" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <Can permission="settings.shop.edit">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save shop details'}
              </Button>
            </Can>
          </form>
        </Form>
      )}
    </div>
  );
}
