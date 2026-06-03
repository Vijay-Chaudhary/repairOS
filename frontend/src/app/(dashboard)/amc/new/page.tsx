"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

// ── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  title:                z.string().min(1, "Title is required"),
  description:          z.string().optional(),
  customer_id:          z.string().min(1, "Customer is required"),
  start_date:           z.string().min(1, "Start date is required"),
  end_date:             z.string().min(1, "End date is required"),
  value:                z.string().min(1, "Contract value is required"),
  payment_terms:        z.enum(["upfront", "quarterly", "monthly"]),
  visits_per_year:      z.string(),
  auto_renew:           z.boolean(),
  renewal_reminder_days:z.string(),
  location_address:     z.string().optional(),
  notes:                z.string().optional(),
}).refine((d) => new Date(d.end_date) > new Date(d.start_date), {
  message: "End date must be after start date",
  path: ["end_date"],
});

type FormValues = z.infer<typeof schema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function inputCls(err: boolean) {
  return cn(
    "w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition focus:ring-2 focus:ring-blue-500",
    err ? "border-red-300 bg-red-50" : "border-gray-300 bg-white"
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewAMCPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  // Load customers for the picker
  const { data: customersData } = useQuery({
    queryKey: ["customers-for-amc"],
    queryFn: async () => {
      const res = await api.get("/crm/customers/?page_size=100");
      return (Array.isArray(res.data.data) ? res.data.data : []) as { id: string; name: string; phone: string }[];
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      payment_terms: "upfront",
      visits_per_year: "4",
      auto_renew: false,
      renewal_reminder_days: "30",
    },
  });

  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      api.post("/amc/contracts/", {
        shop_id: user?.shop_ids?.[0],
        customer_id: data.customer_id,
        title: data.title,
        description: data.description ?? "",
        start_date: data.start_date,
        end_date: data.end_date,
        value: data.value,
        payment_terms: data.payment_terms,
        visits_per_year: parseInt(data.visits_per_year || "0"),
        auto_renew: data.auto_renew,
        renewal_reminder_days: parseInt(data.renewal_reminder_days || "30"),
        location_address: data.location_address ?? "",
        notes: data.notes ?? "",
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["amc-contracts"] });
      router.push(`/amc/${res.data.data.id}`);
    },
  });

  return (
    <div className="max-w-lg">
      <Link href="/amc" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> AMC
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">New AMC Contract</h1>

      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        {/* Basic info */}
        <Field label="Contract Title *" error={errors.title?.message}>
          <input {...form.register("title")} type="text" placeholder="e.g. Annual AC Maintenance" className={inputCls(!!errors.title)} />
        </Field>

        <Field label="Customer *" error={errors.customer_id?.message}>
          <select {...form.register("customer_id")} className={inputCls(!!errors.customer_id)}>
            <option value="">Select customer…</option>
            {customersData?.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
            ))}
          </select>
        </Field>

        <Field label="Description" error={undefined}>
          <textarea
            {...form.register("description")}
            rows={2}
            placeholder="Scope of maintenance, equipment covered…"
            className={cn(inputCls(false), "resize-none")}
          />
        </Field>

        {/* Dates + value */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Contract Terms</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date *" error={errors.start_date?.message}>
              <input {...form.register("start_date")} type="date" className={inputCls(!!errors.start_date)} />
            </Field>
            <Field label="End Date *" error={errors.end_date?.message}>
              <input {...form.register("end_date")} type="date" className={inputCls(!!errors.end_date)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contract Value (₹) *" error={errors.value?.message}>
              <input {...form.register("value")} type="number" step="0.01" min="0" placeholder="12000" className={inputCls(!!errors.value)} />
            </Field>
            <Field label="Payment Terms" error={undefined}>
              <select {...form.register("payment_terms")} className={inputCls(false)}>
                <option value="upfront">Upfront</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
          </div>
        </div>

        {/* Visits + renewal */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Visit Schedule</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Visits per Year" error={undefined}>
              <input {...form.register("visits_per_year")} type="number" min="0" max="52" placeholder="4" className={inputCls(false)} />
            </Field>
            <Field label="Reminder (days before)" error={undefined}>
              <input {...form.register("renewal_reminder_days")} type="number" min="1" placeholder="30" className={inputCls(false)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input {...form.register("auto_renew")} type="checkbox" className="rounded text-blue-600 w-4 h-4" />
            <span className="text-sm text-gray-700">Auto-renew when expired</span>
          </label>
        </div>

        {/* Location & notes */}
        <Field label="Service Location Address" error={undefined}>
          <textarea
            {...form.register("location_address")}
            rows={2}
            placeholder="Full address where visits are performed…"
            className={cn(inputCls(false), "resize-none")}
          />
        </Field>

        <Field label="Notes" error={undefined}>
          <textarea
            {...form.register("notes")}
            rows={2}
            placeholder="Any internal notes…"
            className={cn(inputCls(false), "resize-none")}
          />
        </Field>

        {mutation.isError && (
          <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
            Failed to create contract. Check all fields and try again.
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 min-h-[44px]"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Create Contract
        </button>
      </form>
    </div>
  );
}
