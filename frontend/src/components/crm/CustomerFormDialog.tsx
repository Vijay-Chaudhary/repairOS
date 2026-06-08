'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { TagInput } from '@/components/crm/TagInput';
import { crmApi, type Customer } from '@/lib/api/crm';
import { ApiError } from '@/lib/api/client';
import { normalizePhone } from '@/lib/format/phone';

export const customerSchema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().min(10, 'Valid phone required'),
  alternate_phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  customer_type: z.enum(['individual', 'business']),
  gstin: z.string().optional(),
  credit_limit: z.number().min(0),
  tags: z.array(z.string()),
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shopId: string;
  existing?: Customer;
  onSuccess: (c: Customer) => void;
}

export function CustomerFormDialog({
  open, onOpenChange, shopId, existing, onSuccess,
}: CustomerFormDialogProps) {
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          phone: existing.phone,
          alternate_phone: existing.alternate_phone ?? '',
          email: existing.email ?? '',
          address: existing.address ?? '',
          city: existing.city ?? '',
          customer_type: existing.customer_type,
          gstin: existing.gstin ?? '',
          credit_limit: existing.credit_limit,
          tags: existing.tags,
        }
      : { name: '', phone: '', alternate_phone: '', email: '', address: '', city: '', customer_type: 'individual', gstin: '', credit_limit: 0, tags: [] },
  });

  const customerType = form.watch('customer_type');

  const mutation = useMutation({
    mutationFn: (values: CustomerFormValues) => {
      const body = {
        name: values.name,
        phone: normalizePhone(values.phone),
        alternate_phone: values.alternate_phone ? normalizePhone(values.alternate_phone) : undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        city: values.city || undefined,
        gstin: values.gstin || undefined,
        customer_type: values.customer_type,
        credit_limit: values.credit_limit,
        tags: values.tags,
      };
      return existing
        ? crmApi.updateCustomer(existing.id, body)
        : crmApi.createCustomer({ ...body, shop_id: shopId });
    },
    onSuccess: (customer) => {
      toast.success(existing ? 'Customer updated' : 'Customer created');
      form.reset();
      onSuccess(customer);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_PHONE') {
        form.setError('phone', { message: 'Phone already exists for another customer' });
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Failed');
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit customer' : 'New customer'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl><Input placeholder="Ravi Kumar" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input inputMode="tel" placeholder="+91…" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="alternate_phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Alt phone</FormLabel>
                  <FormControl><Input inputMode="tel" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl><Input placeholder="Delhi" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="customer_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="individual">Individual</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            {customerType === 'business' && (
              <FormField control={form.control} name="gstin" render={({ field }) => (
                <FormItem>
                  <FormLabel>GSTIN</FormLabel>
                  <FormControl><Input placeholder="27AAPFU0939F1ZV" className="font-mono" {...field} /></FormControl>
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="credit_limit" render={({ field }) => (
              <FormItem>
                <FormLabel>Credit limit</FormLabel>
                <FormControl>
                  <MoneyInput value={field.value} onChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="tags" render={({ field }) => (
              <FormItem>
                <FormLabel>Tags</FormLabel>
                <FormControl>
                  <TagInput value={field.value} onChange={field.onChange} placeholder="vip, cctv, laptop…" />
                </FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[60px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )} />

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create customer'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
