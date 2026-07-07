'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Can } from '@/components/shared/Can';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import { settingsApi } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { INDIA_STATES, GST_STATE_CODE_MAP } from '@/lib/constants/gstStates';

const createShopSchema = z.object({
  name:       z.string().min(2, 'Required'),
  code:       z.string().max(10, 'Max 10 characters').optional(),
  address:    z.string().min(1, 'Required'),
  city:       z.string().min(1, 'Required'),
  state:      z.string().min(1, 'Required'),
  state_code: z.string().min(2).max(2, 'Must be 2 digits'),
  phone:      z.string().regex(/^\+91[0-9]{10}$/, '+91XXXXXXXXXX'),
});
type CreateShopForm = z.infer<typeof createShopSchema>;

const brandingSchema = z.object({
  logo_url:            z.string().url('Invalid URL').or(z.literal('')).optional(),
  invoice_footer:      z.string().max(200).optional(),
  bank_name:           z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_ifsc:           z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC').or(z.literal('')).optional(),
});
type BrandForm = z.infer<typeof brandingSchema>;

const EMPTY_CREATE_FORM: CreateShopForm = {
  name: '', code: '', address: '', city: '', state: '', state_code: '', phone: '',
};

export default function ShopsPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.shop.edit')) return <ForbiddenPage />;
  return <ShopsPageInner />;
}

function ShopsPageInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const { setShops } = useActiveShopStore();
  const [addOpen, setAddOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const { data: shops, isLoading } = useQuery({
    queryKey: qk.shops(),
    queryFn: () => settingsApi.listShops(),
    staleTime: 30_000,
  });

  const { data: branding, isLoading: brandLoading } = useQuery({
    queryKey: qk.tenantBranding(),
    queryFn: () => settingsApi.getTenantBranding(),
    staleTime: 60_000,
  });

  const form = useForm<CreateShopForm>({
    resolver: zodResolver(createShopSchema),
    defaultValues: EMPTY_CREATE_FORM,
  });

  const brandForm = useForm<BrandForm>({ resolver: zodResolver(brandingSchema) });

  useEffect(() => {
    if (branding) brandForm.reset({
      logo_url:            branding.logo_url ?? '',
      invoice_footer:      branding.invoice_footer ?? '',
      bank_name:           branding.bank_name ?? '',
      bank_account_number: branding.bank_account_number ?? '',
      bank_ifsc:           branding.bank_ifsc ?? '',
    });
  }, [branding]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (v: CreateShopForm) => settingsApi.createShop({ ...v, code: v.code || undefined }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.shops() });
      const allShops = await settingsApi.listShops();
      setShops(allShops);
      toast.success('Shop created');
      form.reset(EMPTY_CREATE_FORM);
      setDialogError(null);
      setAddOpen(false);
    },
    onError: (e) => setDialogError(e instanceof ApiError ? e.message : 'Failed to create shop.'),
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
      qc.invalidateQueries({ queryKey: qk.tenantBranding() });
      toast.success('Branding saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Shops</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Each shop has its own job/invoice numbering and GST details.
          </p>
        </div>
        <Can permission="settings.branches.manage">
          <Button size="sm" onClick={() => { setDialogError(null); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add shop</span>
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <div className="space-y-2">
          {(shops ?? []).map((shop) => (
            <button
              key={shop.id}
              type="button"
              onClick={() => router.push(`/settings/shops/${shop.id}`)}
              className="w-full flex items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--surface-2)] transition-colors"
            >
              <Building2 className="h-5 w-5 text-[var(--text-muted)] shrink-0" />
              <div>
                <p className="font-medium text-[var(--text)]">{shop.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{shop.code} · {shop.city}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <hr className="border-[var(--border)]" />

      <section>
        <h2 className="text-body font-semibold text-[var(--text)] mb-4">Branding & bank details</h2>
        {brandLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
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
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add shop</DialogTitle></DialogHeader>
          {dialogError && (
            <p className="text-body-sm text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/25 rounded-md px-3 py-2">
              {dialogError}
            </p>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Shop name *</FormLabel>
                  <FormControl><Input placeholder="Sunrise Repairs - Whitefield" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl><Input placeholder="Auto-generated if left blank" className="font-mono uppercase" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Address *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
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
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                    <FormControl>
                      <Input
                        maxLength={2}
                        className="font-mono"
                        placeholder="29"
                        {...field}
                        onChange={(e) => {
                          const code = e.target.value;
                          field.onChange(code);
                          const mapped = GST_STATE_CODE_MAP[code];
                          if (mapped) form.setValue('state', mapped, { shouldValidate: true });
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create shop'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
