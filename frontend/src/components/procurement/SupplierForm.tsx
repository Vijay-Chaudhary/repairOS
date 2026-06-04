'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { procurementApi, type Supplier } from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().min(10, 'Phone required'),
  contact_person: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  state: z.string().optional(),
  state_code: z.string().optional(),
  gstin: z.string().optional(),
  payment_terms_days: z.number().min(0),
  credit_limit: z.number().min(0),
  bank_ifsc: z.string().optional(),
  bank_account_number: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface SupplierFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  supplier?: Supplier | null;
  onSuccess?: (s: Supplier) => void;
}

export function SupplierForm({ open, onOpenChange, supplier, onSuccess }: SupplierFormProps) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: supplier
      ? {
          name: supplier.name, phone: supplier.phone,
          contact_person: supplier.contact_person ?? '',
          email: supplier.email ?? '', address: supplier.address ?? '',
          state: supplier.state ?? '', state_code: supplier.state_code ?? '',
          gstin: supplier.gstin ?? '', payment_terms_days: supplier.payment_terms_days,
          credit_limit: supplier.credit_limit, bank_ifsc: supplier.bank_ifsc ?? '',
          bank_account_number: '',
        }
      : { name: '', phone: '', contact_person: '', email: '', address: '',
          state: '', state_code: '', gstin: '', payment_terms_days: 30,
          credit_limit: 0, bank_ifsc: '', bank_account_number: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        name: values.name, phone: values.phone,
        contact_person: values.contact_person || undefined,
        email: values.email || undefined, address: values.address || undefined,
        state: values.state || undefined, state_code: values.state_code || undefined,
        gstin: values.gstin || undefined,
        payment_terms_days: values.payment_terms_days,
        credit_limit: values.credit_limit,
        bank_ifsc: values.bank_ifsc || undefined,
        bank_account_number: values.bank_account_number || undefined,
      };
      return supplier
        ? procurementApi.updateSupplier(supplier.id, body)
        : procurementApi.createSupplier(body);
    },
    onSuccess: (s: Supplier) => {
      queryClient.invalidateQueries({ queryKey: qk.suppliers() });
      toast.success(supplier ? 'Supplier updated' : 'Supplier created');
      form.reset();
      onSuccess?.(s);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{supplier ? 'Edit supplier' : 'New supplier'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Supplier name *</FormLabel>
                  <FormControl><Input placeholder="Sharma Distributors" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input inputMode="tel" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="contact_person" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact person</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="gstin" render={({ field }) => (
                <FormItem>
                  <FormLabel>GSTIN</FormLabel>
                  <FormControl><Input className="font-mono" placeholder="27AAPFU0939F1ZV" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl><Input placeholder="Maharashtra" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="state_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>State code</FormLabel>
                  <FormControl><Input className="font-mono" placeholder="27" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="payment_terms_days" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment terms (days)</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)} />
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="credit_limit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit limit</FormLabel>
                  <FormControl><MoneyInput value={field.value} onChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
            </div>

            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Bank details (encrypted at rest)</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="bank_account_number" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account number</FormLabel>
                    <FormControl><Input type="password" className="font-mono" placeholder="Enter to update" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="bank_ifsc" render={({ field }) => (
                  <FormItem>
                    <FormLabel>IFSC</FormLabel>
                    <FormControl><Input className="font-mono" placeholder="HDFC0001234" {...field} /></FormControl>
                  </FormItem>
                )} />
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : supplier ? 'Save changes' : 'Create supplier'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
