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
  employee_code: z.string().min(1, "Required"),
  full_name: z.string().min(1, "Required"),
  designation: z.string().min(1, "Required"),
  department: z.string().optional(),
  date_of_joining: z.string().min(1, "Required"),
  employment_type: z.enum(["full_time", "part_time", "contract", "intern"]),
  basic_salary: z.string(),
  hra: z.string(),
  other_allowances: z.string(),
  gross_salary: z.string(),
  pf_employee: z.string(),
  pf_employer: z.string(),
  esic_employee: z.string(),
  esic_employer: z.string(),
  bank_account_number: z.string().optional(),
  bank_ifsc: z.string().optional(),
  pan_number: z.string().optional(),
  aadhar_number: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const inputCls = (err: boolean) =>
  cn("w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition focus:ring-2 focus:ring-blue-500",
    err ? "border-red-300 bg-red-50" : "border-gray-300 bg-white");

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}

export default function NewEmployeePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      employment_type: "full_time",
      basic_salary: "0", hra: "0", other_allowances: "0", gross_salary: "0",
      pf_employee: "0", pf_employer: "0", esic_employee: "0", esic_employer: "0",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      api.post("/hr/employees/", { ...data, shop_id: user?.shop_ids?.[0] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      router.push(`/hr/${res.data.data.id}`);
    },
  });

  const { errors } = form.formState;

  return (
    <div className="max-w-lg">
      <Link href="/hr" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> HR
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">New Employee</h1>

      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee Code *" error={errors.employee_code?.message}>
            <input {...form.register("employee_code")} type="text" placeholder="EMP001" className={inputCls(!!errors.employee_code)} />
          </Field>
          <Field label="Employment Type" error={undefined}>
            <select {...form.register("employment_type")} className={inputCls(false)}>
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </Field>
        </div>

        <Field label="Full Name *" error={errors.full_name?.message}>
          <input {...form.register("full_name")} type="text" placeholder="Employee name" className={inputCls(!!errors.full_name)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation *" error={errors.designation?.message}>
            <input {...form.register("designation")} type="text" placeholder="Technician" className={inputCls(!!errors.designation)} />
          </Field>
          <Field label="Department" error={undefined}>
            <input {...form.register("department")} type="text" placeholder="Service" className={inputCls(false)} />
          </Field>
        </div>

        <Field label="Date of Joining *" error={errors.date_of_joining?.message}>
          <input {...form.register("date_of_joining")} type="date" className={inputCls(!!errors.date_of_joining)} />
        </Field>

        {/* Salary */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Salary Structure</p>
          <div className="grid grid-cols-2 gap-3">
            {(["basic_salary", "hra", "other_allowances", "gross_salary"] as const).map((f) => (
              <Field key={f} label={f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} error={undefined}>
                <input {...form.register(f)} type="number" step="0.01" min="0" placeholder="0" className={inputCls(false)} />
              </Field>
            ))}
          </div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mt-2">Statutory Deductions</p>
          <div className="grid grid-cols-2 gap-3">
            {(["pf_employee", "pf_employer", "esic_employee", "esic_employer"] as const).map((f) => (
              <Field key={f} label={f.replace(/_/g, " ").toUpperCase()} error={undefined}>
                <input {...form.register(f)} type="number" step="0.01" min="0" placeholder="0" className={inputCls(false)} />
              </Field>
            ))}
          </div>
        </div>

        {/* Bank */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Bank & Compliance</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank Account" error={undefined}>
              <input {...form.register("bank_account_number")} type="text" placeholder="Account number" className={inputCls(false)} />
            </Field>
            <Field label="IFSC" error={undefined}>
              <input {...form.register("bank_ifsc")} type="text" placeholder="SBIN0001234" className={inputCls(false)} />
            </Field>
            <Field label="PAN" error={undefined}>
              <input {...form.register("pan_number")} type="text" placeholder="ABCDE1234F" className={inputCls(false)} />
            </Field>
            <Field label="Aadhar" error={undefined}>
              <input {...form.register("aadhar_number")} type="text" placeholder="12 digits" className={inputCls(false)} />
            </Field>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
            Failed to save. Check for duplicate employee code.
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 min-h-[44px]"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Employee
        </button>
      </form>
    </div>
  );
}
