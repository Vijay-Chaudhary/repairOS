'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { authApi } from '@/lib/api/auth';
import { wsClient } from '@/lib/ws/client';
import { flushOfflineQueue, loadQueueFromDb } from '@/lib/pwa/offlineQueue';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { AppShell } from '@/components/shared/AppShell';

const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { setAccessToken, setUser, logout, isBootstrapping, setBootstrapping, user } = useAuthStore();
  const { setActiveShop } = useActiveShopStore();
  const { setOnline } = useOfflineQueueStore();
  const router = useRouter();
  const pathname = usePathname();
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const scheduleProactiveRefresh = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(async () => {
      try {
        const res = await authApi.refresh();
        setAccessToken(res.access);
      } catch {
        logout();
        router.replace('/login');
      }
    }, REFRESH_INTERVAL_MS);
  }, [logout, router, setAccessToken]);

  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    try {
      const res = await authApi.refresh();
      setAccessToken(res.access);
      const me = await authApi.me();
      setUser(me);
      const shopId = useActiveShopStore.getState().activeShopId ?? me.shop_ids[0] ?? null;
      if (shopId) setActiveShop(shopId);
      wsClient.connect(shopId, me.id);
      scheduleProactiveRefresh();
    } catch {
      logout();
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } finally {
      setBootstrapping(false);
    }
  }, [logout, pathname, router, scheduleProactiveRefresh, setAccessToken, setActiveShop, setBootstrapping, setUser]);

  useEffect(() => {
    bootstrap();
    loadQueueFromDb();

    const handleOnline = () => {
      setOnline(true);
      flushOfflineQueue();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isBootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
