'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Employees',  href: '/hr/employees' },
  { label: 'Attendance', href: '/hr/attendance' },
  { label: 'Leave',      href: '/hr/leave' },
  { label: 'Salary',     href: '/hr/salary' },
];

export default function HrLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col h-full">
      <nav className="flex shrink-0 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'px-4 py-3 text-body-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              pathname === t.href || (t.href === '/hr/employees' && pathname.startsWith('/hr/employees'))
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}
