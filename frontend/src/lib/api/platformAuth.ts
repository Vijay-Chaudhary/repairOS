import { platformApiFetch, platformApiPost } from './platformClient';
import type { PlatformAdminUser } from '@/lib/stores/platformAuthStore';

export interface PlatformLoginResponse {
  access: string;
  admin: PlatformAdminUser;
}

export const platformAuthApi = {
  login: (body: { email: string; password: string }) =>
    platformApiFetch<PlatformLoginResponse>('/platform/auth/login/', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
    }),

  refresh: () =>
    platformApiFetch<{ access: string }>('/platform/auth/token/refresh/', {
      method: 'POST',
      body: JSON.stringify({}),
      skipAuth: true,
    }),

  logout: () => platformApiPost<void>('/platform/auth/logout/', {}),

  me: () => platformApiFetch<PlatformAdminUser>('/platform/auth/me/'),
};
