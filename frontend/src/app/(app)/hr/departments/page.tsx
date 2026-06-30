'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Building2, Pencil, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import { hrApi, type Department } from '@/lib/api/hr';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { cn } from '@/lib/utils';

const NONE = '__none__';

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  code: z.string().min(1, 'Code required'),
  head_id: z.string().optional(),
  is_active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export default function DepartmentsPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

  const filters = { shop_id: isAllShops ? undefined : activeShopId ?? undefined };
  const { data, isLoading } = useQuery({
    queryKey: qk.departments(filters),
    queryFn: () => hrApi.listDepartments(filters),
    staleTime: 60_000,
  });
  const departments = data?.items ?? [];

  const deactivate = useMutation({
    mutationFn: (id: string) => hrApi.deactivateDepartment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.departments() });
      toast.success('Department deactivated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Departments</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Organise employees into departments and assign a head.
          </p>
        </div>
        <Can permission="hr.departments.manage">
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New department</span>
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments yet"
          description="Create departments to group employees and assign a head."
          action={{ label: 'New department', onClick: () => { setEditing(null); setFormOpen(true); } }}
        />
      ) : (
        <div className="space-y-2">
          {departments.map((dept) => (
            <div
              key={dept.id}
              className={cn(
                'flex items-center justify-between p-4 rounded-lg border border-[var(--border)]',
                dept.is_active ? 'bg-[var(--surface)]' : 'bg-[var(--surface-2)] opacity-70',
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-body-sm font-medium text-[var(--text)]">{dept.name}</p>
                  <span className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface-2)] rounded px-1.5 py-0.5">
                    {dept.code}
                  </span>
                  {!dept.is_active && (
                    <span className="text-[10px] font-medium bg-[var(--danger)]/15 text-[var(--danger)] rounded-full px-1.5 py-0.5">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {dept.head_name ? `Head: ${dept.head_name}` : 'No head assigned'}
                  {` · ${dept.employee_count} employee${dept.employee_count !== 1 ? 's' : ''}`}
                </p>
              </div>

              <Can permission="hr.departments.manage">
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0"
                    onClick={() => { setEditing(dept); setFormOpen(true); }}
                    title="Edit department"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {dept.is_active && (
                    <Button
                      size="sm" variant="ghost" className="h-8 w-8 p-0"
                      onClick={() => deactivate.mutate(dept.id)}
                      disabled={deactivate.isPending}
                      title="Deactivate department"
                    >
                      <Power className="h-3.5 w-3.5 text-[var(--danger)]" />
                    </Button>
                  )}
                </div>
              </Can>
            </div>
          ))}
        </div>
      )}

      <DepartmentFormDialog
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        shopId={activeShopId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: qk.departments() });
          setFormOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function DepartmentFormDialog({
  open, onOpenChange, editing, shopId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Department | null;
  shopId: string | null;
  onSuccess: () => void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      name: editing?.name ?? '',
      code: editing?.code ?? '',
      head_id: editing?.head_id ?? NONE,
      is_active: editing?.is_active ?? true,
    },
  });

  // Heads come from the existing employees endpoint (scoped to the active shop).
  const { data: empData } = useQuery({
    queryKey: qk.employees({ shop_id: shopId ?? undefined, head_picker: true }),
    queryFn: () => hrApi.listEmployees({ shop_id: shopId ?? undefined }),
    enabled: open,
    staleTime: 60_000,
  });
  const employees = empData?.items ?? [];

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const head_id = values.head_id && values.head_id !== NONE ? values.head_id : null;
      return editing
        ? hrApi.updateDepartment(editing.id, {
            name: values.name, code: values.code, head_id, is_active: values.is_active,
          })
        : hrApi.createDepartment({
            shop_id: shopId ?? '', name: values.name, code: values.code,
            head_id, is_active: values.is_active,
          });
    },
    onSuccess: () => {
      toast.success(editing ? 'Department updated' : 'Department created');
      form.reset();
      onSuccess();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit department' : 'New department'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Name *</FormLabel>
                  <FormControl><Input placeholder="Service" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl><Input className="font-mono uppercase" placeholder="SVC" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="head_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Head</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="is_active" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
                <div>
                  <FormLabel className="font-medium">Active</FormLabel>
                  <p className="text-xs text-[var(--text-muted)]">Inactive departments are hidden from new assignments</p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending || (!editing && !shopId)}>
                {mutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create department'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
