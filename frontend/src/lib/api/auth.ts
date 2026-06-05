import { apiFetch, apiPost } from './client';
import type { AuthUser } from '@/lib/stores/authStore';

export interface LoginResponse {
  access: string;
  user: AuthUser;
}

export interface OtpRequestResponse {
  message: string;
  expires_in: number;
}

export const authApi = {
  login: (body: { email: string; password: string; tenant_slug?: string }) =>
    apiFetch<LoginResponse>('/auth/login/', { method: 'POST', body: JSON.stringify(body), skipAuth: true }),

  otpRequest: (body: { phone: string }) =>
    apiFetch<OtpRequestResponse>('/auth/otp/request/', { method: 'POST', body: JSON.stringify(body), skipAuth: true }),

  otpVerify: (body: { phone: string; otp: string }) =>
    apiFetch<LoginResponse>('/auth/otp/verify/', { method: 'POST', body: JSON.stringify(body), skipAuth: true }),

  refresh: () =>
    apiFetch<{ access: string }>('/auth/token/refresh/', { method: 'POST', body: JSON.stringify({}), skipAuth: true, credentials: 'include' } as RequestInit & { skipAuth: boolean }),

  logout: () =>
    apiPost<void>('/auth/logout/', {}),

  me: () =>
    apiFetch<AuthUser>('/auth/me/'),

  changePassword: (body: { old_password: string; new_password: string }) =>
    apiPost<void>('/auth/password/change/', body),
};
