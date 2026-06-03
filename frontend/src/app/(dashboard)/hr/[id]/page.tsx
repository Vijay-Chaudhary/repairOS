"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, User, CreditCard, Calendar, Briefcase } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Employee } from "@/types/hr";

async function fetchEmployee(id: string): Promise<Employee> {
  const res = await api.get(`/hr/employees/${id}/`);
  return res.data.data;
}

const EMP_TYPE_LABEL: Record<string, string> = {
  full_time: "Full Time", part_time: "Part Time",
  contract: "Contract",  intern: "Intern",
};

export default function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { data: emp, isLoading } = useQuery({
    queryKey: ["employee", params.id],
    queryFn: () => fetchEmployee(params.id),
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 max-w-lg">
        <div className="h-6 w-32 bg-gray-200 rounded" />
        <div className="h-40 bg-gray-100 rounded-xl" />
        <div className="h-32 bg-gray-100 rounded-xl" />
      </div>
    );
  }
  if (!emp) return <p className="text-gray-500">Employee not found.</p>;

  const net = parseFloat(emp.gross_salary)
    - parseFloat(emp.pf_employee)
    - parseFloat(emp.esic_employee);

  return (
    <div className="space-y-4 max-w-lg">
      <Link href="/hr" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> HR
      </Link>

      {/* Profile */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <span className="text-indigo-700 font-bold text-xl">
              {emp.full_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{emp.full_name}</h1>
            <p className="text-sm text-gray-500">{emp.designation}</p>
            {emp.department && <p className="text-xs text-gray-400">{emp.department}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InfoBox icon={<Briefcase className="w-4 h-4 text-indigo-500" />} label="Employee Code" value={emp.employee_code} mono />
          <InfoBox icon={<User className="w-4 h-4 text-blue-500" />} label="Type" value={EMP_TYPE_LABEL[emp.employment_type] ?? emp.employment_type} />
          <InfoBox icon={<Calendar className="w-4 h-4 text-green-500" />} label="Joined" value={formatDate(emp.date_of_joining)} />
          {emp.date_of_leaving && (
            <InfoBox icon={<Calendar className="w-4 h-4 text-red-400" />} label="Left" value={formatDate(emp.date_of_leaving)} />
          )}
        </div>
      </div>

      {/* Salary breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-gray-600" />
          <h2 className="text-sm font-semibold text-gray-700">Salary Structure</h2>
        </div>
        <div className="space-y-2">
          <SalaryRow label="Basic" value={parseFloat(emp.basic_salary)} />
          <SalaryRow label="HRA" value={parseFloat(emp.hra)} />
          {parseFloat(emp.other_allowances) > 0 && (
            <SalaryRow label="Other Allowances" value={parseFloat(emp.other_allowances)} />
          )}
          <div className="border-t border-gray-100 pt-2">
            <SalaryRow label="Gross Salary" value={parseFloat(emp.gross_salary)} bold />
          </div>
          <SalaryRow label="PF (Employee)" value={parseFloat(emp.pf_employee)} deduction />
          <SalaryRow label="ESIC (Employee)" value={parseFloat(emp.esic_employee)} deduction />
          <div className="border-t border-gray-100 pt-2">
            <SalaryRow label="Net Take-Home" value={net} bold />
          </div>
        </div>
      </div>

      {/* Employer contributions */}
      {(parseFloat(emp.pf_employer) > 0 || parseFloat(emp.esic_employer) > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Employer Contributions</h2>
          <div className="space-y-2">
            {parseFloat(emp.pf_employer) > 0 && (
              <SalaryRow label="PF (Employer)" value={parseFloat(emp.pf_employer)} />
            )}
            {parseFloat(emp.esic_employer) > 0 && (
              <SalaryRow label="ESIC (Employer)" value={parseFloat(emp.esic_employer)} />
            )}
          </div>
        </div>
      )}

      {/* Bank / Compliance */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Bank & Compliance</h2>
        <div className="space-y-2">
          {emp.bank_ifsc && <InfoRow label="IFSC" value={emp.bank_ifsc} mono />}
          {emp.bank_account_number && <InfoRow label="Account" value={emp.bank_account_number} mono />}
          {emp.pan_number && <InfoRow label="PAN" value={emp.pan_number} mono />}
          {emp.aadhar_number && <InfoRow label="Aadhar" value={emp.aadhar_number} mono />}
        </div>
      </div>
    </div>
  );
}

function InfoBox({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-xs text-gray-500">{label}</span></div>
      <p className={`text-sm font-medium text-gray-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function SalaryRow({ label, value, bold, deduction }: { label: string; value: number; bold?: boolean; deduction?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-xs ${bold ? "font-semibold text-gray-900" : "text-gray-500"}`}>{label}</span>
      <span className={`text-sm ${bold ? "font-bold text-gray-900" : deduction ? "text-red-600" : "text-gray-700"}`}>
        {deduction ? `- ${formatCurrency(value)}` : formatCurrency(value)}
      </span>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm text-gray-900 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
