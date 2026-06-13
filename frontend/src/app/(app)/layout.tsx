'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { authApi } from '@/lib/api/auth';
import { settingsApi } from '@/lib/api/settings';
import { wsClient } from '@/lib/ws/client';
import { flushOfflineQueue, loadQueueFromDb } from '@/lib/pwa/offlineQueue';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { AppShell } from '@/components/shared/AppShell';

const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { setAccessToken, setUser, logout, isBootstrapping, setBootstrapping, user } = useAuthStore();
  const { setShops } = useActiveShopStore();
  const { setOnline } = useOfflineQueueStore();
  const router = useRouter();
  const pathname = usePathname();
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bootstrapped = useRef(false);

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
    const { accessToken: existingToken, user: existingUser } = useAuthStore.getState();

    // Fresh post-login navigation (e.g. after registration auto-login): the
    // access token was just issued so skip the cookie-based refresh and wire
    // up shops + WS directly. The proactive refresh timer will rotate the
    // token before it expires.
    if (existingToken && existingUser) {
      try {
        const shops = await settingsApi.listShops();
        setShops(shops);
        const shopId = useActiveShopStore.getState().activeShopId;
        wsClient.connect(shopId, existingUser.id);
        scheduleProactiveRefresh();
      } catch {
        // New tenant may have no shops yet — not a fatal error
      }
      setBootstrapping(false);
      return;
    }

    setBootstrapping(true);
    try {
      const res = await authApi.refresh();
      setAccessToken(res.access);
      const [me, shops] = await Promise.all([authApi.me(), settingsApi.listShops()]);
      setUser(me);
      setShops(shops);  // auto-selects first shop if activeShopId is null
      const shopId = useActiveShopStore.getState().activeShopId;
      wsClient.connect(shopId, me.id);
      scheduleProactiveRefresh();
    } catch {
      logout();
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } finally {
      setBootstrapping(false);
    }
  }, [logout, pathname, router, scheduleProactiveRefresh, setAccessToken, setBootstrapping, setShops, setUser]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

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
