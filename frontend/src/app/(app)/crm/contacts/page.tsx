'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { crmApi, type Contact } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  customer_id: z.string().min(1, 'Customer required'),
  name: z.string().min(2, 'Name required'),
  designation: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.contacts(),
    queryFn: () => crmApi.listContacts(),
    staleTime: 60_000,
  });
  const customersQuery = useQuery({
    queryKey: qk.customers(),
    queryFn: () => crmApi.listCustomers(),
    staleTime: 300_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customer_id: '', name: '', designation: '', email: '', phone: '' },
  });

  const createMutation = useMutation({
    mutationFn: (v: FormValues) => crmApi.createContact(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.contacts() });
      setOpen(false);
      form.reset();
      toast.success('Contact added');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add contact'),
  });

  const contacts: Contact[] = data?.items ?? [];
  const customers = customersQuery.data?.items ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Contacts</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-1">People at your customer accounts.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add contact</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : contacts.length === 0 ? (
        <EmptyState title="No contacts yet" description="Add a contact person to a customer." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Designation</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {contacts.map((c) => (
                <tr key={c.id} className="bg-[var(--surface)]">
                  <td className="px-4 py-2 font-medium text-[var(--text)]">{c.name}{c.is_primary && ' ★'}</td>
                  <td className="px-4 py-2">{c.designation || '—'}</td>
                  <td className="px-4 py-2">{c.customer_name}</td>
                  <td className="px-4 py-2">{c.email || '—'}</td>
                  <td className="px-4 py-2">{c.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="customer_id" render={({ field }) => (
                <FormItem><FormLabel>Customer</FormLabel><FormControl>
                  <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                    <option value="">Select customer…</option>
                    {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                  </select>
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="designation" render={({ field }) => (
                <FormItem><FormLabel>Designation</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Save</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
