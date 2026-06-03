"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +919876543210"),
  alternate_phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  customer_type: z.enum(["individual", "business"]),
  gstin: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  credit_limit: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewCustomerPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customer_type: "individual" as const },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      api.post("/crm/customers/", { ...data, shop_id: user?.shop_ids?.[0] }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push(`/customers/${res.data.data.id}`);
    },
  });

  const onSubmit = (data: FormValues) => mutation.mutate(data);

  const isBusinessType = form.watch("customer_type") === "business";

  return (
    <div className="max-w-lg">
      {/* Back */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Customers
      </Link>

      <h1 className="text-xl font-semibold text-gray-900 mb-6">New Customer</h1>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Customer type */}
        <div className="flex gap-2">
          {(["individual", "business"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => form.setValue("customer_type", type)}
              className={cn(
                "flex-1 py-2.5 rounded-lg text-sm font-medium border transition min-h-[44px]",
                form.watch("customer_type") === type
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              )}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        <Field
          label="Full Name *"
          error={form.formState.errors.name?.message}
        >
          <input
            {...form.register("name")}
            type="text"
            placeholder="Customer name"
            className={inputCls(!!form.formState.errors.name)}
          />
        </Field>

        <Field
          label="Mobile (E.164) *"
          error={form.formState.errors.phone?.message}
        >
          <input
            {...form.register("phone")}
            type="tel"
            placeholder="+919876543210"
            className={inputCls(!!form.formState.errors.phone)}
          />
        </Field>

        <Field label="Alternate Phone" error={form.formState.errors.alternate_phone?.message}>
          <input
            {...form.register("alternate_phone")}
            type="tel"
            placeholder="+91…"
            className={inputCls(false)}
          />
        </Field>

        <Field label="Email" error={form.formState.errors.email?.message}>
          <input
            {...form.register("email")}
            type="email"
            placeholder="customer@email.com"
            className={inputCls(!!form.formState.errors.email)}
          />
        </Field>

        {isBusinessType && (
          <Field label="GSTIN" error={form.formState.errors.gstin?.message}>
            <input
              {...form.register("gstin")}
              type="text"
              placeholder="22AAAAA0000A1Z5"
              className={inputCls(!!form.formState.errors.gstin)}
            />
          </Field>
        )}

        <Field label="Address" error={undefined}>
          <textarea
            {...form.register("address")}
            rows={2}
            placeholder="Street address"
            className={cn(inputCls(false), "resize-none")}
          />
        </Field>

        <Field label="City" error={undefined}>
          <input
            {...form.register("city")}
            type="text"
            placeholder="City"
            className={inputCls(false)}
          />
        </Field>

        <Field label="Credit Limit (₹)" error={undefined}>
          <input
            {...form.register("credit_limit")}
            type="number"
            placeholder="0"
            className={inputCls(false)}
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
          Save Customer
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
