import { apiGet, apiPost, apiPatch, apiDelete, type PageMeta } from './client';

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';
export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'holiday' | 'weekend';
export type LeaveType = 'casual' | 'sick' | 'earned' | 'unpaid' | 'maternity' | 'paternity';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type SlipStatus = 'draft' | 'approved' | 'paid';

export interface Employee {
  id: string;
  shop_id: string;
  user_id?: string | null;
  employee_code: string;
  full_name: string;
  designation: string;
  department?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  date_of_joining: string;
  date_of_leaving?: string | null;
  employment_type: EmploymentType;
  basic_salary: number;
  hra: number;
  other_allowances: number;
  gross_salary: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  bank_ifsc?: string | null;
  bank_account_masked?: string | null;
  pan_masked?: string | null;
  aadhar_masked?: string | null;
  is_active: boolean;
}

export interface Department {
  id: string;
  shop_id: string;
  name: string;
  code: string;
  head_id?: string | null;
  head_name?: string | null;
  is_active: boolean;
  employee_count: number;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  status: AttendanceStatus;
  check_in?: string | null;
  check_out?: string | null;
  overtime_hours: number;
  notes?: string | null;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
}

export interface SalarySlip {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  month: number;
  year: number;
  working_days: number;
  present_days: number;
  leave_days: number;
  absent_days: number;
  overtime_hours: number;
  basic_earned: number;
  hra_earned: number;
  allowances_earned: number;
  overtime_amount: number;
  gross_earned: number;
  pf_deduction: number;
  esic_deduction: number;
  advance_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  status: SlipStatus;
  pdf_url?: string | null;
}

export const hrApi = {
  listEmployees: (filters: { shop_id?: string; search?: string; is_active?: boolean; page?: number } = {}) =>
    apiGet<{ items: Employee[]; meta: PageMeta }>(
      '/hr/employees/',
      filters as Record<string, string | boolean | undefined>,
    ),

  getEmployee: (id: string) =>
    apiGet<Employee>(`/hr/employees/${id}/`),

  createEmployee: (body: {
    shop_id: string;
    employee_code: string;
    full_name: string;
    designation: string;
    department?: string;
    department_id?: string;
    date_of_joining: string;
    employment_type: EmploymentType;
    basic_salary: number;
    hra?: number;
    other_allowances?: number;
    pf_employee?: number;
    pf_employer?: number;
    esic_employee?: number;
    esic_employer?: number;
    bank_account_number?: string;
    bank_ifsc?: string;
    pan_number?: string;
    aadhar_number?: string;
  }) => apiPost<Employee>('/hr/employees/', body),

  updateEmployee: (id: string, body: Partial<{
    full_name: string; designation: string; department: string;
    department_id: string | null;
    date_of_leaving: string; employment_type: EmploymentType;
    basic_salary: number; hra: number; other_allowances: number;
    is_active: boolean;
  }>) => apiPatch<Employee>(`/hr/employees/${id}/`, body),

  listDepartments: (filters: { shop_id?: string; page?: number } = {}) =>
    apiGet<{ items: Department[]; meta: PageMeta }>(
      '/hr/departments/',
      filters as Record<string, string | number | undefined>,
    ),

  createDepartment: (body: {
    shop_id: string;
    name: string;
    code: string;
    head_id?: string | null;
    is_active?: boolean;
  }) => apiPost<Department>('/hr/departments/', body),

  updateDepartment: (id: string, body: Partial<{
    name: string; code: string; head_id: string | null; is_active: boolean;
  }>) => apiPatch<Department>(`/hr/departments/${id}/`, body),

  deactivateDepartment: (id: string) =>
    apiDelete<Department>(`/hr/departments/${id}/`),

  listAttendance: (filters: { shop_id?: string; month?: number; year?: number; employee_id?: string } = {}) =>
    apiGet<{ items: AttendanceRecord[] }>(
      '/hr/attendance/',
      filters as Record<string, string | number | undefined>,
    ),

  bulkMarkAttendance: (body: {
    shop_id: string;
    employee_ids: string[];
    date_from: string;
    date_to: string;
    status: AttendanceStatus;
    notes?: string;
  }) => apiPost<{ created: number; updated: number }>('/hr/attendance/bulk/', body),

  listLeaves: (filters: { shop_id?: string; status?: LeaveStatus; employee_id?: string; page?: number } = {}) =>
    apiGet<{ items: LeaveRequest[]; meta: PageMeta }>(
      '/hr/leave-requests/',
      filters as Record<string, string | undefined>,
    ),

  createLeave: (body: {
    employee_id: string;
    leave_type: LeaveType;
    from_date: string;
    to_date: string;
    days: number;
    reason: string;
  }) => apiPost<LeaveRequest>('/hr/leave-requests/', body),

  reviewLeave: (id: string, status: 'approved' | 'rejected') =>
    apiPatch<LeaveRequest>(`/hr/leave-requests/${id}/`, { status }),

  listSalarySlips: (filters: { month?: number; year?: number; shop_id?: string; status?: SlipStatus; page?: number } = {}) =>
    apiGet<{ items: SalarySlip[]; meta: PageMeta }>(
      '/hr/salary-slips/',
      filters as Record<string, string | number | undefined>,
    ),

  generateSalarySlips: (body: {
    month: number;
    year: number;
    shop_id: string;
    employee_ids?: string[];
  }) => apiPost<{ slips: SalarySlip[] }>('/hr/salary-slips/generate/', body),

  approveSalarySlip: (id: string) =>
    apiPatch<SalarySlip>(`/hr/salary-slips/${id}/`, { status: 'approved' }),

  getSalaryPdf: (id: string) =>
    apiGet<{ pdf_url: string }>(`/hr/salary-slips/${id}/pdf/`),
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Intern',
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'P', absent: 'A', half_day: '½', leave: 'L', holiday: 'H', weekend: 'W',
};

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  present:  'bg-[var(--success)] text-white',
  absent:   'bg-[var(--danger)] text-white',
  half_day: 'bg-[var(--warning)] text-white',
  leave:    'bg-[var(--info)] text-white',
  holiday:  'bg-[var(--accent)] text-white',
  weekend:  'bg-[var(--surface-2)] text-[var(--text-muted)]',
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  casual: 'Casual', sick: 'Sick', earned: 'Earned',
  unpaid: 'Unpaid', maternity: 'Maternity', paternity: 'Paternity',
};

// Re-export so existing imports from this module continue to work.
export { MONTHS_FULL as MONTHS } from '@/lib/format/date';
