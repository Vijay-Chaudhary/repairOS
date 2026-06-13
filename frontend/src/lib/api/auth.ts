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
  login: (body: { email: string; password: string }, tenantSlug?: string) =>
    apiFetch<LoginResponse>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
      headers: tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {},
    }),

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

  otpRequestWithTenant: (body: { phone: string }, tenantSlug: string) =>
    apiFetch<OtpRequestResponse>('/auth/otp/request/', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
      headers: { 'X-Tenant-Slug': tenantSlug },
    }),

  otpVerifyWithTenant: (body: { phone: string; otp: string }, tenantSlug: string) =>
    apiFetch<LoginResponse>('/auth/otp/verify/', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
      headers: { 'X-Tenant-Slug': tenantSlug },
    }),

  resetPassword: (body: { new_password: string }, accessToken: string) =>
    apiFetch<{ message: string }>('/auth/password/reset/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${accessToken}` },
      skipAuth: true,
    }),

  updateMe: (body: { full_name?: string; phone?: string; avatar_url?: string }) =>
    apiFetch<AuthUser>('/auth/me/', { method: 'PATCH', body: JSON.stringify(body) }),
};
