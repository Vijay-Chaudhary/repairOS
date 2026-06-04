import { useAuthStore } from '@/lib/stores/authStore';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  code: string;
  fields?: Record<string, string[]>;
  status: number;

  constructor(code: string, message: string, status: number, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

type Ok<T> = { success: true; data: T; meta?: PageMeta };
type Err = { success: false; error: { code: string; message: string; fields?: Record<string, string[]> } };

export interface PageMeta {
  count: number;
  next_cursor: string | null;
  previous_cursor: string | null;
}

type ApiResponse<T> = Ok<T> | Err;

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/token/refresh/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const data: ApiResponse<never> = await res.json().catch(() => ({ success: false, error: { code: 'UNKNOWN', message: 'Refresh failed' } }));
      if (!data.success && (data.error.code === 'REFRESH_TOKEN_REUSE' || data.error.code === 'REFRESH_TOKEN_INVALID')) {
        useAuthStore.getState().logout();
      }
      return null;
    }
    const data: ApiResponse<{ access_token: string }> = await res.json();
    if (!data.success) return null;
    useAuthStore.getState().setAccessToken(data.data.access_token);
    return data.data.access_token;
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

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean; idempotencyKey?: string } = {}
): Promise<T> {
  const { skipAuth, idempotencyKey, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
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
    throw new ApiError(
      data.error.code,
      data.error.message,
      response.status,
      data.error.fields
    );
  }

  return data.data;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = params
    ? `${path}?${new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()}`
    : path;
  return apiFetch<T>(url, { method: 'GET' });
}

export async function apiPost<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    idempotencyKey,
  });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
