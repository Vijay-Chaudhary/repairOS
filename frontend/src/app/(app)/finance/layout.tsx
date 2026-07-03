'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/authStore';

interface Tab {
  label: string;
  href: string;
  permission?: string;
}

const TABS: Tab[] = [
  { label: 'Petty Cash', href: '/finance/petty-cash' },
  { label: 'Cash Book',  href: '/finance/cash-book' },
  { label: 'Expenses',   href: '/finance/expenses' },
  { label: 'Budget',     href: '/finance/budget' },
  { label: 'Assets',     href: '/finance/assets' },
  { label: 'Chart of Accounts', href: '/finance/chart-of-accounts', permission: 'accounts.ledger.view' },
  { label: 'Journal',    href: '/finance/journal', permission: 'accounts.journal.view' },
  { label: 'Ledger',     href: '/finance/ledger', permission: 'accounts.ledger.view' },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const tabs = TABS.filter((t) => !t.permission || hasPermission(t.permission));
  return (
    <div className="flex flex-col h-full">
      <nav className="flex shrink-0 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'px-4 py-3 text-body-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              pathname === t.href
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
