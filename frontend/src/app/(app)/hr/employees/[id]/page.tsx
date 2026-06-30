'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Users, Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Can } from '@/components/shared/Can';
import { hrApi, EMPLOYMENT_TYPE_LABELS, type EmploymentType } from '@/lib/api/hr';

const NO_DEPARTMENT = '__none__';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { formatDate } from '@/lib/format/date';

const schema = z.object({
  employee_code: z.string().min(1, 'Code required'),
  full_name: z.string().min(2, 'Name required'),
  designation: z.string().min(1, 'Designation required'),
  department_id: z.string().optional(),
  date_of_joining: z.string().min(1, 'Required'),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'intern']),
  basic_salary: z.number().min(0),
  hra: z.number().min(0),
  other_allowances: z.number().min(0),
  pf_employee: z.number().min(0),
  pf_employer: z.number().min(0),
  esic_employee: z.number().min(0),
  esic_employer: z.number().min(0),
  bank_ifsc: z.string().optional(),
  bank_account_number: z.string().optional(),
  pan_number: z.string().optional(),
  aadhar_number: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();
  const isNew = id === 'new';
  const [showSensitive, setShowSensitive] = useState(false);

  const { data: employee, isLoading } = useQuery({
    queryKey: qk.employee(id),
    queryFn: () => hrApi.getEmployee(id),
    enabled: !isNew,
    staleTime: 60_000,
  });

  const { data: deptData } = useQuery({
    queryKey: qk.departments({ shop_id: activeShopId ?? undefined }),
    queryFn: () => hrApi.listDepartments({ shop_id: activeShopId ?? undefined }),
    staleTime: 60_000,
  });
  const departments = (deptData?.items ?? []).filter((d) => d.is_active);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: employee ? {
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      designation: employee.designation,
      department_id: employee.department_id ?? NO_DEPARTMENT,
      date_of_joining: employee.date_of_joining,
      employment_type: employee.employment_type,
      basic_salary: employee.basic_salary,
      hra: employee.hra,
      other_allowances: employee.other_allowances,
      pf_employee: employee.pf_employee,
      pf_employer: employee.pf_employer,
      esic_employee: employee.esic_employee,
      esic_employer: employee.esic_employer,
      bank_ifsc: employee.bank_ifsc ?? '',
      bank_account_number: '', pan_number: '', aadhar_number: '',
    } : {
      employee_code: '', full_name: '', designation: '', department_id: NO_DEPARTMENT,
      date_of_joining: '', employment_type: 'full_time' as EmploymentType,
      basic_salary: 0, hra: 0, other_allowances: 0,
      pf_employee: 0, pf_employer: 0, esic_employee: 0, esic_employer: 0,
      bank_ifsc: '', bank_account_number: '', pan_number: '', aadhar_number: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const departmentId =
        values.department_id && values.department_id !== NO_DEPARTMENT ? values.department_id : null;
      const body = {
        employee_code: values.employee_code,
        full_name: values.full_name,
        designation: values.designation,
        date_of_joining: values.date_of_joining,
        employment_type: values.employment_type,
        basic_salary: values.basic_salary,
        hra: values.hra,
        other_allowances: values.other_allowances,
        pf_employee: values.pf_employee,
        pf_employer: values.pf_employer,
        esic_employee: values.esic_employee,
        esic_employer: values.esic_employer,
        bank_ifsc: values.bank_ifsc || undefined,
        bank_account_number: values.bank_account_number || undefined,
        pan_number: values.pan_number || undefined,
        aadhar_number: values.aadhar_number || undefined,
      };
      return isNew
        ? hrApi.createEmployee({
            ...body, shop_id: activeShopId ?? '', department_id: departmentId ?? undefined,
          })
        : hrApi.updateEmployee(id, { ...body, department_id: departmentId });
    },
    onSuccess: (emp) => {
      queryClient.invalidateQueries({ queryKey: qk.employees() });
      toast.success(isNew ? 'Employee created' : 'Employee updated');
      if (isNew) router.replace(`/hr/employees/${emp.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (!isNew && isLoading) {
    return <div className="p-4 space-y-3">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (!isNew && !employee) {
    return <EmptyState icon={Users} title="Employee not found" action={{ label: 'Back', onClick: () => router.back() }} />;
  }

  const gross = (form.watch('basic_salary') ?? 0) + (form.watch('hra') ?? 0) + (form.watch('other_allowances') ?? 0);

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-h1 text-[var(--text)]">{isNew ? 'New employee' : (employee?.full_name ?? '')}</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
          {/* Basic info */}
          <div className="space-y-3">
            <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">Basic info</h2>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="full_name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Full name *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="employee_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee code *</FormLabel>
                  <FormControl><Input className="font-mono" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="date_of_joining" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of joining *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="designation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Designation *</FormLabel>
                  <FormControl><Input placeholder="Technician, Manager…" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="department_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NO_DEPARTMENT}>None</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="employment_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => (
                        <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
          </div>

          {/* Salary */}
          <div className="space-y-3">
            <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">Salary components</h2>
            <div className="grid grid-cols-2 gap-3">
              {(['basic_salary', 'hra', 'other_allowances'] as const).map((field) => (
                <FormField key={field} control={form.control} name={field} render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>{field === 'basic_salary' ? 'Basic' : field === 'hra' ? 'HRA' : 'Other allowances'}</FormLabel>
                    <FormControl><MoneyInput value={f.value} onChange={f.onChange} /></FormControl>
                  </FormItem>
                )} />
              ))}
              <div className="rounded-md bg-[var(--surface-2)] px-3 py-2 flex items-center justify-between">
                <span className="text-body-sm text-[var(--text-muted)]">Gross salary</span>
                <Money amount={gross} className="font-semibold" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['pf_employee', 'pf_employer', 'esic_employee', 'esic_employer'] as const).map((field) => (
                <FormField key={field} control={form.control} name={field} render={({ field: f }) => (
                  <FormItem>
                    <FormLabel className="text-xs">{field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</FormLabel>
                    <FormControl><MoneyInput value={f.value} onChange={f.onChange} /></FormControl>
                  </FormItem>
                )} />
              ))}
            </div>
          </div>

          {/* Statutory (masked) */}
          <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">Statutory IDs (encrypted)</h2>
              <Can permission="hr.employees.manage">
                <button type="button" onClick={() => setShowSensitive((v) => !v)} className="text-xs text-[var(--accent)] flex items-center gap-1">
                  {showSensitive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showSensitive ? 'Hide' : 'Show'}
                </button>
              </Can>
            </div>
            {showSensitive ? (
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="bank_account_number" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank account</FormLabel>
                    <FormControl><Input type="password" className="font-mono" placeholder="Enter to update" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="bank_ifsc" render={({ field }) => (
                  <FormItem>
                    <FormLabel>IFSC</FormLabel>
                    <FormControl><Input className="font-mono" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="pan_number" render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN</FormLabel>
                    <FormControl><Input className="font-mono uppercase" placeholder="ABCDE1234F" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="aadhar_number" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aadhaar</FormLabel>
                    <FormControl><Input type="password" className="font-mono" {...field} /></FormControl>
                  </FormItem>
                )} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-body-sm text-[var(--text-muted)]">
                <span>Bank: {employee?.bank_account_masked ?? '••••'}</span>
                <span>IFSC: {employee?.bank_ifsc ?? '—'}</span>
                <span>PAN: {employee?.pan_masked ?? '••••'}</span>
                <span>Aadhaar: {employee?.aadhar_masked ?? '••••'}</span>
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isNew ? 'Create employee' : 'Save changes'}
          </Button>
        </form>
      </Form>
    </div>
  );
}
