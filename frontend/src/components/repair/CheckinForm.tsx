'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PhotoUploader } from '@/components/shared/PhotoUploader';
import { SignaturePad } from '@/components/shared/SignaturePad';
import type { JobCheckin, PhysicalCondition } from '@/lib/api/repair';

const schema = z.object({
  physical_condition: z.enum(['excellent', 'good', 'fair', 'damaged']),
  has_scratches: z.boolean(),
  has_cracks: z.boolean(),
  has_liquid_damage: z.boolean(),
  has_missing_parts: z.boolean(),
  accessories_input: z.string().optional(),
  customer_description: z.string().optional(),
  technician_notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface CheckinFormProps {
  existingCheckin?: JobCheckin | null;
  onSubmit: (data: {
    physical_condition: PhysicalCondition;
    has_scratches: boolean;
    has_cracks: boolean;
    has_liquid_damage: boolean;
    has_missing_parts: boolean;
    accessory_received: string[];
    customer_description?: string;
    technician_notes?: string;
    photos: string[];
    customer_signature_url: string | null;
  }) => Promise<void>;
  loading?: boolean;
}

export function CheckinForm({ existingCheckin, onSubmit, loading }: CheckinFormProps) {
  const [photos, setPhotos] = useState<string[]>(existingCheckin?.photos ?? []);
  const [signature, setSignature] = useState<string | null>(existingCheckin?.customer_signature_url ?? null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      physical_condition: (existingCheckin?.physical_condition as PhysicalCondition) ?? 'good',
      has_scratches: existingCheckin?.has_scratches ?? false,
      has_cracks: existingCheckin?.has_cracks ?? false,
      has_liquid_damage: existingCheckin?.has_liquid_damage ?? false,
      has_missing_parts: existingCheckin?.has_missing_parts ?? false,
      accessories_input: existingCheckin?.accessory_received?.join(', ') ?? '',
      customer_description: existingCheckin?.customer_description ?? '',
      technician_notes: existingCheckin?.technician_notes ?? '',
    },
  });

  async function handleSubmit(values: FormValues) {
    const accessories = values.accessories_input
      ? values.accessories_input.split(',').map((a) => a.trim()).filter(Boolean)
      : [];
    await onSubmit({
      physical_condition: values.physical_condition as PhysicalCondition,
      has_scratches: values.has_scratches,
      has_cracks: values.has_cracks,
      has_liquid_damage: values.has_liquid_damage,
      has_missing_parts: values.has_missing_parts,
      accessory_received: accessories,
      customer_description: values.customer_description || undefined,
      technician_notes: values.technician_notes || undefined,
      photos,
      customer_signature_url: signature,
    });
  }

  if (existingCheckin?.acknowledged_at) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-md bg-[var(--success)]/10 border border-[var(--success)]/30">
        <CheckCircle2 className="h-5 w-5 text-[var(--success)] shrink-0" />
        <div>
          <p className="text-body-sm font-medium text-[var(--success)]">Check-in completed</p>
          <p className="text-xs text-[var(--text-muted)]">
            Condition: {existingCheckin.physical_condition} · {existingCheckin.photos.length} photos
          </p>
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField control={form.control} name="physical_condition" render={({ field }) => (
          <FormItem>
            <FormLabel>Physical condition *</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger><SelectValue placeholder="Select condition" /></SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="excellent">Excellent</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="damaged">Damaged</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <div className="space-y-2">
          <p className="text-body-sm font-medium text-[var(--text)]">Damage checklist</p>
          <div className="grid grid-cols-2 gap-2">
            {(['has_scratches', 'has_cracks', 'has_liquid_damage', 'has_missing_parts'] as const).map((name) => (
              <FormField key={name} control={form.control} name={name} render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="font-normal cursor-pointer">
                    {name.replace('has_', '').replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </FormLabel>
                </FormItem>
              )} />
            ))}
          </div>
        </div>

        <FormField control={form.control} name="accessories_input" render={({ field }) => (
          <FormItem>
            <FormLabel>Accessories received</FormLabel>
            <FormControl>
              <Input placeholder="charger, case, earphones (comma-separated)" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="customer_description" render={({ field }) => (
          <FormItem>
            <FormLabel>Customer&apos;s description of issue</FormLabel>
            <FormControl>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 resize-none"
                placeholder="Customer says the screen flickered before shutdown…"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="space-y-2">
          <p className="text-body-sm font-medium text-[var(--text)]">Photos</p>
          <PhotoUploader value={photos} onChange={setPhotos} maxFiles={8} />
        </div>

        <div className="space-y-2">
          <p className="text-body-sm font-medium text-[var(--text)]">Customer signature</p>
          <SignaturePad onChange={setSignature} />
          {signature && <p className="text-xs text-[var(--success)]">Signed ✓</p>}
        </div>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Saving check-in…' : 'Complete check-in'}
        </Button>
      </form>
    </Form>
  );
}
