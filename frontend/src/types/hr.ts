export type EmploymentType = "full_time" | "part_time" | "contract" | "intern";

export interface Employee {
  id: string;
  shop: string;
  employee_code: string;
  full_name: string;
  designation: string;
  department: string | null;
  date_of_joining: string;
  date_of_leaving: string | null;
  employment_type: EmploymentType;
  basic_salary: string;
  hra: string;
  other_allowances: string;
  gross_salary: string;
  pf_employee: string;
  pf_employer: string;
  esic_employee: string;
  esic_employer: string;
  bank_ifsc: string;
  bank_account_number: string; // masked "****" or ""
  pan_number: string;          // masked "****" or ""
  aadhar_number: string;       // masked "****" or ""
}

export type AttendanceStatus =
  | "present" | "absent" | "half_day" | "leave" | "holiday" | "weekend";

export interface AttendanceRecord {
  employee_id: string;
  date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  overtime_hours: string;
  notes: string;
}

export type LeaveType =
  | "casual" | "sick" | "earned" | "unpaid" | "maternity" | "paternity";

export type LeaveStatus = "pending" | "approved" | "rejected";

export interface LeaveRequest {
  id: string;
  employee: string;
  employee_name?: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  days: string;
  reason: string;
  status: LeaveStatus;
  approved_by: string | null;
  approved_at: string | null;
}

export type SlipStatus = "draft" | "approved" | "paid";

export interface SalarySlip {
  id: string;
  employee: string;
  month: number;
  year: number;
  working_days: number;
  present_days: string;
  leave_days: string;
  absent_days: string;
  overtime_hours: string;
  basic_earned: string;
  hra_earned: string;
  allowances_earned: string;
  overtime_amount: string;
  gross_earned: string;
  pf_deduction: string;
  esic_deduction: string;
  advance_deduction: string;
  other_deductions: string;
  total_deductions: string;
  net_salary: string;
  status: SlipStatus;
  pdf_url: string;
}
