import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';
import { ApiError } from './client';
import type { PageMeta } from './client';

export { ApiError };
export type { PageMeta };

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type Ok<T> = { success: true; data: T; meta?: PageMeta };
type Err = { success: false; error: { code: string; message: string; fields?: Record<string, string[]> } };
type ApiResponse<T> = Ok<T> | Err;

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/platform/auth/token/refresh/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const data: ApiResponse<never> = await res.json().catch(() => ({ success: false, error: { code: 'UNKNOWN', message: 'Refresh failed' } }));
      if (!data.success && (data.error.code === 'REFRESH_TOKEN_REUSE' || data.error.code === 'REFRESH_TOKEN_INVALID')) {
        usePlatformAuthStore.getState().logout();
      }
      return null;
    }
    const data: ApiResponse<{ access: string }> = await res.json();
    if (!data.success) return null;
    usePlatformAuthStore.getState().setAccessToken(data.data.access);
    return data.data.access;
  } catch {
    return null;
  }
}

async function silentRefresh(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise((resolve) => refreshQueue.push(resolve));
  }
  isRefreshing = true;
  const token = await doRefresh();
  refreshQueue.forEach((cb) => cb(token));
  refreshQueue = [];
  isRefreshing = false;
  return token;
}

export async function platformApiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = usePlatformAuthStore.getState().accessToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const url = path.startsWith('http') ? path : `${BASE_URL}/api/v1${path}`;

  const makeRequest = async (authHeader?: string): Promise<Response> => {
    if (authHeader) headers['Authorization'] = `Bearer ${authHeader}`;
    return fetch(url, { ...fetchOptions, headers, credentials: 'include' });
  };

  let response = await makeRequest();

  if (response.status === 401 && !skipAuth) {
    const newToken = await silentRefresh();
    if (newToken) {
      response = await makeRequest(newToken);
    } else {
      throw new ApiError('NOT_AUTHENTICATED', 'Session expired', 401);
    }
  }

  const data: ApiResponse<T> = await response.json().catch(() => {
    throw new ApiError('PARSE_ERROR', 'Invalid response from server', response.status);
  });

  if (!data.success) {
    throw new ApiError(data.error.code, data.error.message, response.status, data.error.fields);
  }

  return data.data;
}

export async function platformApiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = params
    ? `${path}?${new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()}`
    : path;
  return platformApiFetch<T>(url, { method: 'GET' });
}

export async function platformApiPost<T>(path: string, body?: unknown): Promise<T> {
  return platformApiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function platformApiPatch<T>(path: string, body?: unknown): Promise<T> {
  return platformApiFetch<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
