'use client';

import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { notificationsApi, type AppNotification } from '@/lib/api/notifications';
import { qk } from '@/lib/query/keys';
import { formatRelative } from '@/lib/format/date';

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: qk.notificationsUnread(),
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 45_000,
  });
  const unread = countData?.count ?? 0;

  const { data: listData } = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => notificationsApi.list(),
    staleTime: 30_000,
  });
  const items: AppNotification[] = listData?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.notifications() });
    queryClient.invalidateQueries({ queryKey: qk.notificationsUnread() });
  };
  const markRead = useMutation({ mutationFn: (id: string) => notificationsApi.markRead(id), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => notificationsApi.markAllRead(), onSuccess: invalidate });

  const openItem = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.route) router.push(n.route);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--danger)] text-white text-[10px] leading-4 text-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Notifications</span>
          {unread > 0 && (
            <button className="text-xs text-[var(--accent)]" onClick={() => markAll.mutate()}>Mark all read</button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-body-sm text-[var(--text-muted)]">You&apos;re all caught up.</div>
        ) : (
          <div className="max-h-96 overflow-auto">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] flex gap-2"
              >
                {!n.read_at && <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-body-sm text-[var(--text)] truncate">{n.title}</span>
                  {n.body && <span className="block text-xs text-[var(--text-muted)] truncate">{n.body}</span>}
                  <span className="block text-[10px] text-[var(--text-muted)]">{formatRelative(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
