'use client';

import { useEffect } from 'react';
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
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';

const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Puducherry','Chandigarh',
];

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

const brandingSchema = z.object({
  logo_url:            z.string().url('Invalid URL').or(z.literal('')).optional(),
  invoice_footer:      z.string().max(200).optional(),
  bank_name:           z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_ifsc:           z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC').or(z.literal('')).optional(),
});

type ShopForm    = z.infer<typeof shopSchema>;
type BrandForm   = z.infer<typeof brandingSchema>;

export default function ShopSettingsPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.shop.edit')) return <ForbiddenPage />;

  return <ShopSettingsInner />;
}

function ShopSettingsInner() {
  const qc = useQueryClient();
  const { activeShopId } = useActiveShopStore();

  const { data: shop, isLoading: shopLoading } = useQuery({
    queryKey: qk.shop(activeShopId ?? ''),
    queryFn: () => settingsApi.getShop(activeShopId ?? ''),
    enabled: !!activeShopId,
    staleTime: 60_000,
  });

  const { data: branding, isLoading: brandLoading } = useQuery({
    queryKey: ['tenant-branding'],
    queryFn: () => settingsApi.getTenantBranding(),
    staleTime: 60_000,
  });

  const shopForm = useForm<ShopForm>({ resolver: zodResolver(shopSchema) });
  const brandForm = useForm<BrandForm>({ resolver: zodResolver(brandingSchema) });

  useEffect(() => {
    if (shop) shopForm.reset({
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

  useEffect(() => {
    if (branding) brandForm.reset({
      logo_url:            branding.logo_url ?? '',
      invoice_footer:      branding.invoice_footer ?? '',
      bank_name:           branding.bank_name ?? '',
      bank_account_number: branding.bank_account_number ?? '',
      bank_ifsc:           branding.bank_ifsc ?? '',
    });
  }, [branding]); // eslint-disable-line react-hooks/exhaustive-deps

  const shopMutation = useMutation({
    mutationFn: (v: ShopForm) => settingsApi.updateShop(activeShopId ?? '', {
      ...v,
      email: v.email || undefined,
      gstin: v.gstin || undefined,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(qk.shop(activeShopId ?? ''), updated);
      toast.success('Shop profile saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const brandMutation = useMutation({
    mutationFn: (v: BrandForm) => settingsApi.updateTenantBranding({
      logo_url:            v.logo_url || undefined,
      invoice_footer:      v.invoice_footer || undefined,
      bank_name:           v.bank_name || undefined,
      bank_account_number: v.bank_account_number || undefined,
      bank_ifsc:           v.bank_ifsc || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-branding'] });
      toast.success('Branding saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const isLoading = shopLoading || brandLoading;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">Shop Profile</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          Affects job/invoice numbering, GST calculations, and customer-facing details.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <>
          {/* ── Shop fields ── */}
          <section>
            <h2 className="text-body font-semibold text-[var(--text)] mb-4">Shop details</h2>
            <Form {...shopForm}>
              <form onSubmit={shopForm.handleSubmit((v) => shopMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={shopForm.control} name="name" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Shop name *</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={shopForm.control} name="address" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Address *</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={shopForm.control} name="city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>City *</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={shopForm.control} name="state" render={({ field }) => (
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
                  <FormField control={shopForm.control} name="state_code" render={({ field }) => (
                    <FormItem>
                      <FormLabel>GST state code *</FormLabel>
                      <FormControl><Input maxLength={2} className="font-mono" placeholder="29" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={shopForm.control} name="gstin" render={({ field }) => (
                    <FormItem>
                      <FormLabel>GSTIN</FormLabel>
                      <FormControl><Input className="font-mono uppercase" placeholder="29AAAAA0000A1Z5" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={shopForm.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone *</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={shopForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <Can permission="settings.shop.edit">
                  <Button type="submit" disabled={shopMutation.isPending}>
                    {shopMutation.isPending ? 'Saving…' : 'Save shop details'}
                  </Button>
                </Can>
              </form>
            </Form>
          </section>

          <hr className="border-[var(--border)]" />

          {/* ── Branding / bank ── */}
          <section>
            <h2 className="text-body font-semibold text-[var(--text)] mb-4">Branding & bank details</h2>
            <Form {...brandForm}>
              <form onSubmit={brandForm.handleSubmit((v) => brandMutation.mutate(v))} className="space-y-4">
                <FormField control={brandForm.control} name="logo_url" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Logo URL</FormLabel>
                    <FormControl><Input type="url" placeholder="https://…/logo.png" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={brandForm.control} name="invoice_footer" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice footer note</FormLabel>
                    <FormControl><Input placeholder="Thank you for your business!" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField control={brandForm.control} name="bank_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bank name</FormLabel>
                      <FormControl><Input placeholder="HDFC Bank" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={brandForm.control} name="bank_account_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account number</FormLabel>
                      <FormControl><Input className="font-mono" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={brandForm.control} name="bank_ifsc" render={({ field }) => (
                    <FormItem>
                      <FormLabel>IFSC</FormLabel>
                      <FormControl><Input className="font-mono uppercase" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <Can permission="settings.shop.edit">
                  <Button type="submit" disabled={brandMutation.isPending}>
                    {brandMutation.isPending ? 'Saving…' : 'Save branding'}
                  </Button>
                </Can>
              </form>
            </Form>
          </section>
        </>
      )}
    </div>
  );
}
