'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Building2, LogOut, Users, CreditCard } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { authApi } from '@/lib/api/auth';
import { Button } from '@/components/ui/button';
import { wsClient } from '@/lib/ws/client';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Tenants', href: '/platform/tenants', icon: Users },
  { label: 'Plans',   href: '/platform/plans',   icon: CreditCard },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { setAccessToken, setUser, logout, isBootstrapping, setBootstrapping, user } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      setBootstrapping(true);
      try {
        const res = await authApi.refresh();
        setAccessToken(res.access);
        const me = await authApi.me();
        setUser(me);
        if (!me.is_platform_admin) {
          router.replace('/dashboard');
        }
        wsClient.connect(null, me.id);
      } catch {
        logout();
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } finally {
        setBootstrapping(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    wsClient.disconnect();
    router.replace('/login');
  }

  if (isBootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (!user?.is_platform_admin) return null;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      {/* Top bar */}
      <header className="h-14 flex items-center gap-4 px-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[var(--accent)]" />
          <span className="font-semibold text-[var(--text)]">RepairOS</span>
          <span className="text-xs text-[var(--text-muted)] font-medium px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
            Platform Admin
          </span>
        </div>

        <nav className="flex items-center gap-1 ml-6">
          {NAV.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-[var(--text-muted)] hidden sm:block">{user.name}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="h-8 gap-1.5">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
