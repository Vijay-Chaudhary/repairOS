import axios, { AxiosError, type AxiosRequestConfig } from "axios";

// Browser: always empty → Next.js rewrite proxy owns /api/* (same-origin, cookie safe).
// SSR/test (jsdom): use NEXT_PUBLIC_API_URL so the real backend or MSW is reached.
const IS_TEST = typeof process !== "undefined" && process.env.VITEST === "true";
const BASE_URL =
  IS_TEST
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
    : typeof window === "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
    : "";

// Access token stored in memory (not localStorage — no XSS risk)
let _accessToken: string | null = null;

export const tokenStore = {
  get: () => _accessToken,
  set: (t: string | null) => { _accessToken = t; },
  clear: () => { _accessToken = null; },
};

// ── Axios instance ────────────────────────────────────────────────────────────

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  withCredentials: true, // send HttpOnly refresh-token cookie
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach Bearer token + tenant header ─────────────────

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const slug = getTenantSlug();
  if (slug) {
    config.headers["X-Tenant-Slug"] = slug;
  }
  return config;
});

// ── Response interceptor: transparent token refresh ──────────────────────────

let _refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      // Deduplicate concurrent refresh calls
      if (!_refreshPromise) {
        _refreshPromise = refreshAccessToken().finally(() => {
          _refreshPromise = null;
        });
      }

      try {
        const newToken = await _refreshPromise;
        tokenStore.set(newToken);
        if (original.headers) {
          original.headers.Authorization = `Bearer ${newToken}`;
        }
        return api(original);
      } catch {
        tokenStore.clear();
        throw error;
      }
    }

    return Promise.reject(error);
  }
);

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken(): Promise<string> {
  const res = await axios.post(
    `${BASE_URL}/api/v1/auth/refresh/`,
    {},
    { withCredentials: true }
  );
  const token: string = res.data?.data?.access;
  if (!token) throw new Error("refresh failed");
  return token;
}

// ── Tenant slug helper ────────────────────────────────────────────────────────

let _tenantSlug: string | null = null;

export const setTenantSlug = (slug: string | null) => { _tenantSlug = slug; };
const getTenantSlug = () => _tenantSlug;
