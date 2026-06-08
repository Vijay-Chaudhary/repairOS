'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, MapPin, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Stepper } from '@/components/shared/Stepper';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { CustomerSearch, type CustomerOption } from '@/components/repair/CustomerSearch';
import { CheckinForm } from '@/components/repair/CheckinForm';
import { repairApi, type JobPriority, type PhysicalCondition } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { ApiError, apiPost } from '@/lib/api/client';
import { money } from '@/lib/format/money';
import { normalizePhone } from '@/lib/format/phone';

const STEPS = [
  { label: 'Customer' },
  { label: 'Device' },
  { label: 'Location' },
  { label: 'Check-in' },
  { label: 'Review' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CheckinPayload {
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
}

interface WizardData {
  customer: CustomerOption | null;
  device_type: string;
  device_brand: string;
  device_model: string;
  serial_number: string;
  imei: string;
  problem_description: string;
  priority: JobPriority;
  service_charge: number;
  advance_paid: number;
  expected_delivery_date: string;
  notes: string;
  template_id: string | null;
  is_field_job: boolean;
  location_lat: number | null;
  location_lng: number | null;
  location_address: string;
  checkin: CheckinPayload | null;
}

// ── Step schemas ───────────────────────────────────────────────────────────────

const deviceSchema = z.object({
  device_type: z.string().min(1, 'Device type is required'),
  device_brand: z.string().optional(),
  device_model: z.string().optional(),
  serial_number: z.string().optional(),
  imei: z.string().optional(),
  problem_description: z.string().min(10, 'Problem description must be at least 10 characters'),
  priority: z.enum(['normal', 'urgent', 'vip']),
  service_charge: z.number().min(0),
  advance_paid: z.number().min(0),
  expected_delivery_date: z.string().optional(),
  notes: z.string().optional(),
  template_id: z.string().nullable().optional(),
});

const locationSchema = z.object({
  is_field_job: z.boolean(),
  location_address: z.string().optional(),
  location_lat: z.string().optional(),
  location_lng: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.is_field_job && !data.location_address) {
    ctx.addIssue({ code: 'custom', path: ['location_address'], message: 'Address required for field jobs' });
  }
});

const quickCustomerSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  phone: z.string().min(10, 'Valid phone number required'),
  email: z.string().email().optional().or(z.literal('')),
});

type DeviceFormValues = z.infer<typeof deviceSchema>;
type LocationFormValues = z.infer<typeof locationSchema>;
type QuickCustomerFormValues = z.infer<typeof quickCustomerSchema>;

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function NewJobPage() {
  const router = useRouter();
  const { activeShopId } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  const [step, setStep] = useState(0);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  const [wizardData, setWizardData] = useState<WizardData>({
    customer: null,
    device_type: '', device_brand: '', device_model: '',
    serial_number: '', imei: '',
    problem_description: '', priority: 'normal',
    service_charge: 0, advance_paid: 0,
    expected_delivery_date: '', notes: '',
    template_id: null,
    is_field_job: false, location_lat: null, location_lng: null, location_address: '',
    checkin: null,
  });

  // Fault templates for step 2
  const { data: templatesData } = useQuery({
    queryKey: qk.repairTemplates(),
    queryFn: () => repairApi.listTemplates(activeShopId ?? ''),
    enabled: !!activeShopId && step === 1,
    staleTime: 300_000,
  });
  const templates = templatesData?.items ?? [];

  // Final submit mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!wizardData.customer || !activeShopId || !wizardData.checkin) throw new Error('Missing data');
      const job = await repairApi.createJob({
        shop_id: activeShopId,
        customer_id: wizardData.customer.id,
        device_type: wizardData.device_type,
        device_brand: wizardData.device_brand || undefined,
        device_model: wizardData.device_model || undefined,
        serial_number: wizardData.serial_number || undefined,
        imei: wizardData.imei || undefined,
        problem_description: wizardData.problem_description,
        priority: wizardData.priority,
        service_charge: wizardData.service_charge || undefined,
        advance_paid: wizardData.advance_paid || undefined,
        expected_delivery_date: wizardData.expected_delivery_date || undefined,
        notes: wizardData.notes || undefined,
        template_id: wizardData.template_id ?? undefined,
        is_field_job: wizardData.is_field_job || undefined,
        location_lat: wizardData.location_lat ?? undefined,
        location_lng: wizardData.location_lng ?? undefined,
        location_address: wizardData.location_address || undefined,
      });
      // The job now exists even if check-in fails below — don't strand the user
      // on the wizard with a dangling draft they can't get back to.
      try {
        await repairApi.submitCheckin(job.id, {
          physical_condition: wizardData.checkin.physical_condition,
          has_scratches: wizardData.checkin.has_scratches,
          has_cracks: wizardData.checkin.has_cracks,
          has_liquid_damage: wizardData.checkin.has_liquid_damage,
          has_missing_parts: wizardData.checkin.has_missing_parts,
          accessory_received: wizardData.checkin.accessory_received,
          customer_description: wizardData.checkin.customer_description,
          technician_notes: wizardData.checkin.technician_notes,
          photos: wizardData.checkin.photos,
          customer_signature_url: wizardData.checkin.customer_signature_url,
        });
        return { job, checkinFailed: false };
      } catch {
        return { job, checkinFailed: true };
      }
    },
    onSuccess: ({ job, checkinFailed }) => {
      if (checkinFailed) {
        toast.error(`Job ${job.job_number} created — complete check-in to open it.`);
      } else {
        toast.success(`Job ${job.job_number} created`);
      }
      router.push(`/jobs/${job.id}`);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create job');
    },
  });

  if (!isOnline) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <WifiOff className="h-12 w-12 text-[var(--text-muted)]" />
        <h2 className="text-h2 text-[var(--text)]">Needs connection</h2>
        <p className="text-body-sm text-[var(--text-muted)] max-w-xs">
          Creating a job requires photos and a check-in signature. Please reconnect and try again.
        </p>
        <Button variant="outline" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => step === 0 ? router.back() : setStep(s => s - 1)} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-h1 text-[var(--text)]">New Job</h1>
      </div>

      {/* Stepper */}
      <Stepper steps={STEPS} currentStep={step} className="mb-8" />

      {/* Step content */}
      {step === 0 && (
        <CustomerStep
          value={wizardData.customer}
          onChange={(c) => setWizardData(p => ({ ...p, customer: c }))}
          onNext={() => setStep(1)}
          onCreateNew={() => setShowQuickCreate(true)}
        />
      )}
      {step === 1 && (
        <DeviceStep
          defaults={wizardData}
          templates={templates}
          onNext={(vals) => {
            setWizardData(p => ({ ...p, ...vals }));
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <LocationStep
          defaults={wizardData}
          onNext={(vals) => {
            setWizardData(p => ({ ...p, ...vals }));
            setStep(3);
          }}
        />
      )}
      {step === 3 && (
        <div>
          <p className="text-body-sm text-[var(--text-muted)] mb-4">
            Document the device condition before starting work.
          </p>
          <CheckinForm
            onSubmit={async (data) => {
              setWizardData(p => ({ ...p, checkin: data }));
              setStep(4);
            }}
          />
        </div>
      )}
      {step === 4 && (
        <ReviewStep
          data={wizardData}
          onBack={() => setStep(3)}
          onSubmit={() => submitMutation.mutate()}
          isSubmitting={submitMutation.isPending}
        />
      )}

      {/* Quick-create customer dialog */}
      <QuickCreateCustomerDialog
        open={showQuickCreate}
        onOpenChange={setShowQuickCreate}
        onCreated={(c) => {
          setWizardData(p => ({ ...p, customer: c }));
          setShowQuickCreate(false);
        }}
      />
    </div>
  );
}

// ── Step: Customer ─────────────────────────────────────────────────────────────

function CustomerStep({
  value, onChange, onNext, onCreateNew,
}: {
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
  onNext: () => void;
  onCreateNew: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-body-sm font-medium text-[var(--text)] mb-3">Select customer</p>
        <CustomerSearch value={value} onChange={onChange} onCreateNew={onCreateNew} />
      </div>
      <Button
        className="w-full"
        onClick={onNext}
        disabled={!value}
      >
        Next <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Step: Device & Problem ────────────────────────────────────────────────────

interface FaultTemplate {
  id: string;
  name: string;
  device_type: string;
  device_brand?: string | null;
  problem_description: string;
  default_sc: number;
}

function DeviceStep({
  defaults, templates, onNext,
}: {
  defaults: WizardData;
  templates: FaultTemplate[];
  onNext: (vals: Partial<WizardData>) => void;
}) {
  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceSchema),
    defaultValues: {
      device_type: defaults.device_type,
      device_brand: defaults.device_brand,
      device_model: defaults.device_model,
      serial_number: defaults.serial_number,
      imei: defaults.imei,
      problem_description: defaults.problem_description,
      priority: defaults.priority,
      service_charge: defaults.service_charge,
      advance_paid: defaults.advance_paid,
      expected_delivery_date: defaults.expected_delivery_date,
      notes: defaults.notes,
      template_id: defaults.template_id,
    },
  });

  function applyTemplate(id: string) {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    form.setValue('template_id', id);
    form.setValue('device_type', tpl.device_type);
    if (tpl.device_brand) form.setValue('device_brand', tpl.device_brand);
    form.setValue('problem_description', tpl.problem_description);
    form.setValue('service_charge', tpl.default_sc);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => onNext(v))} className="space-y-4">
        {templates.length > 0 && (
          <div>
            <p className="text-body-sm font-medium text-[var(--text)] mb-2">Use a fault template (optional)</p>
            <Select onValueChange={applyTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="Select template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="device_type" render={({ field }) => (
            <FormItem className="col-span-2 sm:col-span-1">
              <FormLabel>Device type *</FormLabel>
              <FormControl><Input placeholder="Smartphone, Laptop…" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="device_brand" render={({ field }) => (
            <FormItem className="col-span-2 sm:col-span-1">
              <FormLabel>Brand</FormLabel>
              <FormControl><Input placeholder="Apple, Samsung…" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="device_model" render={({ field }) => (
            <FormItem className="col-span-2 sm:col-span-1">
              <FormLabel>Model</FormLabel>
              <FormControl><Input placeholder="iPhone 14, Galaxy S23…" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="serial_number" render={({ field }) => (
            <FormItem className="col-span-2 sm:col-span-1">
              <FormLabel>Serial / IMEI</FormLabel>
              <FormControl>
                <Input
                  placeholder="IMEI or serial"
                  inputMode="numeric"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    // Also populate imei field if it looks like an IMEI
                    if (/^\d{10,15}$/.test(e.target.value)) {
                      form.setValue('imei', e.target.value);
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="problem_description" render={({ field }) => (
          <FormItem>
            <FormLabel>Problem description *</FormLabel>
            <FormControl>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                placeholder="Describe the issue in detail (min 10 characters)…"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="priority" render={({ field }) => (
            <FormItem>
              <FormLabel>Priority</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="expected_delivery_date" render={({ field }) => (
            <FormItem>
              <FormLabel>Expected delivery</FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="service_charge" render={({ field }) => (
            <FormItem>
              <FormLabel>Service charge</FormLabel>
              <FormControl>
                <MoneyInput value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="advance_paid" render={({ field }) => (
            <FormItem>
              <FormLabel>Advance paid</FormLabel>
              <FormControl>
                <MoneyInput value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Internal notes</FormLabel>
            <FormControl>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                placeholder="Optional notes for the team…"
                {...field}
              />
            </FormControl>
          </FormItem>
        )} />

        <Button type="submit" className="w-full">
          Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </form>
    </Form>
  );
}

// ── Step: Field Job / Location ─────────────────────────────────────────────────

function LocationStep({
  defaults, onNext,
}: {
  defaults: WizardData;
  onNext: (vals: Partial<WizardData>) => void;
}) {
  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      is_field_job: defaults.is_field_job,
      location_address: defaults.location_address,
      location_lat: defaults.location_lat?.toString() ?? '',
      location_lng: defaults.location_lng?.toString() ?? '',
    },
  });
  const isField = form.watch('is_field_job');

  function handleSubmit(v: LocationFormValues) {
    onNext({
      is_field_job: v.is_field_job,
      location_address: v.location_address ?? '',
      location_lat: v.location_lat ? parseFloat(v.location_lat) : null,
      location_lng: v.location_lng ? parseFloat(v.location_lng) : null,
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField control={form.control} name="is_field_job" render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-lg border border-[var(--border)] p-4">
            <div>
              <FormLabel className="text-body font-medium text-[var(--text)]">Field job</FormLabel>
              <p className="text-body-sm text-[var(--text-muted)]">Technician will visit the customer&apos;s location</p>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )} />

        {isField && (
          <div className="space-y-3 p-4 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <MapPin className="h-4 w-4" />
              <span className="text-body-sm font-medium">Location details</span>
            </div>
            <FormField control={form.control} name="location_address" render={({ field }) => (
              <FormItem>
                <FormLabel>Address *</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[72px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    placeholder="Full address…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="location_lat" render={({ field }) => (
                <FormItem>
                  <FormLabel>Latitude</FormLabel>
                  <FormControl><Input inputMode="decimal" placeholder="28.6139" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="location_lng" render={({ field }) => (
                <FormItem>
                  <FormLabel>Longitude</FormLabel>
                  <FormControl><Input inputMode="decimal" placeholder="77.2090" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>
          </div>
        )}

        <Button type="submit" className="w-full">
          Next <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </form>
    </Form>
  );
}

// ── Step: Review & Submit ─────────────────────────────────────────────────────

function ReviewStep({
  data, onBack, onSubmit, isSubmitting,
}: {
  data: WizardData;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Customer', value: data.customer?.name ?? '—' },
    { label: 'Phone', value: data.customer?.phone ?? '—' },
    { label: 'Device', value: [data.device_brand, data.device_type, data.device_model].filter(Boolean).join(' ') },
    { label: 'Problem', value: data.problem_description },
    { label: 'Priority', value: data.priority.charAt(0).toUpperCase() + data.priority.slice(1) },
    { label: 'Service charge', value: money(data.service_charge) },
    { label: 'Advance', value: money(data.advance_paid) },
    ...(data.is_field_job ? [{ label: 'Field job', value: data.location_address || 'Yes' }] : []),
    { label: 'Condition', value: data.checkin?.physical_condition ?? '—' },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-3">
            <span className="text-body-sm text-[var(--text-muted)] shrink-0">{label}</span>
            <span className="text-body-sm text-[var(--text)] text-right">{value}</span>
          </div>
        ))}
      </div>

      {data.checkin && (
        <div className="rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/30 px-4 py-3">
          <p className="text-body-sm font-medium text-[var(--success)]">
            ✓ Check-in complete — {data.checkin.photos.length} photo{data.checkin.photos.length !== 1 ? 's' : ''}
            {data.checkin.customer_signature_url ? ', signature captured' : ''}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button className="flex-1" onClick={onSubmit} disabled={isSubmitting || !data.customer || !data.checkin}>
          {isSubmitting ? 'Creating…' : 'Create Job'}
        </Button>
      </div>
    </div>
  );
}

// ── Quick-create customer dialog ──────────────────────────────────────────────

function QuickCreateCustomerDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: CustomerOption) => void;
}) {
  const form = useForm<QuickCustomerFormValues>({
    resolver: zodResolver(quickCustomerSchema),
    defaultValues: { name: '', phone: '', email: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values: QuickCustomerFormValues) =>
      apiPost<CustomerOption>('/crm/customers/', {
        name: values.name,
        phone: normalizePhone(values.phone),
        email: values.email || undefined,
      }),
    onSuccess: (customer) => {
      toast.success('Customer created');
      form.reset();
      onCreated(customer);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create customer');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Full name *</FormLabel>
                <FormControl><Input placeholder="Rahul Sharma" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone *</FormLabel>
                <FormControl><Input inputMode="tel" placeholder="+91 98765 43210" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="rahul@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
