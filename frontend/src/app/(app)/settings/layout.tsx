'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';

interface TabDef {
  label: string;
  href: string;
  permission: string;
}

const TABS: TabDef[] = [
  { label: 'Shop',              href: '/settings/shop',             permission: 'settings.shop.edit' },
  { label: 'Users',             href: '/settings/users',            permission: 'settings.users.manage' },
  { label: 'Roles',             href: '/settings/roles',            permission: 'settings.roles.manage' },
  { label: 'Commission Rules',  href: '/settings/commission-rules', permission: 'settings.commission_rules.manage' },
  { label: 'WhatsApp',          href: '/settings/whatsapp',         permission: 'settings.notifications.manage' },
  { label: 'Fault Templates',   href: '/settings/fault-templates',  permission: 'repair.templates.manage' },
  { label: 'Segments',          href: '/settings/segments',         permission: 'crm.segments.manage' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { hasPermission } = useAuthStore();

  const visibleTabs = TABS.filter((t) => hasPermission(t.permission));

  return (
    <div className="flex flex-col h-full">
      <nav className="flex shrink-0 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
        {visibleTabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'px-4 py-3 text-body-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              pathname === t.href || pathname.startsWith(t.href + '/')
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
