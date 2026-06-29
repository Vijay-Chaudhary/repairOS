import { apiGet, apiPost, type PageMeta } from './client';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  route: string;
  read_at: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: () => apiGet<{ items: AppNotification[]; meta: PageMeta }>('/notifications/'),
  unreadCount: () => apiGet<{ count: number }>('/notifications/unread-count/'),
  markRead: (id: string) => apiPost<AppNotification>(`/notifications/${id}/read/`, {}),
  markAllRead: () => apiPost<{ ok: boolean }>('/notifications/read-all/', {}),
};
