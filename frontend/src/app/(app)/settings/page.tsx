'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';

const ORDERED: { href: string; permission?: string; anyOf?: string[] }[] = [
  { href: '/settings/shops',            anyOf: ['settings.shop.edit', 'settings.branches.manage'] },
  { href: '/settings/users',            permission: 'settings.users.manage' },
  { href: '/settings/roles',            permission: 'settings.roles.manage' },
  { href: '/settings/commission-rules', permission: 'settings.commission_rules.manage' },
  { href: '/settings/taxes',            permission: 'settings.taxes.manage' },
  { href: '/settings/whatsapp',         permission: 'settings.notifications.manage' },
  { href: '/settings/segments',         permission: 'crm.segments.manage' },
];

export default function SettingsRootPage() {
  const router = useRouter();
  const { hasPermission, hasAnyPermission, isBootstrapping } = useAuthStore();

  useEffect(() => {
    if (isBootstrapping) return;
    const first = ORDERED.find((p) => (p.anyOf ? hasAnyPermission(p.anyOf) : hasPermission(p.permission!)));
    router.replace(first?.href ?? '/dashboard');
  }, [isBootstrapping, hasPermission, hasAnyPermission, router]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-[var(--accent)] border-t-transparent" />
    </div>
  );
}
