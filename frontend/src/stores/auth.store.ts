import { create } from "zustand";
import { jwtDecode } from "jwt-decode";
import { tokenStore, setTenantSlug, api } from "@/lib/api";
import type { User, TokenPayload, VerifyOtpRequest, SendOtpRequest } from "@/types/auth";

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  sendOtp: (data: SendOtpRequest) => Promise<void>;
  verifyOtp: (data: VerifyOtpRequest) => Promise<void>;
  logout: () => Promise<void>;
  hydrateFromRefreshToken: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  sendOtp: async ({ phone, tenant_slug }) => {
    await api.post("/auth/send-otp/", { phone, tenant_slug });
  },

  verifyOtp: async ({ phone, otp, tenant_slug }) => {
    const res = await api.post("/auth/verify-otp/", { phone, otp, tenant_slug });
    const { access, user: profile } = res.data.data as { access: string; user: Partial<User> };
    const payload = jwtDecode<TokenPayload>(access);
    tokenStore.set(access);
    setTenantSlug(tenant_slug);
    const user: User = {
      id: payload.user_id,
      tenant_slug,
      shop_ids: payload.shop_ids ?? [],
      role_ids: payload.role_ids ?? [],
      permissions: payload.permissions ?? [],
      is_platform_admin: payload.is_platform_admin ?? false,
      name: profile.name ?? "",
      phone: profile.phone ?? phone,
      email: profile.email ?? null,
    };
    set({ user, isAuthenticated: true, isLoading: false });
  },

  logout: async () => {
    try {
      await api.post("/auth/logout/");
    } finally {
      tokenStore.clear();
      setTenantSlug(null);
      set({ user: null, isAuthenticated: false });
    }
  },

  hydrateFromRefreshToken: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/v1/auth/refresh/", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("no session");
      const body = await res.json();
      const access: string = body?.data?.access;
      if (!access) throw new Error("no token");

      const payload = jwtDecode<TokenPayload>(access);
      tokenStore.set(access);
      setTenantSlug(payload.tenant_slug);

      // Fetch full user profile
      const userRes = await fetch("/api/v1/auth/me/", {
        headers: {
          Authorization: `Bearer ${access}`,
          "X-Tenant-Slug": payload.tenant_slug,
        },
        credentials: "include",
      });
      const userData = userRes.ok ? (await userRes.json()).data : null;
      // JWT payload is authoritative for permissions/roles; /me/ provides profile fields.
      const user: User = {
        id: payload.user_id,
        tenant_slug: payload.tenant_slug,
        shop_ids: payload.shop_ids ?? [],
        role_ids: payload.role_ids ?? [],
        permissions: payload.permissions ?? [],
        is_platform_admin: payload.is_platform_admin ?? false,
        name: userData?.full_name ?? userData?.name ?? "",
        phone: userData?.phone ?? "",
        email: userData?.email ?? null,
      };

      set({ user, isAuthenticated: true, isLoading: false });
      return true;
    } catch {
      tokenStore.clear();
      set({ user: null, isAuthenticated: false, isLoading: false });
      return false;
    }
  },
}));
