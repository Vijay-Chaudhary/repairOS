'use client';

import Link from 'next/link';
import { Wrench, Users, CreditCard, Building, Package, UserCheck, ChevronRight } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { REPORT_CATALOGUE, REPORT_MODULES, type ReportModule } from '@/lib/api/reports';
import { Can } from '@/components/shared/Can';
import { cn } from '@/lib/utils';

interface ModuleStyle {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const MODULE_STYLES: Record<ReportModule, ModuleStyle> = {
  Billing: { icon: CreditCard, iconColor: 'text-[var(--success)]', iconBg: 'bg-[var(--success)]/10' },
  Repair:  { icon: Wrench,     iconColor: 'text-[var(--accent)]',  iconBg: 'bg-[var(--accent)]/10' },
  CRM:     { icon: Users,      iconColor: 'text-[var(--info)]',    iconBg: 'bg-[var(--info)]/10' },
  AMC:     { icon: Building,   iconColor: 'text-[var(--warning)]', iconBg: 'bg-[var(--warning)]/10' },
  ERP:     { icon: Package,    iconColor: 'text-[var(--text)]',    iconBg: 'bg-[var(--surface-2)]' },
  HR:      { icon: UserCheck,  iconColor: 'text-[var(--danger)]',  iconBg: 'bg-[var(--danger)]/10' },
};

const MODULE_PERMISSIONS: Record<ReportModule, string[]> = {
  Billing: ['reports.revenue.view', 'reports.inventory.view'],
  Repair:  ['reports.repair.view', 'reports.hr.view'],
  CRM:     ['reports.crm.view'],
  AMC:     ['reports.amc.view'],
  ERP:     ['reports.inventory.view'],
  HR:      ['reports.hr.view'],
};

export default function ReportsPage() {
  return (
    <div className="p-4 md:p-6 space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">Reports</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-1">
          {REPORT_CATALOGUE.length} reports across all modules. Filtered to your access.
        </p>
      </div>

      {REPORT_MODULES.map((mod) => {
        const style = MODULE_STYLES[mod];
        const Icon = style.icon;
        const reports = REPORT_CATALOGUE.filter((r) => r.module === mod);
        const perms = MODULE_PERMISSIONS[mod];

        return (
          <Can key={mod} anyOf={perms}>
            <section>
              {/* Module header */}
              <div className="flex items-center gap-2 mb-3">
                <div className={cn('p-1.5 rounded-md', style.iconBg)}>
                  <Icon className={cn('h-4 w-4', style.iconColor)} />
                </div>
                <h2 className="text-body font-semibold text-[var(--text)]">{mod}</h2>
                <span className="text-xs text-[var(--text-muted)] ml-1">
                  {reports.length} report{reports.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Report cards */}
              <div className="rounded-lg border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                {reports.map((report) => (
                  <Can key={report.type} permission={report.permission}>
                    <Link
                      href={`/reports/${report.type}`}
                      className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)] hover:bg-[var(--surface-2)] transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors truncate">
                          {report.label}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {report.filters.join(' · ')} &nbsp;·&nbsp; export: {report.exports.join(', ').toUpperCase()}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)] shrink-0 group-hover:text-[var(--accent)] transition-colors" />
                    </Link>
                  </Can>
                ))}
              </div>
            </section>
          </Can>
        );
      })}
    </div>
  );
}
