'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Pencil, ToggleLeft, ToggleRight, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { repairApi, type FaultTemplate } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const partSchema = z.object({
  custom_part_name: z.string().min(1, 'Part name required'),
  quantity: z.number().int().min(1, 'Min 1'),
});

const templateSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  device_type: z.string().min(1, 'Device type is required'),
  device_brand: z.string().optional(),
  problem_description: z.string().min(10, 'At least 10 characters'),
  default_sc: z.number().min(0),
  estimated_duration_hours: z.number().min(0).optional(),
  parts: z.array(partSchema),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

export default function FaultTemplatesPage() {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FaultTemplate | null>(null);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FaultTemplate | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, error } = useQuery({
    queryKey: qk.repairTemplates({ search: debouncedSearch || undefined }),
    queryFn: () => repairApi.listTemplates(activeShopId ?? '', { search: debouncedSearch || undefined }),
    enabled: !!activeShopId,
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      repairApi.updateTemplate(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-templates'] });
      toast.success('Template updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repairApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-templates'] });
      toast.success('Template deleted');
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Delete failed'),
  });

  const columns: Column<FaultTemplate>[] = [
    {
      key: 'name',
      header: 'Template name',
      cell: (t) => (
        <div>
          <p className="text-body-sm font-medium text-[var(--text)]">{t.name}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {[t.device_brand, t.device_type].filter(Boolean).join(' ')}
          </p>
        </div>
      ),
    },
    {
      key: 'problem',
      header: 'Problem',
      cell: (t) => (
        <span className="text-body-sm text-[var(--text)] line-clamp-2">{t.problem_description}</span>
      ),
    },
    {
      key: 'sc',
      header: 'Default S/C',
      cell: (t) => <Money amount={t.default_sc} className="text-body-sm" />,
    },
    {
      key: 'parts',
      header: 'Parts',
      cell: (t) => (
        <span className="text-body-sm text-[var(--text-muted)]">
          {t.parts.length > 0 ? `${t.parts.length} part${t.parts.length !== 1 ? 's' : ''}` : '—'}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Est. hours',
      cell: (t) => (
        <span className="text-body-sm text-[var(--text-muted)]">
          {t.estimated_duration_hours ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <span className={cn(
          'text-xs font-medium',
          t.is_active ? 'text-[var(--success)]' : 'text-[var(--text-muted)]',
        )}>
          {t.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (t) => (
        <Can permission="repair.templates.manage">
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => { e.stopPropagation(); setEditing(t); setDialogOpen(true); }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: t.id, is_active: !t.is_active }); }}
              disabled={toggleMutation.isPending}
            >
              {t.is_active
                ? <ToggleRight className="h-4 w-4 text-[var(--success)]" />
                : <ToggleLeft className="h-4 w-4 text-[var(--text-muted)]" />
              }
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 ml-1 text-[var(--danger)] hover:bg-[var(--danger)]/10"
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}
              aria-label="Delete template"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Fault Templates</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Pre-built problem descriptions and service charges to speed up job creation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              className="pl-9 h-9 w-[160px] sm:w-[220px]"
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search templates"
            />
          </div>
          <Can permission="repair.templates.manage">
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New template</span>
            </Button>
          </Can>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.items}
        loading={isLoading}
        error={error as Error | null}
        keyExtractor={(t) => t.id}
        emptyTitle={debouncedSearch ? 'No templates match' : 'No templates yet'}
        emptyDescription={
          debouncedSearch
            ? `No templates match “${debouncedSearch}”.`
            : 'Create a template to speed up job intake.'
        }
        emptyAction={
          debouncedSearch
            ? { label: 'Clear search', onClick: () => setSearch('') }
            : { label: 'New template', onClick: () => { setEditing(null); setDialogOpen(true); } }
        }
      />

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        shopId={activeShopId ?? ''}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['repair-templates'] });
          setDialogOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete this template?"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” will be removed from the list. Existing jobs are unaffected.`
            : undefined
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
      />
    </div>
  );
}

// ── Template form dialog ──────────────────────────────────────────────────────

function TemplateDialog({
  open, onOpenChange, editing, shopId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: FaultTemplate | null;
  shopId: string;
  onSuccess: () => void;
}) {
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: editing
      ? {
          name: editing.name,
          device_type: editing.device_type,
          device_brand: editing.device_brand ?? '',
          problem_description: editing.problem_description,
          default_sc: editing.default_sc,
          estimated_duration_hours: editing.estimated_duration_hours ?? undefined,
          parts: editing.parts.map((p) => ({ custom_part_name: p.custom_part_name, quantity: p.quantity })),
        }
      : {
          name: '', device_type: '', device_brand: '',
          problem_description: '', default_sc: 0,
          estimated_duration_hours: undefined,
          parts: [],
        },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'parts' });

  // Reset form when editing target changes
  const currentEditId = editing?.id ?? null;
  if (form.getValues('name') !== (editing?.name ?? '') && currentEditId !== null) {
    form.reset({
      name: editing!.name,
      device_type: editing!.device_type,
      device_brand: editing!.device_brand ?? '',
      problem_description: editing!.problem_description,
      default_sc: editing!.default_sc,
      estimated_duration_hours: editing!.estimated_duration_hours ?? undefined,
      parts: editing!.parts.map((p) => ({ custom_part_name: p.custom_part_name, quantity: p.quantity })),
    });
  }

  const saveMutation = useMutation({
    mutationFn: (values: TemplateFormValues) => {
      const parts = values.parts.filter((p) => p.custom_part_name.trim());
      const body = {
        name: values.name,
        device_type: values.device_type,
        device_brand: values.device_brand || undefined,
        problem_description: values.problem_description,
        default_sc: values.default_sc,
        estimated_duration_hours: values.estimated_duration_hours,
        parts,
      };
      return editing
        ? repairApi.updateTemplate(editing.id, body)
        : repairApi.createTemplate({ ...body, shop_id: shopId });
    },
    onSuccess: () => {
      toast.success(editing ? 'Template updated' : 'Template created');
      form.reset();
      onSuccess();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit template' : 'New fault template'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Template name *</FormLabel>
                <FormControl><Input placeholder="iPhone screen replacement" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="device_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Device type *</FormLabel>
                  <FormControl><Input placeholder="Smartphone" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="device_brand" render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand</FormLabel>
                  <FormControl><Input placeholder="Apple" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="problem_description" render={({ field }) => (
              <FormItem>
                <FormLabel>Problem description *</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    placeholder="Customer reports screen cracked after drop…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="default_sc" render={({ field }) => (
                <FormItem>
                  <FormLabel>Default S/C *</FormLabel>
                  <FormControl>
                    <MoneyInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="estimated_duration_hours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Est. hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      placeholder="2"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </FormControl>
                </FormItem>
              )} />
            </div>

            {/* Default parts */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-body-sm font-medium text-[var(--text)]">Default parts</p>
                <button
                  type="button"
                  onClick={() => append({ custom_part_name: '', quantity: 1 })}
                  className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add part
                </button>
              </div>
              {fields.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-2">
                  No default parts. Click &ldquo;Add part&rdquo; to define parts that will be auto-requested on job creation.
                </p>
              ) : (
                <div className="space-y-2">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                      <FormField
                        control={form.control}
                        name={`parts.${index}.custom_part_name`}
                        render={({ field: f }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input placeholder="Part name" {...f} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`parts.${index}.quantity`}
                        render={({ field: f }) => (
                          <FormItem className="w-20">
                            <FormControl>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                placeholder="Qty"
                                value={f.value}
                                onChange={(e) => f.onChange(parseInt(e.target.value, 10) || 1)}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="mt-2 p-1 text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded"
                        aria-label="Remove part"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
