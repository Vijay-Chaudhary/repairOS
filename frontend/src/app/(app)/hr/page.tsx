'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Users, CalendarCheck, CalendarDays, Receipt, Building2, ChevronRight,
} from 'lucide-react';
import { hrApi, MONTHS } from '@/lib/api/hr';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useAuthStore } from '@/lib/stores/authStore';

const QUICK_LINKS: Array<{ href: string; label: string; icon: React.ElementType; permission: string }> = [
  { href: '/hr/employees',   label: 'Employees',   icon: Users,        permission: 'hr.employees.view' },
  { href: '/hr/attendance',  label: 'Attendance',  icon: CalendarCheck, permission: 'hr.attendance.view' },
  { href: '/hr/leave',       label: 'Leave',       icon: CalendarDays, permission: 'hr.leaves.manage' },
  { href: '/hr/salary',      label: 'Payroll',     icon: Receipt,      permission: 'hr.salary.view' },
  { href: '/hr/departments', label: 'Departments', icon: Building2,    permission: 'hr.departments.manage' },
];

function KpiCard({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType; tone?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <Icon className={`h-4 w-4 mb-2 ${tone ?? 'text-[var(--text-muted)]'}`} />
      <div className="text-h3 font-semibold">{value}</div>
      <div className="text-body-sm text-[var(--text-muted)]">{label}</div>
      {sub && <div className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

export default function HrOverviewPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const now = new Date();
  const todayIso = format(now, 'yyyy-MM-dd');
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Headcount — employees list already excludes soft-deleted (active) employees.
  const headcountQ = useQuery({
    queryKey: qk.employees({ overview: true, shop_id: shopId }),
    queryFn: () => hrApi.listEmployees({ shop_id: shopId }),
    enabled: hasPermission('hr.employees.view'),
    staleTime: 60_000,
  });

  // Present today — fetch the current month and count today's present/half-day records.
  const attendanceQ = useQuery({
    queryKey: qk.attendance({ overview: true, shop_id: shopId, month, year }),
    queryFn: () => hrApi.listAttendance({ shop_id: shopId, month, year }),
    enabled: hasPermission('hr.attendance.mark'),
    staleTime: 60_000,
  });
  const presentToday = (attendanceQ.data?.items ?? []).filter(
    (a) => a.date === todayIso && (a.status === 'present' || a.status === 'half_day'),
  ).length;

  // Pending leave requests.
  const leavesQ = useQuery({
    queryKey: qk.leaves({ overview: true, shop_id: shopId, status: 'pending' }),
    queryFn: () => hrApi.listLeaves({ shop_id: shopId, status: 'pending' }),
    enabled: hasPermission('hr.leaves.manage'),
    staleTime: 60_000,
  });

  // Last payroll run — slips list is ordered newest-first (-year, -month).
  const slipsQ = useQuery({
    queryKey: qk.salarySlips({ overview: true, shop_id: shopId }),
    queryFn: () => hrApi.listSalarySlips({ shop_id: shopId }),
    enabled: hasPermission('hr.salary.view'),
    staleTime: 60_000,
  });
  const lastSlip = slipsQ.data?.items?.[0];

  const links = QUICK_LINKS.filter((l) => hasPermission(l.permission));

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-h1 text-[var(--text)]">HR Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Headcount" icon={Users}
          value={hasPermission('hr.employees.view') ? (headcountQ.data?.meta?.count ?? '—') : '—'}
          sub="Active employees"
        />
        <KpiCard
          label="Present today" icon={CalendarCheck} tone="text-[var(--success)]"
          value={hasPermission('hr.attendance.mark') ? presentToday : '—'}
          sub={format(now, 'd MMM yyyy')}
        />
        <KpiCard
          label="Pending leave" icon={CalendarDays}
          tone={(leavesQ.data?.meta?.count ?? 0) > 0 ? 'text-[var(--warning)]' : undefined}
          value={hasPermission('hr.leaves.manage') ? (leavesQ.data?.meta?.count ?? '—') : '—'}
          sub="Awaiting review"
        />
        <KpiCard
          label="Last payroll" icon={Receipt}
          value={hasPermission('hr.salary.view') ? (lastSlip ? `${MONTHS[lastSlip.month - 1]} ${lastSlip.year}` : 'None') : '—'}
          sub={lastSlip ? lastSlip.status : 'No slips generated'}
        />
      </div>

      <section>
        <h2 className="text-body font-medium mb-2">Manage</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href} href={href}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface-2)] transition-colors"
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-body-sm text-[var(--text)]">{label}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
