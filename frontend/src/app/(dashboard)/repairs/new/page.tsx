"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

// ── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  device_type: z.string().min(1, "Device type is required"),
  device_brand: z.string().optional(),
  device_model: z.string().optional(),
  serial_number: z.string().optional(),
  imei: z.string().optional(),
  problem_description: z.string().min(10, "Description must be at least 10 characters"),
  priority: z.enum(["normal", "urgent", "vip"]),
  service_charge: z.number().min(0),
  advance_paid: z.number().min(0),
  expected_delivery_date: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Customer {
  id: string;
  name: string;
  phone: string;
}

// ── Customer search component ─────────────────────────────────────────────────

function CustomerPicker({
  onChange,
  error,
}: {
  onChange: (id: string, name: string) => void;
  error?: string;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["customers-search", q],
    queryFn: async () => {
      if (!q) return { data: [] };
      const res = await api.get(`/crm/customers/?q=${encodeURIComponent(q)}`);
      return res.data;
    },
    enabled: q.length > 0,
  });

  const customers: Customer[] = data?.data ?? [];

  const select = useCallback(
    (c: Customer) => {
      setSelected(c);
      setOpen(false);
      setQ("");
      onChange(c.id, c.name);
    },
    [onChange]
  );

  const clear = () => {
    setSelected(null);
    setQ("");
    onChange("", "");
  };

  return (
    <div className="relative">
      {selected ? (
        <div className={cn(
          "flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm",
          error ? "border-red-300 bg-red-50" : "border-gray-300 bg-white"
        )}>
          <div>
            <span className="font-medium text-gray-900">{selected.name}</span>
            <span className="text-gray-500 ml-2 text-xs">{selected.phone}</span>
          </div>
          <button type="button" onClick={clear} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or phone…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              className={cn(
                "w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm outline-none transition",
                "focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                error ? "border-red-300 bg-red-50" : "border-gray-300 bg-white"
              )}
            />
          </div>
          {open && customers.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                >
                  <p className="text-sm font-medium text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.phone}</p>
                </button>
              ))}
            </div>
          )}
          {open && q.length > 0 && customers.length === 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm text-gray-500">
              No customers found.{" "}
              <Link href="/customers/new" className="text-blue-600 underline">
                Add one?
              </Link>
            </div>
          )}
        </>
      )}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewRepairPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      priority: "normal",
      service_charge: 0,
      advance_paid: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      api.post("/repair/jobs/", {
        ...data,
        shop_id: user?.shop_ids?.[0],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-jobs"] });
      router.push("/repairs");
    },
  });

  const onSubmit = (data: FormValues) => mutation.mutate(data);

  return (
    <div className="max-w-lg">
      <Link
        href="/repairs"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Repairs
      </Link>

      <h1 className="text-xl font-semibold text-gray-900 mb-6">New Repair Job</h1>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

        {/* Customer */}
        <Field label="Customer *" error={form.formState.errors.customer_id?.message}>
          <CustomerPicker
            onChange={(id) => form.setValue("customer_id", id, { shouldValidate: true })}
            error={form.formState.errors.customer_id?.message}
          />
        </Field>

        {/* Device */}
        <Field label="Device Type *" error={form.formState.errors.device_type?.message}>
          <input
            {...form.register("device_type")}
            type="text"
            placeholder="e.g. Smartphone, Laptop, TV"
            className={inputCls(!!form.formState.errors.device_type)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand" error={undefined}>
            <input
              {...form.register("device_brand")}
              type="text"
              placeholder="e.g. Apple"
              className={inputCls(false)}
            />
          </Field>
          <Field label="Model" error={undefined}>
            <input
              {...form.register("device_model")}
              type="text"
              placeholder="e.g. iPhone 14"
              className={inputCls(false)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Serial Number" error={undefined}>
            <input
              {...form.register("serial_number")}
              type="text"
              placeholder="Optional"
              className={inputCls(false)}
            />
          </Field>
          <Field label="IMEI" error={undefined}>
            <input
              {...form.register("imei")}
              type="text"
              placeholder="Optional"
              className={inputCls(false)}
            />
          </Field>
        </div>

        {/* Problem */}
        <Field label="Problem Description *" error={form.formState.errors.problem_description?.message}>
          <textarea
            {...form.register("problem_description")}
            rows={3}
            placeholder="Describe the issue (min 10 characters)…"
            className={cn(inputCls(!!form.formState.errors.problem_description), "resize-none")}
          />
        </Field>

        {/* Priority */}
        <Field label="Priority" error={undefined}>
          <div className="flex gap-2">
            {(["normal", "urgent", "vip"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => form.setValue("priority", p)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-medium border transition min-h-[40px] capitalize",
                  form.watch("priority") === p
                    ? p === "vip"
                      ? "bg-purple-600 text-white border-purple-600"
                      : p === "urgent"
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>

        {/* Charges */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service Charge (₹)" error={form.formState.errors.service_charge?.message}>
            <input
              {...form.register("service_charge", { valueAsNumber: true })}
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              className={inputCls(!!form.formState.errors.service_charge)}
            />
          </Field>
          <Field label="Advance Paid (₹)" error={undefined}>
            <input
              {...form.register("advance_paid", { valueAsNumber: true })}
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              className={inputCls(false)}
            />
          </Field>
        </div>

        {/* Expected delivery */}
        <Field label="Expected Delivery Date" error={undefined}>
          <input
            {...form.register("expected_delivery_date")}
            type="date"
            className={inputCls(false)}
          />
        </Field>

        {/* Notes */}
        <Field label="Notes" error={undefined}>
          <textarea
            {...form.register("notes")}
            rows={2}
            placeholder="Internal notes…"
            className={cn(inputCls(false), "resize-none")}
          />
        </Field>

        {mutation.error && (
          <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
            {extractError(mutation.error)}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 min-h-[44px]"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Create Job Ticket
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return cn(
    "w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition",
    "focus:ring-2 focus:ring-blue-500 focus:border-transparent",
    hasError ? "border-red-300 bg-red-50" : "border-gray-300 bg-white"
  );
}

function extractError(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e?.response?.data?.error?.message ?? "Something went wrong. Please try again.";
}
